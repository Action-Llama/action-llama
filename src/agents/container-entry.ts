import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import { getModel } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  createCodingTools,
} from "@mariozechner/pi-coding-agent";
import type { AgentConfig } from "../shared/config.js";
import { parseCredentialRef, unsanitizeEnvPart } from "../shared/credentials.js";

// Structured log line — written to stdout, parsed by ContainerAgentRunner on the host
function emitLog(level: string, msg: string, data?: Record<string, any>) {
  console.log(JSON.stringify({ _log: true, level, msg, ...data, ts: Date.now() }));
}

// Credential bundle loaded from mounted volume or environment variables
let credBundle: Record<string, Record<string, Record<string, string>>> = {};

function hasLocalCredentials(): boolean {
  try {
    const entries = readdirSync("/credentials");
    return entries.length > 0;
  } catch {
    return false;
  }
}

function loadCredentialsFromVolume(): void {
  for (const type of readdirSync("/credentials")) {
    const typePath = `/credentials/${type}`;
    try { if (!statSync(typePath).isDirectory()) continue; } catch { continue; }
    credBundle[type] = {};
    for (const instance of readdirSync(typePath)) {
      const instPath = `${typePath}/${instance}`;
      try { if (!statSync(instPath).isDirectory()) continue; } catch { continue; }
      credBundle[type][instance] = {};
      for (const field of readdirSync(instPath)) {
        credBundle[type][instance][field] = readFileSync(`${instPath}/${field}`, "utf-8").trim();
      }
    }
  }
}

/** ECS/Lambda inject secrets as env vars named AL_SECRET_{type}__{instance}__{field}. */
function hasEnvCredentials(): boolean {
  return Object.keys(process.env).some((k) => k.startsWith("AL_SECRET_"));
}

function loadCredentialsFromEnv(): void {
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("AL_SECRET_") || !value) continue;
    const parts = key.slice("AL_SECRET_".length).split("__");
    if (parts.length !== 3) continue;
    const [type, instance, field] = parts.map(unsanitizeEnvPart);
    credBundle[type] ??= {};
    credBundle[type][instance] ??= {};
    credBundle[type][instance][field] = value;
  }
}

function readCredentialField(type: string, instance: string, field: string): string | undefined {
  return credBundle[type]?.[instance]?.[field];
}

function readCredentialFields(type: string, instance: string): Record<string, string> {
  return credBundle[type]?.[instance] || {};
}

export async function runAgent(): Promise<number> {
  // Point HOME to /tmp so that tools writing to $HOME (e.g. git config --global)
  // work on read-only filesystems like Lambda where /home/node is not writable.
  process.env.HOME = "/tmp";

  // Switch CWD to /tmp so child processes (git, bash, etc.) default to it.
  // /tmp is the only writable directory across all platforms (local Docker,
  // ECS Fargate, Cloud Run). Node starts in /app (WORKDIR at build time).
  process.chdir("/tmp");

  const gatewayUrl = process.env.GATEWAY_URL;

  // Write gateway helper scripts to /tmp/bin/ and prepend to PATH.
  // When GATEWAY_URL is not set, these commands are no-ops (return success).
  // This lets agents use clean commands like `rlock "resource"` instead of raw curl,
  // and gracefully degrades when running without a gateway.
  mkdirSync("/tmp/bin", { recursive: true });

  const rlockScript = `#!/bin/sh
if [ -z "$GATEWAY_URL" ]; then echo '{"ok":true}'; exit 0; fi
curl -s -X POST "$GATEWAY_URL/locks/acquire" \\
  -H 'Content-Type: application/json' \\
  -d '{"secret":"'"$SHUTDOWN_SECRET"'","resourceKey":"'"$1"'"}'
`;

  const runlockScript = `#!/bin/sh
if [ -z "$GATEWAY_URL" ]; then echo '{"ok":true}'; exit 0; fi
curl -s -X POST "$GATEWAY_URL/locks/release" \\
  -H 'Content-Type: application/json' \\
  -d '{"secret":"'"$SHUTDOWN_SECRET"'","resourceKey":"'"$1"'"}' || echo '{"ok":true,"note":"gateway unreachable, lock will expire"}'
`;

  const rlockHeartbeatScript = `#!/bin/sh
if [ -z "$GATEWAY_URL" ]; then echo '{"ok":true}'; exit 0; fi
curl -s -X POST "$GATEWAY_URL/locks/heartbeat" \\
  -H 'Content-Type: application/json' \\
  -d '{"secret":"'"$SHUTDOWN_SECRET"'","resourceKey":"'"$1"'"}' || echo '{"ok":true,"note":"gateway unreachable"}'
`;

  const alShutdownScript = `#!/bin/sh
if [ -z "$GATEWAY_URL" ]; then exit 0; fi
curl -s -X POST "$GATEWAY_URL/shutdown" \\
  -H 'Content-Type: application/json' \\
  -d '{"secret":"'"$SHUTDOWN_SECRET"'","reason":"'"$\{1:-agent requested shutdown\}"'"}' || true
`;

  const alRerunScript = `#!/bin/sh
if [ -z "$GATEWAY_URL" ]; then echo '{"ok":true}'; exit 0; fi
curl -s -X POST "$GATEWAY_URL/signals/rerun" \\
  -H 'Content-Type: application/json' \\
  -d '{"secret":"'"$SHUTDOWN_SECRET"'"}'
`;

  const alStatusScript = `#!/bin/sh
if [ -z "$GATEWAY_URL" ]; then echo '{"ok":true}'; exit 0; fi
if [ -z "$1" ]; then echo '{"ok":false,"error":"missing status text"}' >&2; exit 1; fi
curl -s -X POST "$GATEWAY_URL/signals/status" \\
  -H 'Content-Type: application/json' \\
  -d '{"secret":"'"$SHUTDOWN_SECRET"'","text":"'"$1"'"}'
`;

  const alTriggerScript = `#!/bin/sh
if [ -z "$GATEWAY_URL" ]; then echo '{"ok":true}'; exit 0; fi
if [ -z "$1" ] || [ -z "$2" ]; then echo '{"ok":false,"error":"usage: al-trigger <agent> <context>"}' >&2; exit 1; fi
curl -s -X POST "$GATEWAY_URL/signals/trigger" \\
  -H 'Content-Type: application/json' \\
  -d '{"secret":"'"$SHUTDOWN_SECRET"'","targetAgent":"'"$1"'","context":"'"$2"'"}'
`;

  writeFileSync("/tmp/bin/rlock", rlockScript, { mode: 0o755 });
  writeFileSync("/tmp/bin/runlock", runlockScript, { mode: 0o755 });
  writeFileSync("/tmp/bin/rlock-heartbeat", rlockHeartbeatScript, { mode: 0o755 });
  writeFileSync("/tmp/bin/al-shutdown", alShutdownScript, { mode: 0o755 });
  writeFileSync("/tmp/bin/al-rerun", alRerunScript, { mode: 0o755 });
  writeFileSync("/tmp/bin/al-status", alStatusScript, { mode: 0o755 });
  writeFileSync("/tmp/bin/al-trigger", alTriggerScript, { mode: 0o755 });
  process.env.PATH = `/tmp/bin:${process.env.PATH || ""}`;

  // Load agent config and ACTIONS.md from baked-in files or env vars.
  // Images built with extraFiles have static content at /app/static/.
  const STATIC_DIR = "/app/static";
  const hasBakedFiles = existsSync(`${STATIC_DIR}/agent-config.json`);

  let agentConfig: AgentConfig;
  let agentsMd: string;
  let timeoutSeconds: number;

  if (hasBakedFiles) {
    agentConfig = JSON.parse(readFileSync(`${STATIC_DIR}/agent-config.json`, "utf-8"));
    agentsMd = readFileSync(`${STATIC_DIR}/ACTIONS.md`, "utf-8");
    timeoutSeconds = parseInt(readFileSync(`${STATIC_DIR}/timeout`, "utf-8").trim(), 10) || 3600;
    emitLog("info", "loaded static files from image");
  } else {
    // Legacy env var path (for images built without extraFiles)
    const agentConfigStr = process.env.AGENT_CONFIG;
    if (!agentConfigStr) {
      throw new Error("missing AGENT_CONFIG env var and no baked-in files at /app/static/");
    }
    const parsed = JSON.parse(agentConfigStr);
    agentsMd = parsed._agentsMd;
    delete parsed._agentsMd;
    agentConfig = parsed;
    timeoutSeconds = parseInt(process.env.TIMEOUT_SECONDS || "3600", 10);
  }

  // Container-level timeout — self-terminates even if scheduler dies
  const timer = setTimeout(() => {
    emitLog("error", "container timeout reached, self-terminating", { timeoutSeconds });
    process.exit(124);
  }, timeoutSeconds * 1000);
  timer.unref();

  const modelId = agentConfig.model.model;
  const modelThinking = agentConfig.model.thinkingLevel;

  emitLog("info", "container starting", { agentName: agentConfig.name, modelId, gatewayUrl });

  // Load credentials from mounted volume or env vars (ECS/Lambda/Cloud Run).
  if (hasLocalCredentials()) {
    loadCredentialsFromVolume();
    emitLog("info", "credentials loaded from volume");
  } else if (hasEnvCredentials()) {
    loadCredentialsFromEnv();
    emitLog("info", "credentials loaded from env vars");
  } else {
    throw new Error("no credentials available — no volume mount or env vars found");
  }

  // Read provider API key from credentials (not needed for pi_auth)
  const modelProvider = agentConfig.model.provider;
  const credentialType = `${modelProvider}_key`;
  const providerApiKey = readCredentialField(credentialType, "default", "token");
  if (!providerApiKey && agentConfig.model.authType !== "pi_auth") {
    throw new Error(`missing ${credentialType} credential. Run 'al doctor' to configure it.`);
  }

  // Generic credential → env var injection from credential definitions
  const { builtinCredentials } = await import("../credentials/builtins/index.js");
  for (const credRef of agentConfig.credentials) {
    const { type, instance } = parseCredentialRef(credRef);
    const def = builtinCredentials[type];
    if (!def?.envVars) continue;

    const fields = readCredentialFields(type, instance);
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
  // Use GIT_CONFIG_COUNT env vars instead of `git config --global` to avoid
  // writing to ~/.gitconfig, which may be read-only (e.g. Lambda containers).
  if (process.env.GITHUB_TOKEN) {
    process.env.GIT_TERMINAL_PROMPT = "0";
    const idx = parseInt(process.env.GIT_CONFIG_COUNT || "0", 10);
    process.env.GIT_CONFIG_COUNT = String(idx + 1);
    process.env[`GIT_CONFIG_KEY_${idx}`] = "credential.helper";
    process.env[`GIT_CONFIG_VALUE_${idx}`] = `!f() { echo username=x-access-token; echo password=$GITHUB_TOKEN; }; f`;
    emitLog("info", "git HTTPS credential helper configured");
  }

  // Set up SSH key for git push/clone if git_ssh credential is available
  // Find the git_ssh instance from credentials
  const gitSshRef = agentConfig.credentials.find((ref) => parseCredentialRef(ref).type === "git_ssh");
  if (gitSshRef) {
    const { instance } = parseCredentialRef(gitSshRef);
    const sshKey = readCredentialField("git_ssh", instance, "id_rsa");
    if (sshKey) {
      const sshDir = "/tmp/.ssh";
      mkdirSync(sshDir, { recursive: true, mode: 0o700 });
      const keyPath = `${sshDir}/id_rsa`;
      writeFileSync(keyPath, sshKey + "\n", { mode: 0o600 });
      process.env.GIT_SSH_COMMAND = `ssh -i "${keyPath}" -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes`;
      emitLog("info", "SSH key configured for git");
    }

    // Set git author identity
    const gitName = readCredentialField("git_ssh", instance, "username");
    if (gitName) {
      process.env.GIT_AUTHOR_NAME = gitName;
      process.env.GIT_COMMITTER_NAME = gitName;
    }
    const gitEmail = readCredentialField("git_ssh", instance, "email");
    if (gitEmail) {
      process.env.GIT_AUTHOR_EMAIL = gitEmail;
      process.env.GIT_COMMITTER_EMAIL = gitEmail;
    }
  }

  const cwd = "/tmp";

  const model = getModel(modelProvider as any, modelId as any);

  const authStorage = AuthStorage.create();
  if (providerApiKey) {
    authStorage.setRuntimeApiKey(modelProvider, providerApiKey);
  }

  // ACTIONS.md content is passed via the serialized config from the host
  const agentsContent = agentsMd || `# ${agentConfig.name} Agent\n\nCustom agent.\n`;

  const agentsFile = "/tmp/ACTIONS.md";

  const resourceLoader = new DefaultResourceLoader({
    noExtensions: true,
    agentsFilesOverride: () => ({
      agentsFiles: [
        { path: agentsFile, content: agentsContent },
      ],
    }),
  });
  await resourceLoader.reload();

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 2 },
  });

  emitLog("info", "creating agent session", { model: modelId, thinking: modelThinking });

  const { session } = await createAgentSession({
    cwd,
    model,
    thinkingLevel: modelThinking,
    authStorage,
    resourceLoader,
    tools: createCodingTools(cwd),
    sessionManager: SessionManager.inMemory(),
    settingsManager,
  });

  emitLog("info", "session created, sending prompt");

  const UNRECOVERABLE_PATTERNS = [
    "permission denied",
    "could not read from remote repository",
    "resource not accessible by personal access token",
    "bad credentials",
    "authentication failed",
    "the requested url returned error: 403",
    "denied to ",
  ];
  const isUnrecoverableError = (text: string) =>
    UNRECOVERABLE_PATTERNS.some((p) => text.toLowerCase().includes(p));
  const UNRECOVERABLE_THRESHOLD = 3;

  // Mirror the host-mode AgentRunner's session event logging
  const pendingCmds = new Map<string, string>();
  let outputText = "";
  let currentTurnText = "";
  let eventCount = 0;
  let unrecoverableErrors = 0;
  let abortedDueToErrors = false;
  session.subscribe((event) => {
    eventCount++;
    // Log all event types for debugging
    if (event.type !== "message_update") {
      const extra: Record<string, any> = { type: event.type, eventCount };
      // Dump message events to see what the SDK is doing
      if (event.type === "message_start" || event.type === "message_end") {
        extra.role = (event as any).role || (event as any).message?.role;
        extra.content = JSON.stringify((event as any).content || (event as any).message?.content || []).slice(0, 500);
        extra.stopReason = (event as any).stopReason || (event as any).stop_reason;
      }
      if (event.type === "turn_end") {
        extra.turnResult = JSON.stringify(event).slice(0, 500);
      }
      emitLog("debug", "event", extra);
    }
    if ((event as any).type === "error") {
      emitLog("error", "session error", { error: String((event as any).error || (event as any).message || JSON.stringify(event)) });
    }
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
      const delta = event.assistantMessageEvent.delta;
      outputText += delta;
      currentTurnText += delta;
    }
    if (event.type === "message_end") {
      if (currentTurnText.trim()) {
        emitLog("info", "assistant", { text: currentTurnText.trim() });
      }
      currentTurnText = "";
    }
    if (event.type === "tool_execution_start") {
      const cmd = String(event.args?.command || "");
      if (event.toolName === "bash") {
        pendingCmds.set(event.toolCallId, cmd);
        emitLog("info", "bash", { cmd: cmd.slice(0, 200) });
      } else {
        emitLog("debug", "tool start", { tool: event.toolName });
      }
    }
    if (event.type === "tool_execution_end") {
      const resultStr = typeof event.result === "string"
        ? event.result
        : JSON.stringify(event.result);
      const originCmd = pendingCmds.get(event.toolCallId);
      pendingCmds.delete(event.toolCallId);

      if (event.isError) {
        emitLog("error", "tool error", { tool: event.toolName, cmd: originCmd?.slice(0, 200), result: resultStr.slice(0, 1000) });
        // Parse error text for unrecoverable pattern detection
        let errorMsg = resultStr;
        try {
          const parsed = JSON.parse(resultStr);
          if (parsed?.content?.[0]?.text) errorMsg = parsed.content[0].text;
        } catch { /* use raw string */ }
        if (isUnrecoverableError(errorMsg)) {
          unrecoverableErrors++;
          if (unrecoverableErrors >= UNRECOVERABLE_THRESHOLD) {
            emitLog("error", "Aborting: repeated auth/permission failures — check credentials");
            abortedDueToErrors = true;
            session.dispose();
          }
        }
      } else {
        emitLog("debug", "tool done", { tool: event.toolName, resultLength: resultStr.length });
      }
    }
  });

  // Build full prompt: static skeleton (from image) + dynamic suffix (from env var)
  let fullPrompt: string;
  const promptStaticPath = `${STATIC_DIR}/prompt-static.txt`;
  if (hasBakedFiles && existsSync(promptStaticPath)) {
    const skeleton = readFileSync(promptStaticPath, "utf-8");
    const dynamicSuffix = process.env.PROMPT || "";
    fullPrompt = dynamicSuffix ? `${skeleton}\n\n${dynamicSuffix}` : skeleton;
  } else {
    const envPrompt = process.env.PROMPT;
    if (!envPrompt) {
      throw new Error("missing PROMPT env var and no baked-in prompt skeleton");
    }
    fullPrompt = envPrompt;
  }

  // Retry on rate limit errors with exponential backoff
  const MAX_PROMPT_RETRIES = 5;
  const DEFAULT_BACKOFF_MS = 30_000;
  const MAX_BACKOFF_MS = 300_000;

  let result: any;
  for (let attempt = 0; attempt <= MAX_PROMPT_RETRIES; attempt++) {
    try {
      result = await session.prompt(fullPrompt);
      break;
    } catch (promptErr: any) {
      const msg = String(promptErr?.message || promptErr || "");
      const isRateLimit = msg.includes("rate_limit") || msg.includes("429") || msg.includes("529") || msg.includes("overloaded");
      if (!isRateLimit || attempt === MAX_PROMPT_RETRIES) {
        throw promptErr;
      }
      const delayMs = Math.min(DEFAULT_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
      emitLog("warn", "rate limited, retrying prompt", { attempt: attempt + 1, delayMs });
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  emitLog("info", "prompt returned", { eventCount, resultType: typeof result, resultKeys: result ? Object.keys(result) : [] });

  session.dispose();
  clearTimeout(timer);

  if (abortedDueToErrors) {
    return 1;
  }

  if (outputText.includes("[RERUN]")) {
    emitLog("info", "run completed, rerun requested", { outputLength: outputText.length });
    console.log(outputText.slice(0, 2000));
    console.log("[RERUN]");
    return 42;
  }

  emitLog("info", "run completed", { outputLength: outputText.length });
  console.log(outputText.slice(0, 2000));
  return 0;
}

// Auto-run when executed directly (not as a Lambda handler).
// On Lambda, AWS_LAMBDA_RUNTIME_API is set and lambda-handler.ts drives execution.
if (!process.env.AWS_LAMBDA_RUNTIME_API) {
  runAgent().then(
    (code) => process.exit(code),
    (err) => {
      emitLog("error", "container entry error", { error: err.message, stack: err.stack?.split("\n").slice(0, 5).join("\n") });
      process.exit(1);
    },
  );
}
