/**
 * Credential loading logic extracted from container-entry.ts.
 *
 * Shared by both handleInvocation() (normal runs) and chat-entry.ts (chat mode).
 */

import { readFileSync, existsSync, readdirSync, statSync, mkdirSync, writeFileSync } from "fs";
import type { AgentConfig, ModelConfig } from "../shared/config.js";
import { parseCredentialRef, unsanitizeEnvPart } from "../shared/credentials.js";
import { builtinCredentials } from "../credentials/builtins/index.js";

// Credential bundle loaded from mounted volume or environment variables
export type CredentialBundle = Record<string, Record<string, Record<string, string>>>;

function emitLog(level: string, msg: string, data?: Record<string, any>) {
  console.log(JSON.stringify({ _log: true, level, msg, ...data, ts: Date.now() }));
}

/** Resolve the credentials path — AL_CREDENTIALS_PATH env var or /credentials default. */
function credentialsPath(): string {
  return process.env.AL_CREDENTIALS_PATH || "/credentials";
}

export function hasLocalCredentials(): boolean {
  try {
    const entries = readdirSync(credentialsPath());
    return entries.length > 0;
  } catch {
    return false;
  }
}

export function loadCredentialsFromVolume(): CredentialBundle {
  const credPath = credentialsPath();
  const bundle: CredentialBundle = {};
  for (const type of readdirSync(credPath)) {
    const typePath = `${credPath}/${type}`;
    try { if (!statSync(typePath).isDirectory()) continue; } catch { continue; }
    bundle[type] = {};
    for (const instance of readdirSync(typePath)) {
      const instPath = `${typePath}/${instance}`;
      try { if (!statSync(instPath).isDirectory()) continue; } catch { continue; }
      bundle[type][instance] = {};
      for (const field of readdirSync(instPath)) {
        bundle[type][instance][field] = readFileSync(`${instPath}/${field}`, "utf-8").trim();
      }
    }
  }
  return bundle;
}

export function hasEnvCredentials(): boolean {
  return Object.keys(process.env).some((k) => k.startsWith("AL_SECRET_"));
}

export function loadCredentialsFromEnv(): CredentialBundle {
  const bundle: CredentialBundle = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("AL_SECRET_") || !value) continue;
    const parts = key.slice("AL_SECRET_".length).split("__");
    if (parts.length !== 3) continue;
    const [type, instance, field] = parts.map(unsanitizeEnvPart);
    bundle[type] ??= {};
    bundle[type][instance] ??= {};
    bundle[type][instance][field] = value;
  }
  return bundle;
}

function readCredentialField(bundle: CredentialBundle, type: string, instance: string, field: string): string | undefined {
  return bundle[type]?.[instance]?.[field];
}

function readCredentialFields(bundle: CredentialBundle, type: string, instance: string): Record<string, string> {
  return bundle[type]?.[instance] || {};
}

export interface LoadedCredentials {
  bundle: CredentialBundle;
  providerKeys: Map<string, string>;
}

/**
 * Load credentials from volume or env vars, resolve provider API keys,
 * inject env vars for git, SSH, and other credential types.
 */
export function loadContainerCredentials(agentConfig: AgentConfig): LoadedCredentials {
  // Load credentials from mounted volume or env vars
  let bundle: CredentialBundle;
  if (hasLocalCredentials()) {
    bundle = loadCredentialsFromVolume();
    emitLog("info", "credentials loaded from volume");
  } else if (hasEnvCredentials()) {
    bundle = loadCredentialsFromEnv();
    emitLog("info", "credentials loaded from env vars");
  } else {
    throw new Error("no credentials available — no volume mount or env vars found");
  }

  // Load provider API keys for all models in the chain
  const providerKeys = new Map<string, string>();
  for (const mc of agentConfig.models) {
    if (mc.authType === "pi_auth") continue;
    const credType = `${mc.provider}_key`;
    if (providerKeys.has(mc.provider)) continue;
    const key = readCredentialField(bundle, credType, "default", "token");
    if (key) {
      providerKeys.set(mc.provider, key);
    }
  }
  if (providerKeys.size === 0 && agentConfig.models.every((m) => m.authType !== "pi_auth")) {
    throw new Error(`missing provider API key credentials. Run 'al doctor' to configure them.`);
  }

  // Generic credential → env var injection from credential definitions
  for (const credRef of agentConfig.credentials) {
    const { type, instance } = parseCredentialRef(credRef);
    const def = builtinCredentials[type];
    if (!def?.envVars) continue;

    const fields = readCredentialFields(bundle, type, instance);
    for (const [fieldName, envVar] of Object.entries(def.envVars)) {
      if (fields[fieldName]) {
        process.env[envVar] = fields[fieldName];
      }
    }
    // Special case: github_token also sets GH_TOKEN alias
    if (type === "github_token" && fields.token) {
      process.env.GH_TOKEN = fields.token;
    }
  }

  // Configure git credential helper so HTTPS clones can use GITHUB_TOKEN
  if (process.env.GITHUB_TOKEN) {
    process.env.GIT_TERMINAL_PROMPT = "0";
    const idx = parseInt(process.env.GIT_CONFIG_COUNT || "0", 10);
    process.env.GIT_CONFIG_COUNT = String(idx + 1);
    process.env[`GIT_CONFIG_KEY_${idx}`] = "credential.helper";
    process.env[`GIT_CONFIG_VALUE_${idx}`] = `!f() { echo username=x-access-token; echo password=$GITHUB_TOKEN; }; f`;
    emitLog("info", "git HTTPS credential helper configured");
  }

  // Set up SSH key for git push/clone if git_ssh credential is available
  const gitSshRef = agentConfig.credentials.find((ref) => parseCredentialRef(ref).type === "git_ssh");
  if (gitSshRef) {
    const { instance } = parseCredentialRef(gitSshRef);
    const sshKey = readCredentialField(bundle, "git_ssh", instance, "id_rsa");
    if (sshKey) {
      const sshDir = "/tmp/.ssh";
      mkdirSync(sshDir, { recursive: true, mode: 0o700 });
      const keyPath = `${sshDir}/id_rsa`;
      writeFileSync(keyPath, sshKey + "\n", { mode: 0o600 });
      process.env.GIT_SSH_COMMAND = `ssh -i "${keyPath}" -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes`;
      emitLog("info", "SSH key configured for git");
    }

    const gitName = readCredentialField(bundle, "git_ssh", instance, "username");
    if (gitName) {
      process.env.GIT_AUTHOR_NAME = gitName;
      process.env.GIT_COMMITTER_NAME = gitName;
    }
    const gitEmail = readCredentialField(bundle, "git_ssh", instance, "email");
    if (gitEmail) {
      process.env.GIT_AUTHOR_EMAIL = gitEmail;
      process.env.GIT_COMMITTER_EMAIL = gitEmail;
    }
  }

  return { bundle, providerKeys };
}
