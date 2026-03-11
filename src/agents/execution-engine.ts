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
import { backendLoadField } from "../shared/credentials.js";

export type RunResult = "completed" | "rerun" | "error";

export interface ExecutionResult {
  result: RunResult;
  outputText: string;
  unrecoverableErrors: number;
}

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

export class ExecutionEngine {
  private agentConfig: AgentConfig;
  private logger: Logger;
  private statusTracker?: any; // StatusTracker
  
  constructor(agentConfig: AgentConfig, logger: Logger, statusTracker?: any) {
    this.agentConfig = agentConfig;
    this.logger = logger;
    this.statusTracker = statusTracker;
  }

  async execute(prompt: string, cwd: string): Promise<ExecutionResult> {
    const agentsFile = resolve(cwd, "ACTIONS.md");
    const { model } = this.agentConfig;

    // ACTIONS.md must exist on disk (written during al new)
    if (!existsSync(agentsFile)) {
      throw new Error(
        `ACTIONS.md not found at ${agentsFile}. Run 'al new' to create it.`
      );
    }
    const agentsContent = readFileSync(agentsFile, "utf-8");

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
    const pendingCmds = new Map<string, string>();
    let outputText = "";
    let currentTurnText = "";
    let unrecoverableErrors = 0;

    session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
        const delta = event.assistantMessageEvent.delta;
        outputText += delta;
        currentTurnText += delta;
        // Detect [STATUS: <text>] pattern
        const statusMatch = outputText.match(/\[STATUS:\s*([^\]]+)\]/);
        if (statusMatch) {
          this.statusTracker?.setAgentStatusText(this.agentConfig.name, statusMatch[1].trim());
        }
      }
      if (event.type === "message_end") {
        if (currentTurnText.trim()) {
          this.logger.info({ text: currentTurnText.trim() }, "assistant");
        }
        currentTurnText = "";
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

    let result: RunResult;
    if (outputText.includes("[RERUN]")) {
      this.logger.info({ outputLength: outputText.length }, "run completed, rerun requested");
      result = "rerun";
    } else {
      this.logger.info({ outputLength: outputText.length }, "run completed");
      result = "completed";
    }

    session.dispose();
    return { result, outputText, unrecoverableErrors };
  }
}