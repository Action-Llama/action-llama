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
import { parseCredentialRef } from "../shared/credentials.js";

// Structured log line — written to stdout, parsed by ContainerAgentRunner on the host
function emitLog(level: string, msg: string, data?: Record<string, any>) {
  console.log(JSON.stringify({ _log: true, level, msg, ...data, ts: Date.now() }));
}

// Credential bundle loaded from either mounted volume or gateway HTTP endpoint
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

async function loadCredentialsFromGateway(gatewayUrl: string, secret: string): Promise<void> {
  emitLog("info", "fetching credentials from gateway");
  const res = await fetch(`${gatewayUrl}/credentials/${secret}`);
  if (!res.ok) {
    emitLog("error", "failed to fetch credentials from gateway", { status: res.status });
    process.exit(1);
  }
  credBundle = await res.json();
}

function readCredentialField(type: string, instance: string, field: string): string | undefined {
  return credBundle[type]?.[instance]?.[field];
}

function readCredentialFields(type: string, instance: string): Record<string, string> {
  return credBundle[type]?.[instance] || {};
}

async function main() {
  // Container-level timeout — self-terminates even if scheduler dies
  const timeoutSeconds = parseInt(process.env.TIMEOUT_SECONDS || "3600", 10);
  const timer = setTimeout(() => {
    emitLog("error", "container timeout reached, self-terminating", { timeoutSeconds });
    process.exit(124);
  }, timeoutSeconds * 1000);
  timer.unref();

  // Switch CWD to /workspace so child processes (git, bash, etc.) default to it.
  // Node must resolve from /app (WORKDIR at build time), so we chdir after startup.
  process.chdir("/workspace");

  const gatewayUrl = process.env.GATEWAY_URL;
  const shutdownSecret = process.env.SHUTDOWN_SECRET;

  // Parse agent config from env var
  const agentConfigStr = process.env.AGENT_CONFIG;
  if (!agentConfigStr) {
    emitLog("error", "missing AGENT_CONFIG env var");
    process.exit(1);
  }
  const parsed = JSON.parse(agentConfigStr);
  const agentsMd: string = parsed._agentsMd;
  delete parsed._agentsMd;
  const agentConfig: AgentConfig = parsed;
  const modelId = agentConfig.model.model;
  const modelThinking = agentConfig.model.thinkingLevel;

  emitLog("info", "container starting", { agentName: agentConfig.name, modelId, gatewayUrl });

  // Load credentials from mounted volume or via HTTP from gateway
  if (hasLocalCredentials()) {
    loadCredentialsFromVolume();
    emitLog("info", "credentials loaded from volume");
  } else if (gatewayUrl && shutdownSecret) {
    await loadCredentialsFromGateway(gatewayUrl, shutdownSecret);
    emitLog("info", "credentials loaded from gateway");
  } else {
    emitLog("error", "no credentials available — no volume mount and no gateway URL");
    process.exit(1);
  }

  // Read Anthropic API key from credentials (not needed for pi_auth)
  const anthropicKey = readCredentialField("anthropic_key", "default", "token");
  if (!anthropicKey && agentConfig.model.authType !== "pi_auth") {
    emitLog("error", "missing anthropic_key credential. Run 'al doctor' to configure it.");
    process.exit(1);
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
  if (process.env.GITHUB_TOKEN) {
    process.env.GIT_ASKPASS = "/bin/echo";
    process.env.GIT_TERMINAL_PROMPT = "0";
    const { execSync } = await import("child_process");
    try {
      execSync('git config --global credential.helper "!f() { echo username=x-access-token; echo password=$GITHUB_TOKEN; }; f"', { stdio: "ignore" });
      emitLog("info", "git HTTPS credential helper configured");
    } catch (err: any) {
      emitLog("warn", "failed to configure git credential helper", { error: err.message });
    }
  }

  // Set up SSH key for git push/clone if git_ssh credential is available
  // Find the git_ssh instance from credentials
  const gitSshRef = agentConfig.credentials.find((ref) => parseCredentialRef(ref).type === "git_ssh");
  if (gitSshRef) {
    const { instance } = parseCredentialRef(gitSshRef);
    const sshKey = readCredentialField("git_ssh", instance, "id_rsa");
    if (sshKey) {
      const sshDir = "/home/node/.ssh";
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

  const cwd = "/workspace";

  const model = getModel("anthropic", modelId as any);

  const authStorage = AuthStorage.create();
  if (anthropicKey) {
    authStorage.setRuntimeApiKey("anthropic", anthropicKey);
  }

  // PLAYBOOK.md content is passed via the serialized config from the host
  const agentsContent = agentsMd || `# ${agentConfig.name} Agent\n\nCustom agent.\n`;

  const agentsFile = "/tmp/PLAYBOOK.md";

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
  let eventCount = 0;
  let unrecoverableErrors = 0;
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
      outputText += event.assistantMessageEvent.delta;
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
            session.dispose();
            process.exit(1);
          }
        }
      } else {
        emitLog("debug", "tool done", { tool: event.toolName, resultLength: resultStr.length });
      }
    }
  });

  // Prompt is pre-built by the scheduler and passed via PROMPT env var
  const fullPrompt = process.env.PROMPT;
  if (!fullPrompt) {
    emitLog("error", "missing PROMPT env var");
    process.exit(1);
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

  if (outputText.includes("[SILENT]")) {
    emitLog("info", "no work to do");
    console.log("[SILENT]");
  } else {
    emitLog("info", "run completed", { outputLength: outputText.length });
    console.log(outputText.slice(0, 2000));
  }

  session.dispose();
  process.exit(0);
}

main().catch((err) => {
  emitLog("error", "container entry error", { error: err.message, stack: err.stack?.split("\n").slice(0, 5).join("\n") });
  process.exit(1);
});
