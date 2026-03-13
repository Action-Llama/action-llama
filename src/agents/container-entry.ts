import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync, rmSync } from "fs";
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
import { getExitCodeMessage } from "../shared/exit-codes.js";
import { ensureSignalDir, readSignals } from "./signals.js";
import { builtinCredentials } from "../credentials/builtins/index.js";
import { initTelemetry } from "../telemetry/index.js";
import type { TelemetryConfig } from "../telemetry/types.js";

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

/**
 * Components initialized once and reused across invocations (Lambda) or
 * used for the single run (Docker/ECS).
 */
export interface AgentInit {
  agentConfig: AgentConfig;
  agentsMd: string;
  timeoutSeconds: number;
  model: ReturnType<typeof getModel>;
  resourceLoader: InstanceType<typeof DefaultResourceLoader>;
  settingsManager: ReturnType<typeof SettingsManager.inMemory>;
  signalDir: string;
}

/**
 * One-time initialization — called once during Lambda init (cold start) or
 * at the start of a direct container run. Sets up PATH, signal dir, loads
 * static config, creates reusable model/resourceLoader/settingsManager.
 */
export async function initAgent(): Promise<AgentInit> {
  // Point HOME to /tmp so that tools writing to $HOME (e.g. git config --global)
  // work on read-only filesystems like Lambda where /home/node is not writable.
  process.env.HOME = "/tmp";

  // Switch CWD to /tmp so child processes (git, bash, etc.) default to it.
  // /tmp is the only writable directory across all platforms (local Docker,
  // ECS Fargate, Cloud Run). Node starts in /app (WORKDIR at build time).
  process.chdir("/tmp");

  // Set PATH to include baked scripts at /app/bin.
  // Scripts are baked into the image by the Dockerfile — no need to write them.
  process.env.PATH = `/app/bin:${process.env.PATH || ""}`;

  // Create the per-run signal directory (scripts reference $AL_SIGNAL_DIR)
  const signalDir = "/tmp/signals";
  ensureSignalDir(signalDir);
  process.env.AL_SIGNAL_DIR = signalDir;

  // Initialize telemetry if trace context is available
  if (process.env.OTEL_TRACE_PARENT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    try {
      const telemetryConfig: TelemetryConfig = {
        enabled: true,
        provider: "otel",
        serviceName: "action-llama-agent",
        endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        samplingRate: 1.0,
      };
      
      const telemetry = initTelemetry(telemetryConfig);
      await telemetry.init();
      
      // Set trace context if passed from parent
      if (process.env.OTEL_TRACE_PARENT) {
        telemetry.setTraceContext(process.env.OTEL_TRACE_PARENT);
      }
      
      emitLog("info", "telemetry initialized in container");
    } catch (error: any) {
      emitLog("warn", "failed to initialize container telemetry", { error: error.message });
    }
  }

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

  const modelProvider = agentConfig.model.provider;
  const modelId = agentConfig.model.model;
  const model = getModel(modelProvider as any, modelId as any);

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

  return { agentConfig, agentsMd, timeoutSeconds, model, resourceLoader, settingsManager, signalDir };
}

/**
 * Per-invocation handler. Loads credentials, creates a session, runs the
 * prompt, reads signals, and returns an exit code.
 */
export async function handleInvocation(init: AgentInit): Promise<number> {
  const { agentConfig, timeoutSeconds, model, resourceLoader, settingsManager, signalDir } = init;

  const gatewayUrl = process.env.GATEWAY_URL;
  const modelId = agentConfig.model.model;
  const modelThinking = agentConfig.model.thinkingLevel;

  emitLog("info", "container starting", { agentName: agentConfig.name, modelId, gatewayUrl });

  // Container-level timeout — self-terminates even if scheduler dies
  const timer = setTimeout(() => {
    emitLog("error", "container timeout reached, self-terminating", { timeoutSeconds });
    process.exit(124);
  }, timeoutSeconds * 1000);
  timer.unref();

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

  const authStorage = AuthStorage.create();
  if (providerApiKey) {
    authStorage.setRuntimeApiKey(modelProvider, providerApiKey);
  }

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
  const STATIC_DIR = "/app/static";
  const hasBakedFiles = existsSync(`${STATIC_DIR}/agent-config.json`);
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

  // Read signal files written by al-rerun, al-status, al-return, al-exit
  const signals = readSignals(signalDir);

  if (signals.exitCode !== undefined) {
    const reason = getExitCodeMessage(signals.exitCode);
    emitLog("error", "agent terminated with exit signal", { exitCode: signals.exitCode, reason });
    emitLog("info", "signal-result", { type: "exit", exitCode: signals.exitCode, reason });
    return signals.exitCode;
  }

  if (signals.rerun) {
    emitLog("info", "run completed, rerun requested", { outputLength: outputText.length });
    emitLog("info", "signal-result", { type: "rerun" });
    return 42;
  }

  if (signals.returnValue !== undefined) {
    emitLog("info", "signal-result", { type: "return", value: signals.returnValue.slice(0, 1000) });
  }

  emitLog("info", "run completed", { outputLength: outputText.length });

  // Clean up signal files between invocations (Lambda reuses /tmp)
  try {
    const signalFiles = ["rerun", "status", "return", "exit"];
    for (const f of signalFiles) {
      try { rmSync(`${signalDir}/${f}`); } catch { /* may not exist */ }
    }
  } catch { /* best-effort cleanup */ }

  // Reset credential bundle for next invocation
  credBundle = {};

  return 0;
}

/**
 * Legacy single-function entrypoint. Calls initAgent() then handleInvocation().
 * Kept for backward compatibility with non-Lambda container runs.
 */
export async function runAgent(): Promise<number> {
  const init = await initAgent();
  return handleInvocation(init);
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
