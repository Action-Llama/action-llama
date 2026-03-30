/**
 * Hidden `_run-agent` subcommand — entry point for host-user mode.
 *
 * Invoked by HostUserRuntime as: sudo -u <user> al _run-agent <agent> --project <dir>
 *
 * Reuses the same agent harness as container-entry.ts but:
 *  - Reads credentials from AL_CREDENTIALS_PATH (not /credentials)
 *  - Runs in AL_WORK_DIR (not /tmp)
 *  - No Docker, no image, no volume mounts
 */

import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadAgentConfig, loadAgentBody, loadGlobalConfig } from "../../shared/config.js";
import type { AgentConfig } from "../../shared/config.js";
import { parseCredentialRef } from "../../shared/credentials.js";
import { builtinCredentials } from "../../credentials/builtins/index.js";
import { buildPromptSkeleton, type PromptSkills } from "../../agents/prompt.js";

function emitLog(level: string, msg: string, data?: Record<string, any>) {
  console.log(JSON.stringify({ _log: true, level, msg, ...data, ts: Date.now() }));
}

type CredentialBundle = Record<string, Record<string, Record<string, string>>>;

function loadCredentialsFromPath(credPath: string): CredentialBundle {
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

function loadAndInjectCredentials(agentConfig: AgentConfig, credPath: string): Map<string, string> {
  const bundle = loadCredentialsFromPath(credPath);
  emitLog("info", "credentials loaded from host-user staging dir");

  // Load provider API keys
  const providerKeys = new Map<string, string>();
  for (const mc of agentConfig.models) {
    if (mc.authType === "pi_auth") continue;
    const credType = `${mc.provider}_key`;
    if (providerKeys.has(mc.provider)) continue;
    const key = bundle[credType]?.default?.token;
    if (key) providerKeys.set(mc.provider, key);
  }

  if (providerKeys.size === 0 && agentConfig.models.every((m) => m.authType !== "pi_auth")) {
    throw new Error("missing provider API key credentials");
  }

  // Inject env vars from credential definitions
  for (const credRef of agentConfig.credentials) {
    const { type, instance } = parseCredentialRef(credRef);
    const def = builtinCredentials[type];
    if (!def?.envVars) continue;

    const fields = bundle[type]?.[instance] || {};
    for (const [fieldName, envVar] of Object.entries(def.envVars)) {
      if (fields[fieldName]) {
        process.env[envVar] = fields[fieldName];
      }
    }
    if (type === "github_token" && fields.token) {
      process.env.GH_TOKEN = fields.token;
    }
  }

  // Git HTTPS credential helper
  if (process.env.GITHUB_TOKEN) {
    process.env.GIT_TERMINAL_PROMPT = "0";
    const idx = parseInt(process.env.GIT_CONFIG_COUNT || "0", 10);
    process.env.GIT_CONFIG_COUNT = String(idx + 1);
    process.env[`GIT_CONFIG_KEY_${idx}`] = "credential.helper";
    process.env[`GIT_CONFIG_VALUE_${idx}`] = `!f() { echo username=x-access-token; echo password=$GITHUB_TOKEN; }; f`;
    emitLog("info", "git HTTPS credential helper configured");
  }

  // SSH key setup
  const gitSshRef = agentConfig.credentials.find((ref) => parseCredentialRef(ref).type === "git_ssh");
  if (gitSshRef) {
    const { instance } = parseCredentialRef(gitSshRef);
    const sshKey = bundle.git_ssh?.[instance]?.id_rsa;
    if (sshKey) {
      const sshDir = resolve(process.env.AL_WORK_DIR || "/tmp", ".ssh");
      mkdirSync(sshDir, { recursive: true, mode: 0o700 });
      const keyPath = `${sshDir}/id_rsa`;
      writeFileSync(keyPath, sshKey + "\n", { mode: 0o600 });
      process.env.GIT_SSH_COMMAND = `ssh -i "${keyPath}" -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes`;
      emitLog("info", "SSH key configured for git");
    }
    const gitName = bundle.git_ssh?.[instance]?.username;
    if (gitName) {
      process.env.GIT_AUTHOR_NAME = gitName;
      process.env.GIT_COMMITTER_NAME = gitName;
    }
    const gitEmail = bundle.git_ssh?.[instance]?.email;
    if (gitEmail) {
      process.env.GIT_AUTHOR_EMAIL = gitEmail;
      process.env.GIT_COMMITTER_EMAIL = gitEmail;
    }
  }

  return providerKeys;
}

export async function execute(agent: string, opts: { project: string }): Promise<void> {
  const projectPath = resolve(opts.project);
  const credPath = process.env.AL_CREDENTIALS_PATH;
  const workDir = process.env.AL_WORK_DIR;

  if (!credPath) {
    throw new Error("AL_CREDENTIALS_PATH not set — this command should be invoked by HostUserRuntime");
  }

  // Set working directory
  if (workDir) {
    process.chdir(workDir);
    process.env.HOME = workDir;
  }

  // Add bin scripts (rlock, al-status, etc.) to PATH so the agent can find them.
  // In Docker these live at /app/bin; in host-user mode we resolve from the package.
  const binDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../docker/bin");
  if (existsSync(binDir)) {
    process.env.PATH = `${binDir}:${process.env.PATH || ""}`;
  }

  emitLog("info", "host-user agent starting", { agent, workDir, credPath });

  // Load agent config from project
  const agentConfig = loadAgentConfig(projectPath, agent);
  const skillBody = loadAgentBody(projectPath, agent);
  const globalConfig = loadGlobalConfig(projectPath);
  const timeoutSeconds = agentConfig.timeout ?? globalConfig.local?.timeout ?? 900;

  // Load and inject credentials
  const providerKeys = loadAndInjectCredentials(agentConfig, credPath);

  // Container-level timeout — self-terminates even if scheduler dies
  const timer = setTimeout(() => {
    emitLog("error", "agent timeout reached, self-terminating", { timeoutSeconds });
    process.exit(124);
  }, timeoutSeconds * 1000);
  timer.unref();

  // Wait for gateway if configured
  const gatewayUrl = process.env.GATEWAY_URL;
  if (gatewayUrl) {
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const res = await fetch(`${gatewayUrl}/health`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) break;
      } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // Run pre hooks
  if (agentConfig.hooks?.pre && agentConfig.hooks.pre.length > 0) {
    const { runHooks } = await import("../../hooks/runner.js");
    await runHooks(agentConfig.hooks.pre, "pre", {
      env: { ...process.env } as Record<string, string>,
      logger: emitLog,
    });
  }

  // Process context injection
  const { processContextInjection } = await import("../../agents/context-injection.js");
  const processedBody = processContextInjection(
    skillBody || `# ${agentConfig.name} Agent\n\nCustom agent.\n`,
    { ...process.env } as Record<string, string>,
  );

  // Build prompt
  const skills: PromptSkills = { locking: !!gatewayUrl, hostUser: true };
  const skeleton = buildPromptSkeleton(agentConfig, skills);
  const dynamicSuffix = process.env.PROMPT || "";
  const fullPrompt = dynamicSuffix ? `${skeleton}\n\n${dynamicSuffix}` : skeleton;

  // Set up agent session
  const { getModel } = await import("@mariozechner/pi-ai");
  const {
    AuthStorage, createAgentSession, DefaultResourceLoader,
    SessionManager, SettingsManager, createCodingTools,
  } = await import("@mariozechner/pi-coding-agent");
  const { BASH_COMMAND_PREFIX } = await import("../../agents/bash-prefix.js");
  const { ensureSignalDir, readSignals } = await import("../../agents/signals.js");
  const { ModelCircuitBreaker, selectAvailableModels, isRateLimitError } = await import("../../agents/model-fallback.js");
  const { getExitCodeMessage } = await import("../../shared/exit-codes.js");
  const { sessionStatsToUsage } = await import("../../shared/usage.js");

  // Signal directory
  const signalDir = resolve(workDir || "/tmp", "signals");
  ensureSignalDir(signalDir);
  process.env.AL_SIGNAL_DIR = signalDir;

  const resourceLoader = new DefaultResourceLoader({
    noExtensions: true,
    agentsFilesOverride: () => ({
      agentsFiles: [{ path: "/tmp/SKILL.md", content: processedBody }],
    }),
  });
  await resourceLoader.reload();

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 2 },
  });

  // Model fallback loop (mirrors container-entry.ts)
  const containerBreaker = new ModelCircuitBreaker();
  const MAX_PASSES = 3;
  const DEFAULT_BACKOFF_MS = 30_000;
  const MAX_BACKOFF_MS = 300_000;

  const UNRECOVERABLE_PATTERNS = [
    "permission denied", "could not read from remote repository",
    "resource not accessible by personal access token", "bad credentials",
    "authentication failed", "the requested url returned error: 403", "denied to ",
  ];
  const isUnrecoverableError = (text: string) =>
    UNRECOVERABLE_PATTERNS.some((p) => text.toLowerCase().includes(p));
  const UNRECOVERABLE_THRESHOLD = 3;

  let outputText = "";
  let currentTurnText = "";
  let eventCount = 0;
  let unrecoverableErrors = 0;
  let abortedDueToErrors = false;
  const pendingCmds = new Map<string, string>();

  for (let pass = 0; pass <= MAX_PASSES; pass++) {
    const availableModels = selectAvailableModels(agentConfig.models, containerBreaker);
    let modelSucceeded = false;

    for (const modelConfig of availableModels) {
      const llmModel = getModel(modelConfig.provider as any, modelConfig.model as any);

      emitLog("info", "creating agent session", { model: modelConfig.model, thinking: modelConfig.thinkingLevel });

      const authStorage = AuthStorage.create();
      const providerKey = providerKeys.get(modelConfig.provider);
      if (providerKey) authStorage.setRuntimeApiKey(modelConfig.provider, providerKey);

      const cwd = workDir || "/tmp";
      const { session } = await createAgentSession({
        cwd,
        model: llmModel,
        thinkingLevel: modelConfig.thinkingLevel,
        authStorage,
        resourceLoader,
        tools: createCodingTools(cwd, { bash: { commandPrefix: BASH_COMMAND_PREFIX } }),
        sessionManager: SessionManager.inMemory(),
        settingsManager,
      });

      session.subscribe((event) => {
        eventCount++;
        if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
          const delta = event.assistantMessageEvent.delta;
          outputText += delta;
          currentTurnText += delta;
        }
        if (event.type === "message_end") {
          if (currentTurnText.trim()) emitLog("info", "assistant", { text: currentTurnText.trim() });
          currentTurnText = "";
        }
        if (event.type === "tool_execution_start" && event.toolName === "bash") {
          const cmd = String(event.args?.command || "");
          pendingCmds.set(event.toolCallId, cmd);
          emitLog("info", "bash", { cmd: cmd.slice(0, 200) });
        }
        if (event.type === "tool_execution_end") {
          const resultStr = typeof event.result === "string" ? event.result : JSON.stringify(event.result);
          const originCmd = pendingCmds.get(event.toolCallId);
          pendingCmds.delete(event.toolCallId);
          if (event.isError) {
            emitLog("error", "tool error", { tool: event.toolName, cmd: originCmd?.slice(0, 200), result: resultStr.slice(0, 1000) });
            let errorMsg = resultStr;
            try { const p = JSON.parse(resultStr); if (p?.content?.[0]?.text) errorMsg = p.content[0].text; } catch {}
            if (isUnrecoverableError(errorMsg)) {
              unrecoverableErrors++;
              if (unrecoverableErrors >= UNRECOVERABLE_THRESHOLD) {
                emitLog("error", "Aborting: repeated auth/permission failures — check credentials");
                abortedDueToErrors = true;
                session.dispose();
              }
            }
          }
        }
      });

      try {
        await session.prompt(fullPrompt);
        containerBreaker.recordSuccess(modelConfig.provider, modelConfig.model);

        const sessionStats = session.getSessionStats();
        const usage = sessionStatsToUsage(sessionStats);
        emitLog("info", "token-usage", {
          inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens,
          totalTokens: usage.totalTokens, cost: usage.cost, turnCount: usage.turnCount,
        });

        session.dispose();
        modelSucceeded = true;
        break;
      } catch (promptErr: any) {
        const msg = String(promptErr?.message || promptErr || "");
        if (isRateLimitError(msg)) {
          containerBreaker.recordFailure(modelConfig.provider, modelConfig.model);
          emitLog("warn", "rate limited, trying next model", { provider: modelConfig.provider, model: modelConfig.model });
          session.dispose();
          continue;
        }
        session.dispose();
        throw promptErr;
      }
    }

    if (modelSucceeded) break;

    if (pass < MAX_PASSES) {
      const delayMs = Math.min(DEFAULT_BACKOFF_MS * Math.pow(2, pass), MAX_BACKOFF_MS);
      emitLog("warn", "all models exhausted, backing off", { pass: pass + 1, delayMs });
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  clearTimeout(timer);

  // Post hooks
  if (agentConfig.hooks?.post && agentConfig.hooks.post.length > 0) {
    try {
      const { runHooks } = await import("../../hooks/runner.js");
      await runHooks(agentConfig.hooks.post, "post", {
        env: { ...process.env } as Record<string, string>,
        logger: emitLog,
      });
    } catch (err: any) {
      emitLog("error", "post hook failed", { error: err?.message });
    }
  }

  if (abortedDueToErrors) process.exit(1);

  // Read signals
  const signals = readSignals(signalDir);

  if (signals.exitCode !== undefined) {
    const reason = getExitCodeMessage(signals.exitCode);
    emitLog("info", "signal-result", { type: "exit", exitCode: signals.exitCode, reason });
    process.exit(signals.exitCode);
  }

  if (signals.rerun) {
    emitLog("info", "signal-result", { type: "rerun" });
    process.exit(42);
  }

  if (signals.returnValue !== undefined) {
    emitLog("info", "signal-result", { type: "return", value: signals.returnValue.slice(0, 1000) });
  }

  emitLog("info", "run completed", { outputLength: outputText.length });
  process.exit(0);
}
