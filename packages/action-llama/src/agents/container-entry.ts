import { readFileSync, existsSync, rmSync } from "fs";
import { spawnSync } from "child_process";
import {
  DefaultResourceLoader,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import { ModelCircuitBreaker } from "./model-fallback.js";
import type { AgentConfig } from "../shared/config.js";
import { getExitCodeMessage } from "../shared/exit-codes.js";
import { ensureSignalDir, readSignals } from "./signals.js";
import { runHooks } from "../hooks/runner.js";
import { processContextInjection } from "./context-injection.js";
import { parseFrontmatter } from "../shared/frontmatter.js";
import { initTelemetry } from "../telemetry/index.js";
import type { TelemetryConfig } from "../telemetry/types.js";
import { loadContainerCredentials } from "./credential-setup.js";
import { runSessionLoop } from "./session-loop.js";

// Structured log line — written to stdout, parsed by ContainerAgentRunner on the host
function emitLog(level: string, msg: string, data?: Record<string, any>) {
  console.log(JSON.stringify({ _log: true, level, msg, ...data, ts: Date.now() }));
}


/**
 * Components initialized once and reused across invocations (Lambda) or
 * used for the single run (Docker/ECS).
 */
export interface AgentInit {
  agentConfig: AgentConfig;
  skillBody: string;
  timeoutSeconds: number;
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

  // Load agent config and SKILL.md from baked-in files or env vars.
  // Images built with extraFiles have static content at /app/static/.
  const STATIC_DIR = "/app/static";
  const hasBakedFiles = existsSync(`${STATIC_DIR}/agent-config.json`);

  let agentConfig: AgentConfig;
  let skillBody: string;
  let timeoutSeconds: number;

  if (hasBakedFiles) {
    agentConfig = JSON.parse(readFileSync(`${STATIC_DIR}/agent-config.json`, "utf-8"));
    // Read SKILL.md and extract the body (frontmatter was already parsed at build time)
    const skillPath = `${STATIC_DIR}/SKILL.md`;
    if (existsSync(skillPath)) {
      const { body } = parseFrontmatter(readFileSync(skillPath, "utf-8"));
      skillBody = body;
    } else {
      skillBody = "";
    }
    timeoutSeconds = parseInt(readFileSync(`${STATIC_DIR}/timeout`, "utf-8").trim(), 10) || 3600;
    emitLog("info", "loaded static files from image");
  } else {
    // Legacy env var path (for images built without extraFiles)
    const agentConfigStr = process.env.AGENT_CONFIG;
    if (!agentConfigStr) {
      throw new Error("missing AGENT_CONFIG env var and no baked-in files at /app/static/");
    }
    const parsed = JSON.parse(agentConfigStr);
    skillBody = parsed._skillBody || "";
    delete parsed._skillBody;
    agentConfig = parsed;
    timeoutSeconds = parseInt(process.env.TIMEOUT_SECONDS || "3600", 10);
  }

  const agentsContent = skillBody || `# ${agentConfig.name} Agent\n\nCustom agent.\n`;
  const agentsFile = "/tmp/SKILL.md";

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

  return { agentConfig, skillBody: agentsContent, timeoutSeconds, resourceLoader, settingsManager, signalDir };
}

/**
 * Per-invocation handler. Loads credentials, creates a session, runs the
 * prompt, reads signals, and returns an exit code.
 */
export async function handleInvocation(init: AgentInit): Promise<number> {
  const { agentConfig, timeoutSeconds, resourceLoader, settingsManager, signalDir } = init;

  const gatewayUrl = process.env.GATEWAY_URL;
  const primaryModel = agentConfig.models[0];
  const modelId = primaryModel.model;

  emitLog("info", "container starting", { agentName: agentConfig.name, modelId, gatewayUrl });

  // Container-level timeout — self-terminates even if scheduler dies
  const timer = setTimeout(() => {
    emitLog("error", "container timeout reached, self-terminating", { timeoutSeconds });
    process.exit(124);
  }, timeoutSeconds * 1000);
  timer.unref();

  // Wait for the gateway proxy to become reachable before proceeding.
  // On Docker Desktop the proxy container may need a moment to establish
  // connectivity back to the host gateway (502 Bad Gateway until ready).
  if (gatewayUrl) {
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const res = await fetch(`${gatewayUrl}/health`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) break;
      } catch { /* connection refused or timeout — retry */ }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // Load credentials from mounted volume or env vars (ECS/Lambda/Cloud Run).
  // Extracted to credential-setup.ts for reuse in chat mode.
  const { providerKeys } = loadContainerCredentials(agentConfig);

  // Run pre hooks (data staging before LLM session)
  if (agentConfig.hooks?.pre && agentConfig.hooks.pre.length > 0) {
    await runHooks(agentConfig.hooks.pre, "pre", {
      env: { ...process.env } as Record<string, string>,
      logger: emitLog,
    });
  }

  // Process !`command` context injection in the SKILL.md body.
  // Runs after hooks.pre (so cloned repos are available) and before the LLM session.
  const processedBody = processContextInjection(
    init.skillBody,
    { ...process.env } as Record<string, string>,
  );
  if (processedBody !== init.skillBody) {
    const updatedLoader = new DefaultResourceLoader({
      noExtensions: true,
      agentsFilesOverride: () => ({
        agentsFiles: [{ path: "/tmp/SKILL.md", content: processedBody }],
      }),
    });
    await updatedLoader.reload();
    (init as any).resourceLoader = updatedLoader;
  }

  // Script mode: if a test script is baked in, run it instead of the LLM.
  // All env setup (PATH, credentials, signal dir, git config) is already done.
  const testScriptPath = "/app/static/test-script.sh";
  if (existsSync(testScriptPath)) {
    emitLog("info", "script mode: running test-script.sh instead of LLM");
    const result = spawnSync("sh", [testScriptPath], {
      stdio: "inherit",
      env: process.env,
      cwd: "/tmp",
    });
    clearTimeout(timer);
    return result.status ?? 1;
  }

  const cwd = "/app/static";

  // Build full prompt: static skeleton (from image) + dynamic suffix (from env var)
  const STATIC_DIR2 = "/app/static";
  const hasBakedFiles2 = existsSync(`${STATIC_DIR2}/agent-config.json`);
  let fullPrompt: string;
  const promptStaticPath = `${STATIC_DIR2}/prompt-static.txt`;
  if (hasBakedFiles2 && existsSync(promptStaticPath)) {
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

  // Fresh circuit breaker per container — each run tries from the top
  const containerBreaker = new ModelCircuitBreaker();

  // Run the shared model-fallback + session loop
  let abortedDueToErrors = false;
  const loopResult = await runSessionLoop(fullPrompt, {
    models: agentConfig.models,
    circuitBreaker: containerBreaker,
    cwd,
    resourceLoader,
    settingsManager,
    providerKeys,
    log: emitLog,
    onUnrecoverableAbort: () => { abortedDueToErrors = true; },
  });
  const { outputText } = loopResult;

  clearTimeout(timer);

  // Run post hooks after LLM session, before container exits
  if (agentConfig.hooks?.post && agentConfig.hooks.post.length > 0) {
    try {
      await runHooks(agentConfig.hooks.post, "post", {
        env: { ...process.env } as Record<string, string>,
        logger: emitLog,
      });
    } catch (err: any) {
      emitLog("error", "post hook failed", { error: err?.message });
    }
  }

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

  return 0;
}

/**
 * Legacy single-function entrypoint. Calls initAgent() then handleInvocation().
 * Kept for backward compatibility with non-Lambda container runs.
 */
export async function runAgent(): Promise<number> {
  const init = await initAgent();

  // Chat mode: branch to interactive chat entrypoint
  if (process.env.AL_CHAT_MODE === "1") {
    const { runChatMode } = await import("./chat-entry.js");
    return runChatMode(init);
  }

  return handleInvocation(init);
}

runAgent().then(
  (code) => process.exit(code),
  (err) => {
    emitLog("error", "container entry error", { error: err.message, stack: err.stack?.split("\n").slice(0, 5).join("\n") });
    process.exit(1);
  },
);
