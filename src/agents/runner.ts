import { getModel } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  createCodingTools,
} from "@mariozechner/pi-coding-agent";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import type { AgentConfig } from "../shared/config.js";
import type { Logger } from "../shared/logger.js";
import { loadCredentialField, parseCredentialRef, backendLoadField } from "../shared/credentials.js";
import { agentDir } from "../shared/paths.js";
import type { StatusTracker } from "../tui/status-tracker.js";

const UNRECOVERABLE_PATTERNS = [
  "permission denied",
  "could not read from remote repository",
  "resource not accessible by personal access token",
  "bad credentials",
  "authentication failed",
  "the requested url returned error: 403",
  "denied to ",
];

function isUnrecoverableError(text: string): boolean {
  const lower = text.toLowerCase();
  return UNRECOVERABLE_PATTERNS.some((p) => lower.includes(p));
}

const UNRECOVERABLE_THRESHOLD = 3;

export type RunResult = "completed" | "silent" | "error";

export interface TriggerRequest {
  agent: string;
  context: string;
}

export interface RunOutcome {
  result: RunResult;
  triggers: TriggerRequest[];
}

const TRIGGER_PATTERN = /\[TRIGGER:\s*(\S+)\]([\s\S]*?)\[\/TRIGGER\]/g;

function extractTriggers(text: string): TriggerRequest[] {
  const triggers: TriggerRequest[] = [];
  let match;
  while ((match = TRIGGER_PATTERN.exec(text)) !== null) {
    triggers.push({ agent: match[1], context: match[2].trim() });
  }
  return triggers;
}

export class AgentRunner {
  private running = false;
  private agentConfig: AgentConfig;
  private logger: Logger;
  private projectPath: string;
  private statusTracker?: StatusTracker;

  constructor(agentConfig: AgentConfig, logger: Logger, projectPath: string, statusTracker?: StatusTracker) {
    this.agentConfig = agentConfig;
    this.logger = logger;
    this.projectPath = projectPath;
    this.statusTracker = statusTracker;
  }

  get isRunning(): boolean {
    return this.running;
  }

  async run(prompt: string, triggerInfo?: { type: 'schedule' | 'webhook' | 'agent'; source?: string }): Promise<RunOutcome> {
    if (this.running) {
      this.logger.warn(`${this.agentConfig.name} is already running, skipping`);
      return { result: "error", triggers: [] };
    }

    this.running = true;
    const runReason = triggerInfo
      ? (triggerInfo.source
        ? (triggerInfo.type === 'agent' ? `triggered by ${triggerInfo.source}` : `${triggerInfo.type} (${triggerInfo.source})`)
        : triggerInfo.type)
      : undefined;
    this.statusTracker?.startRun(this.agentConfig.name, runReason);

    if (triggerInfo) {
      const triggerDetails = triggerInfo.type === 'agent' && triggerInfo.source 
        ? `${triggerInfo.type} (${triggerInfo.source})` 
        : triggerInfo.type;
      this.logger.info(`Starting ${this.agentConfig.name} run (triggered by ${triggerDetails})`);
    } else {
      this.logger.info(`Starting ${this.agentConfig.name} run`);
    }
    const runStartTime = Date.now();
    let runError: string | undefined;

    // Declared outside try so the finally block can restore them.
    const GIT_ENV_KEYS = [
      "GIT_AUTHOR_NAME",
      "GIT_COMMITTER_NAME",
      "GIT_AUTHOR_EMAIL",
      "GIT_COMMITTER_EMAIL",
    ] as const;
    const savedGitEnv: Record<string, string | undefined> = {};
    for (const key of GIT_ENV_KEYS) {
      savedGitEnv[key] = process.env[key];
    }

    try {
      const cwd = agentDir(this.projectPath, this.agentConfig.name);
      const agentsFile = resolve(cwd, "PLAYBOOK.md");

      const { model } = this.agentConfig;
      const llmModel = getModel(
        model.provider as any,
        model.model as any
      );

      const authStorage = AuthStorage.create();
      if (model.authType !== "pi_auth") {
        // Try to load API key using provider-specific credential type
        const credentialType = `${model.provider}_key`;
        try {
          const credential = await backendLoadField(credentialType, "default", "token");
          if (credential) {
            authStorage.setRuntimeApiKey(model.provider, credential);
            this.logger.debug(`Loaded ${credentialType} credential for ${model.provider}`);
          } else {
            this.logger.warn(`${credentialType} credential not found — agent may fail to authenticate. Run 'al doctor' to configure it.`);
          }
        } catch (err) {
          this.logger.warn(`Failed to load credential for provider ${model.provider}: ${credentialType} credential type may not be configured.`);
        }
      }

      // Set git author identity from git_ssh credential (scoped to this run)
      const gitSshRef = this.agentConfig.credentials.find((ref) => parseCredentialRef(ref).type === "git_ssh");
      if (gitSshRef) {
        const { instance } = parseCredentialRef(gitSshRef);
        const gitName = await backendLoadField("git_ssh", instance, "username");
        if (gitName) {
          process.env.GIT_AUTHOR_NAME = gitName;
          process.env.GIT_COMMITTER_NAME = gitName;
        }
        const gitEmail = await backendLoadField("git_ssh", instance, "email");
        if (gitEmail) {
          process.env.GIT_AUTHOR_EMAIL = gitEmail;
          process.env.GIT_COMMITTER_EMAIL = gitEmail;
        }
      }

      // PLAYBOOK.md must exist on disk (written during al new)
      if (!existsSync(agentsFile)) {
        throw new Error(
          `PLAYBOOK.md not found at ${agentsFile}. Run 'al new' to create it.`
        );
      }
      const agentsContent = readFileSync(agentsFile, "utf-8");

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

      const { session } = await createAgentSession({
        cwd,
        model: llmModel,
        thinkingLevel: model.thinkingLevel,
        authStorage,
        resourceLoader,
        tools: createCodingTools(cwd),
        sessionManager: SessionManager.inMemory(),
        settingsManager,
      });

      // Subscribe to events for logging
      // Track bash commands by toolCallId so we can correlate start→end
      const pendingCmds = new Map<string, string>();
      let outputText = "";
      let unrecoverableErrors = 0;
      session.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
          outputText += event.assistantMessageEvent.delta;
          // Detect [STATUS: <text>] pattern
          const statusMatch = outputText.match(/\[STATUS:\s*([^\]]+)\]/);
          if (statusMatch) {
            this.statusTracker?.setAgentStatusText(this.agentConfig.name, statusMatch[1].trim());
          }
        }
        if (event.type === "tool_execution_start") {
          const cmd = String(event.args?.command || "");
          if (event.toolName === "bash") {
            pendingCmds.set(event.toolCallId, cmd);
            this.logger.info({ cmd: cmd.slice(0, 200) }, "bash");
          } else {
            this.logger.debug({ tool: event.toolName }, "tool start");
          }
        }
        if (event.type === "tool_execution_end") {
          const resultStr = typeof event.result === "string"
            ? event.result
            : JSON.stringify(event.result);
          const originCmd = pendingCmds.get(event.toolCallId);
          pendingCmds.delete(event.toolCallId);

          if (event.isError) {
            this.logger.error(
              { tool: event.toolName, result: resultStr.slice(0, 1000) },
              "tool error"
            );
            // Extract a human-readable error message from the result
            let errorMsg = resultStr;
            try {
              const parsed = JSON.parse(resultStr);
              if (parsed?.content?.[0]?.text) {
                errorMsg = parsed.content[0].text;
              }
            } catch { /* use raw string */ }
            const cmdPrefix = originCmd ? `$ ${originCmd.slice(0, 80)} — ` : "";
            const detail = `${cmdPrefix}${errorMsg.slice(0, 200)}`;
            this.statusTracker?.setAgentError(this.agentConfig.name, detail);
            this.statusTracker?.addLogLine(this.agentConfig.name, `ERROR: ${detail}`);
            if (isUnrecoverableError(errorMsg)) {
              unrecoverableErrors++;
              if (unrecoverableErrors >= UNRECOVERABLE_THRESHOLD) {
                this.logger.error("Aborting: repeated auth/permission failures — check credentials");
                this.statusTracker?.addLogLine(this.agentConfig.name, "ABORT: repeated auth/permission failures — check credentials");
                session.dispose();
              }
            }
          } else {
            this.logger.debug({ tool: event.toolName, resultLength: resultStr.length }, "tool done");
          }
        }
      });

      // Prompt is now built by the scheduler (includes <agent-config> and optional <webhook-trigger>)
      // Retry on rate limit errors with exponential backoff
      const MAX_PROMPT_RETRIES = 5;
      const DEFAULT_BACKOFF_MS = 30_000;
      const MAX_BACKOFF_MS = 300_000;

      for (let attempt = 0; attempt <= MAX_PROMPT_RETRIES; attempt++) {
        try {
          await session.prompt(prompt);
          break;
        } catch (promptErr: any) {
          const msg = String(promptErr?.message || promptErr || "");
          const isRateLimit = msg.includes("rate_limit") || msg.includes("429") || msg.includes("529") || msg.includes("overloaded");
          if (!isRateLimit || attempt === MAX_PROMPT_RETRIES) {
            throw promptErr;
          }
          const delayMs = Math.min(DEFAULT_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
          this.logger.warn(
            { attempt: attempt + 1, delayMs },
            "rate limited, retrying prompt"
          );
          this.statusTracker?.addLogLine(this.agentConfig.name, `Rate limited, retrying in ${Math.round(delayMs / 1000)}s...`);
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }

      const triggers = extractTriggers(outputText);
      let result: RunResult;
      if (outputText.includes("[SILENT]")) {
        this.logger.info("no work to do");
        this.statusTracker?.addLogLine(this.agentConfig.name, "no work to do");
        result = "silent";
      } else {
        this.logger.info({ outputLength: outputText.length }, "run completed");
        result = "completed";
      }

      session.dispose();
      return { result, triggers };
    } catch (err: any) {
      this.logger.error({ err }, `${this.agentConfig.name} run failed`);
      runError = String(err?.message || err).slice(0, 200);
      return { result: "error", triggers: [] };
    } finally {
      // Restore the git env vars we may have overwritten so other
      // agents running in the same process get a clean slate.
      for (const key of GIT_ENV_KEYS) {
        if (savedGitEnv[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = savedGitEnv[key];
        }
      }

      const elapsed = Date.now() - runStartTime;
      this.statusTracker?.endRun(this.agentConfig.name, elapsed, runError);
      this.running = false;
    }
  }
}
