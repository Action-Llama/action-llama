/**
 * Credential loading logic extracted from container-entry.ts.
 *
 * Shared by both handleInvocation() (normal runs) and chat-entry.ts (chat mode).
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { unsanitizeEnvPart } from "../shared/credentials.js";

// Credential bundle loaded from mounted volume or environment variables
export type CredentialBundle = Record<string, Record<string, Record<string, string>>>;

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

export interface LoadedCredentials {
  bundle: CredentialBundle;
  providerKeys: Map<string, string>;
}
