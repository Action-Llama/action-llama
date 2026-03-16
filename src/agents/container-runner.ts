import { randomUUID } from "crypto";
import type { GlobalConfig, AgentConfig } from "../shared/config.js";
import type { Logger } from "../shared/logger.js";
import type { ContainerRuntime, RuntimeCredentials } from "../docker/runtime.js";
import type { ContainerRegistration } from "../gateway/types.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { RunResult, RunOutcome } from "./runner.js";
import { withSpan, getTelemetry } from "../telemetry/index.js";
import { SpanKind } from "@opentelemetry/api";
import type { TokenUsage } from "../shared/usage.js";

export class ContainerAgentRunner {
  private _running = false;
  private _returnValue: string | undefined = undefined;
  private _tokenUsage: TokenUsage | undefined = undefined;
  private _containerName: string | undefined = undefined;
  private runtime: ContainerRuntime;
  private globalConfig: GlobalConfig;
  private agentConfig: AgentConfig;
  private logger: Logger;
  private registerContainer: (secret: string, reg: ContainerRegistration) => Promise<void>;
  private unregisterContainer: (secret: string) => Promise<void>;
  private gatewayUrl: string;
  public readonly instanceId: string;
  private projectPath: string;
  private image: string;
  private statusTracker?: StatusTracker;

  constructor(
    runtime: ContainerRuntime,
    globalConfig: GlobalConfig,
    agentConfig: AgentConfig,
    logger: Logger,
    registerContainer: (secret: string, reg: ContainerRegistration) => Promise<void>,
    unregisterContainer: (secret: string) => Promise<void>,
    gatewayUrl: string,
    projectPath: string,
    image: string,
    statusTracker?: StatusTracker,
    instanceId?: string
  ) {
    this.runtime = runtime;
    this.globalConfig = globalConfig;
    this.agentConfig = agentConfig;
    this.logger = logger;
    this.registerContainer = registerContainer;
    this.unregisterContainer = unregisterContainer;
    this.gatewayUrl = gatewayUrl;
    this.instanceId = instanceId || agentConfig.name;
    this.projectPath = projectPath;
    this.image = image;
    this.statusTracker = statusTracker;
  }

  get isRunning(): boolean {
    return this._running;
  }

  get containerName(): string | undefined {
    return this._containerName;
  }

  abort(): void {
    this.logger.info("Container agent runner abort requested");
    if (this._containerName) {
      this.runtime.kill(this._containerName).catch((err) => {
        this.logger.warn({ err }, "Failed to kill container during abort");
      });
    }
  }

  private forwardLogLine(line: string): void {
    if (!line.trim()) return;

    try {
      const parsed = JSON.parse(line);
      if (parsed._log) {
        const { level, msg, _log, ts, ...data } = parsed;
        const logFn = level === "error"
          ? this.logger.error.bind(this.logger)
          : level === "warn"
            ? this.logger.warn.bind(this.logger)
            : level === "debug"
              ? this.logger.debug.bind(this.logger)
              : this.logger.info.bind(this.logger);
        if (Object.keys(data).length > 0) {
          logFn(data, msg);
        } else {
          logFn(msg);
        }
        // Forward info-level log events to status tracker
        if (level !== "debug") {
          this.statusTracker?.addLogLine(this.agentConfig.name, level === "error" ? `ERROR: ${msg}` : msg);
        }
        // Surface tool errors to status tracker for TUI display
        if (level === "error" && msg === "tool error" && data.result) {
          let errorMsg = String(data.result);
          try {
            const parsed = JSON.parse(data.result);
            if (parsed?.content?.[0]?.text) {
              errorMsg = parsed.content[0].text;
            }
          } catch { /* use raw string */ }
          const cmdPrefix = data.cmd ? `$ ${String(data.cmd).slice(0, 80)} — ` : "";
          this.statusTracker?.setAgentError(this.agentConfig.name, `${cmdPrefix}${errorMsg.slice(0, 200)}`);
        }
        return;
      }
    } catch {
      // Not JSON — treat as plain output
    }

    // Detect structured signal-result logs for return values
    try {
      const parsed = JSON.parse(line);
      if (parsed._log && parsed.msg === "signal-result") {
        if (parsed.type === "return" && parsed.value) {
          this._returnValue = parsed.value;
        }
      }
      // Detect token usage logs
      if (parsed._log && parsed.msg === "token-usage") {
        this._tokenUsage = {
          inputTokens: parsed.inputTokens || 0,
          outputTokens: parsed.outputTokens || 0,
          cacheReadTokens: parsed.cacheReadTokens || 0,
          cacheWriteTokens: parsed.cacheWriteTokens || 0,
          totalTokens: parsed.totalTokens || 0,
          cost: parsed.cost || 0,
          turnCount: parsed.turnCount || 0,
        };
      }
    } catch {
      // Not JSON — plain output, nothing to detect
    }
  }

  async run(prompt: string, triggerInfo?: { type: 'schedule' | 'webhook' | 'agent'; source?: string }): Promise<RunOutcome> {
    if (this._running) {
      this.logger.warn(`${this.agentConfig.name} is already running, skipping`);
      return { result: "error", triggers: [] };
    }

    // Check if this agent already has a running container (e.g. orphan from a previous scheduler)
    try {
      if (await this.runtime.isAgentRunning(this.agentConfig.name)) {
        this.logger.warn(`${this.agentConfig.name} is already running in the runtime, skipping`);
        return { result: "error", triggers: [] };
      }
    } catch {
      // Best-effort check — proceed if it fails
    }

    this._running = true;
    
    return await withSpan(
      "container_agent.run",
      async (span) => {
        span.setAttributes({
          "agent.name": this.agentConfig.name,
          "agent.run_id": this.instanceId,
          "agent.trigger_type": triggerInfo?.type || "manual",
          "agent.trigger_source": triggerInfo?.source || "",
          "agent.model_provider": this.agentConfig.model?.provider,
          "agent.model_name": this.agentConfig.model?.model,
          "execution.environment": "container",
          "runtime.type": this.runtime.constructor.name,
          "container.image": this.image,
        });

        return this._runInternalContainer(prompt, triggerInfo, span);
      },
      {},
      SpanKind.INTERNAL
    );
  }

  private async _runInternalContainer(prompt: string, triggerInfo?: { type: 'schedule' | 'webhook' | 'agent'; source?: string }, parentSpan?: any): Promise<RunOutcome> {
    this._returnValue = undefined;
    this._tokenUsage = undefined;
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
      this.logger.info(`Starting ${this.agentConfig.name} container run (triggered by ${triggerDetails})`);
    } else {
      this.logger.info(`Starting ${this.agentConfig.name} container run`);
    }
    const runStartTime = Date.now();
    let runError: string | undefined;
    let runResult: RunResult = "error";

    const shutdownSecret = randomUUID();
    let credentials: RuntimeCredentials | undefined;
    let containerName: string | undefined;
    let logStream: { stop: () => void } | undefined;

    try {
      const timeout = this.agentConfig.timeout ?? this.globalConfig.local?.timeout ?? 900;

      // Resolve credential refs — always include anthropic_key for non-pi_auth
      const credRefs = [...new Set(this.agentConfig.credentials)];
      if (this.agentConfig.model.authType !== "pi_auth") {
        if (!credRefs.includes("anthropic_key:default")) {
          credRefs.push("anthropic_key:default");
        }
      }

      // Let the runtime prepare credentials in its native way
      credentials = await this.runtime.prepareCredentials(credRefs);

      // Build env vars — only pass the dynamic prompt suffix.
      // Static content (agent config, ACTIONS.md, prompt skeleton, timeout)
      // is baked into the image at /app/static/ during build.
      // The container-entry reads from files if available, falling back to env vars.
      const env: Record<string, string> = {
        PROMPT: prompt,
      };
      if (this.gatewayUrl) {
        env.GATEWAY_URL = this.gatewayUrl;
        env.SHUTDOWN_SECRET = shutdownSecret;
      }

      // Pass telemetry context to container
      const telemetry = getTelemetry();
      if (telemetry) {
        const traceContext = telemetry.getActiveContext();
        if (traceContext) {
          env.OTEL_TRACE_PARENT = traceContext;
        }
        // Pass collector endpoint if configured
        if (this.globalConfig.telemetry?.endpoint) {
          env.OTEL_EXPORTER_OTLP_ENDPOINT = this.globalConfig.telemetry.endpoint;
        }
      }

      containerName = await this.runtime.launch({
        image: this.image,
        agentName: this.agentConfig.name,
        env,
        credentials,
        memory: this.globalConfig.local?.memory,
        cpus: this.globalConfig.local?.cpus,
        telemetry: this.globalConfig.telemetry,
      });
      this._containerName = containerName;

      // Register container with gateway for shutdown, locking, and log ingestion.
      if (this.gatewayUrl) {
        await this.registerContainer(shutdownSecret, {
          containerName,
          agentName: this.agentConfig.name,
          instanceId: this.instanceId,
        });
      }

      // Set cloud console URL for TUI display
      const taskUrl = this.runtime.getTaskUrl(containerName);
      if (taskUrl) {
        this.statusTracker?.setTaskUrl(this.agentConfig.name, taskUrl);
      }

      this.logger.info({ container: containerName }, "container launched");

      // Stream logs in real-time via runtime
      logStream = this.runtime.streamLogs(
        containerName,
        (line) => this.forwardLogLine(line),
        (text) => this.logger.warn({ stderr: text.slice(0, 500) }, "container stderr")
      );

      const startTime = Date.now();
      const exitCode = await this.runtime.waitForExit(containerName, timeout);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      // Give the log stream a moment to flush
      await new Promise((r) => setTimeout(r, 500));
      logStream.stop();
      logStream = undefined;

      if (exitCode === 42) {
        // Exit code 42 = rerun requested
        this.logger.info({ exitCode, elapsed: `${elapsed}s` }, "container finished (rerun requested)");
        runResult = "rerun";
      } else if (exitCode !== 0) {
        this.logger.error({ exitCode, elapsed: `${elapsed}s` }, "container exited with error");
        runError = `Container exited with code ${exitCode}`;
        runResult = "error";
      } else {
        this.logger.info({ exitCode, elapsed: `${elapsed}s` }, "container finished");
        runResult = "completed";
      }
    } catch (err: any) {
      this.logger.error({ err }, `${this.agentConfig.name} container run failed`);
      runError = String(err?.message || err).slice(0, 200);
    } finally {
      if (logStream) logStream.stop();
      if (this.gatewayUrl) {
        await this.unregisterContainer(shutdownSecret);
      }
      if (credentials) {
        this.runtime.cleanupCredentials(credentials);
      }
      if (containerName) {
        await this.runtime.remove(containerName);
      }
      this._containerName = undefined;
      const elapsed = Date.now() - runStartTime;
      this.statusTracker?.endRun(this.agentConfig.name, elapsed, runError, this._tokenUsage);
      this._running = false;
      
      // Add telemetry attributes for the execution result
      if (parentSpan) {
        const attrs: Record<string, any> = {
          "execution.result": runResult,
          "execution.elapsed_ms": elapsed,
          "execution.has_return_value": !!this._returnValue,
          "container.name": containerName || "",
        };

        // Add token usage OTel attributes if available
        if (this._tokenUsage) {
          const usage = this._tokenUsage as TokenUsage;
          attrs["llm.token.input"] = usage.inputTokens;
          attrs["llm.token.output"] = usage.outputTokens;
          attrs["llm.token.cache_read"] = usage.cacheReadTokens;
          attrs["llm.token.cache_write"] = usage.cacheWriteTokens;
          attrs["llm.token.total"] = usage.totalTokens;
          attrs["llm.cost.total"] = usage.cost;
          attrs["llm.turns"] = usage.turnCount;
        }

        parentSpan.setAttributes(attrs);

        if (runResult === "error") {
          parentSpan.recordException(new Error(`Container execution failed: ${runError || "Unknown error"}`));
        }
      }
    }
    return { result: runResult, triggers: [], returnValue: this._returnValue, usage: this._tokenUsage };
  }
}
