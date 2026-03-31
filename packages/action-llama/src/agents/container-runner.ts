import { randomUUID, randomBytes } from "crypto";
import type { GlobalConfig, AgentConfig } from "../shared/config.js";
import type { Logger } from "../shared/logger.js";
import type { Runtime, RuntimeCredentials } from "../docker/runtime.js";
import type { ContainerRegistration } from "../execution/types.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { RunResult, RunOutcome } from "./types.js";
import { DEFAULT_AGENT_TIMEOUT } from "../shared/constants.js";
import { withSpan, getTelemetry } from "../telemetry/index.js";
import { SpanKind } from "@opentelemetry/api";
import type { TokenUsage } from "../shared/usage.js";

export class ContainerAgentRunner {
  private _running = false;
  private _aborting = false;
  private _returnValue: string | undefined = undefined;
  private _tokenUsage: TokenUsage | undefined = undefined;
  private _containerName: string | undefined = undefined;
  private runtime: Runtime;
  private globalConfig: GlobalConfig;
  private agentConfig: AgentConfig;
  private baseLogger: Logger;
  private logger: Logger;
  private registerContainer: (secret: string, reg: ContainerRegistration) => Promise<void>;
  private unregisterContainer: (secret: string) => Promise<void>;
  private gatewayUrl: string;
  public instanceId: string;
  private projectPath: string;
  private image: string;
  private statusTracker?: StatusTracker;

  constructor(
    runtime: Runtime,
    globalConfig: GlobalConfig,
    agentConfig: AgentConfig,
    logger: Logger,
    registerContainer: (secret: string, reg: ContainerRegistration) => Promise<void>,
    unregisterContainer: (secret: string) => Promise<void>,
    gatewayUrl: string,
    projectPath: string,
    image: string,
    statusTracker?: StatusTracker,
  ) {
    this.runtime = runtime;
    this.globalConfig = globalConfig;
    this.agentConfig = agentConfig;
    this.baseLogger = logger;
    this.logger = logger;
    this.registerContainer = registerContainer;
    this.unregisterContainer = unregisterContainer;
    this.gatewayUrl = gatewayUrl;
    this.instanceId = agentConfig.name;
    this.projectPath = projectPath;
    this.image = image;
    this.statusTracker = statusTracker;
  }

  get isRunning(): boolean {
    return this._running;
  }

  setImage(image: string): void {
    this.image = image;
  }

  setAgentConfig(config: AgentConfig): void {
    this.agentConfig = config;
  }

  setRuntime(runtime: Runtime): void {
    this.runtime = runtime;
  }

  get containerName(): string | undefined {
    return this._containerName;
  }

  abort(): void {
    this._aborting = true;
    this.logger.info("Container agent runner abort requested");
    if (this._containerName) {
      this.runtime.kill(this._containerName).catch((err) => {
        this.logger.warn({ err }, "Failed to kill container during abort");
      });
    }
  }

  private forwardLogLine(line: string): void {
    if (!line.trim()) return;

    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Not JSON — plain output, nothing to detect
      return;
    }

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
      // Surface tool errors to status tracker for TUI display
      if (level === "error" && msg === "tool error" && data.result) {
        let errorMsg = String(data.result);
        try {
          const inner = JSON.parse(data.result);
          if (inner?.content?.[0]?.text) {
            errorMsg = inner.content[0].text;
          }
        } catch { /* use raw string */ }
        const cmdPrefix = data.cmd ? `$ ${String(data.cmd).slice(0, 80)} — ` : "";
        this.statusTracker?.setAgentError(this.agentConfig.name, `${cmdPrefix}${errorMsg.slice(0, 200)}`);
      }
      // Detect return value from signal-result logs
      if (msg === "signal-result" && data.type === "return" && data.value) {
        this._returnValue = data.value;
      }
      // Detect token usage logs
      if (msg === "token-usage") {
        this._tokenUsage = {
          inputTokens: data.inputTokens || 0,
          outputTokens: data.outputTokens || 0,
          cacheReadTokens: data.cacheReadTokens || 0,
          cacheWriteTokens: data.cacheWriteTokens || 0,
          totalTokens: data.totalTokens || 0,
          cost: data.cost || 0,
          turnCount: data.turnCount || 0,
        };
      }
    }
  }

  /**
   * Monitor a running container: stream logs, wait for exit, interpret the
   * exit code, and clean up. Called by both _runInternalContainer (after
   * launch) and adoptContainer (skipping launch).
   *
   * Returns { runResult, runError } and handles all gateway/credential/
   * container cleanup in its finally block.
   */
  private async monitorContainer(opts: {
    containerName: string;
    shutdownSecret: string;
    timeout: number;
    credentials?: RuntimeCredentials;
    logPrefix?: string;
    parentSpan?: any;
  }): Promise<{ runResult: RunResult; runError: string | undefined }> {
    const { containerName, shutdownSecret, timeout, credentials, logPrefix, parentSpan } = opts;
    let runError: string | undefined;
    let runResult: RunResult = "error";
    let logStream: { stop: () => void } | undefined;

    try {
      // Register container with gateway for shutdown, locking, and log ingestion.
      if (this.gatewayUrl) {
        await this.registerContainer(shutdownSecret, {
          containerName,
          agentName: this.agentConfig.name,
          instanceId: this.instanceId,
        });
      }

      // Stream logs in real-time via runtime
      logStream = this.runtime.streamLogs(
        containerName,
        (line) => this.forwardLogLine(line),
        (text) => this.logger.warn({ stderr: text.slice(0, 500) }, "container stderr"),
      );

      const startTime = Date.now();
      const exitCode = await this.runtime.waitForExit(containerName, timeout);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      // Give the log stream a moment to flush
      await new Promise((r) => setTimeout(r, 500));
      logStream.stop();
      logStream = undefined;

      if (exitCode === 42) {
        runResult = "rerun";
        this.logger.info({ exitCode, elapsed: `${elapsed}s` }, `${logPrefix ?? "container"} finished (rerun requested)`);
      } else if (exitCode !== 0) {
        if (this._aborting) {
          this.logger.info({ exitCode, elapsed: `${elapsed}s` }, `${logPrefix ?? "container"} killed (abort requested)`);
        } else {
          this.logger.error({ exitCode, elapsed: `${elapsed}s` }, `${logPrefix ?? "container"} exited with error`);
        }
        runError = `Container exited with code ${exitCode}`;
        runResult = "error";
      } else {
        runResult = "completed";
        this.logger.info({ exitCode, elapsed: `${elapsed}s` }, `${logPrefix ?? "container"} finished`);
      }
      this.statusTracker?.addLogLine(this.agentConfig.name, `${this.instanceId} ${runResult} (${elapsed}s)`);
    } catch (err: any) {
      this.logger.error({ err }, `${this.agentConfig.name} container monitoring failed`);
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

      // Add telemetry attributes for the execution result
      if (parentSpan) {
        const attrs: Record<string, any> = {
          "execution.result": runResult,
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

    return { runResult, runError };
  }

  /**
   * Adopt an already-running container from a previous scheduler session.
   * Re-attaches log streaming, monitors exit, and records the result.
   * Skips image launch, credential preparation, and env setup.
   */
  async adoptContainer(
    containerName: string,
    shutdownSecret: string,
    instanceId: string,
    triggerInfo?: { type: 'schedule' | 'manual' | 'webhook' | 'agent'; source?: string },
  ): Promise<RunOutcome> {
    if (this._running) {
      this.logger.warn("runner already busy, cannot adopt");
      return { result: "error", triggers: [] };
    }

    this._running = true;
    this._aborting = false;
    this._returnValue = undefined;
    this._tokenUsage = undefined;
    this.instanceId = instanceId;
    this._containerName = containerName;
    this.logger = this.baseLogger.child({ instance: this.instanceId });

    const runStartTime = Date.now();

    this.statusTracker?.startRun(this.agentConfig.name, "re-adopted");
    this.statusTracker?.registerInstance({
      id: this.instanceId,
      agentName: this.agentConfig.name,
      status: "running",
      startedAt: new Date(),
      trigger: "re-adopted",
    });

    this.logger.info({ container: containerName }, "re-adopted orphan container");
    this.statusTracker?.addLogLine(this.agentConfig.name, `${this.instanceId} re-adopted`);

    const timeout = this.agentConfig.timeout ?? this.globalConfig.local?.timeout ?? DEFAULT_AGENT_TIMEOUT;

    const { runResult, runError } = await this.monitorContainer({
      containerName,
      shutdownSecret,
      timeout,
      logPrefix: "adopted container",
    });

    const elapsed = Date.now() - runStartTime;
    const instanceStatus = this._aborting ? "killed" as const : runError ? "error" as const : "completed" as const;
    this.statusTracker?.completeInstance(this.instanceId, instanceStatus);
    this.statusTracker?.endRun(this.agentConfig.name, elapsed, runError, this._tokenUsage);
    this._running = false;

    return { result: runResult, triggers: [], returnValue: this._returnValue, usage: this._tokenUsage };
  }

  async run(prompt: string, triggerInfo?: { type: 'schedule' | 'manual' | 'webhook' | 'agent'; source?: string }, instanceId?: string): Promise<RunOutcome> {
    if (this._running) {
      this.logger.warn(`${this.agentConfig.name} is already running, skipping`);
      return { result: "error", triggers: [] };
    }

    this._running = true;
    this._aborting = false;

    // Generate a unique instance ID for this run (or use the pre-generated one)
    this.instanceId = instanceId ?? `${this.agentConfig.name}-${randomBytes(4).toString("hex")}`;
    this.logger = this.baseLogger.child({ instance: this.instanceId });

    try {
      return await withSpan(
        "container_agent.run",
        async (span) => {
          span.setAttributes({
            "agent.name": this.agentConfig.name,
            "agent.run_id": this.instanceId,
            "agent.trigger_type": triggerInfo?.type || "manual",
            "agent.trigger_source": triggerInfo?.source || "",
            "agent.model_provider": this.agentConfig.models[0]?.provider,
            "agent.model_name": this.agentConfig.models[0]?.model,
            "execution.environment": "container",
            "runtime.type": this.runtime.constructor.name,
            "container.image": this.image,
          });

          return this._runInternalContainer(prompt, triggerInfo, span);
        },
        {},
        SpanKind.INTERNAL
      );
    } catch (err: any) {
      // withSpan failed before _runInternalContainer could run its cleanup.
      // Reset _running to avoid a permanent ghost runner state.
      this._running = false;
      this.logger.error({ err }, "container run setup failed");
      return { result: "error", triggers: [] };
    }
  }

  private async _runInternalContainer(prompt: string, triggerInfo?: { type: 'schedule' | 'manual' | 'webhook' | 'agent'; source?: string }, parentSpan?: any): Promise<RunOutcome> {
    this._returnValue = undefined;
    this._tokenUsage = undefined;
    const runReason = triggerInfo
      ? (triggerInfo.source
        ? (triggerInfo.type === 'agent' ? `triggered by ${triggerInfo.source}` : `${triggerInfo.type} (${triggerInfo.source})`)
        : triggerInfo.type)
      : undefined;
    this.statusTracker?.startRun(this.agentConfig.name, runReason);
    this.statusTracker?.registerInstance({
      id: this.instanceId,
      agentName: this.agentConfig.name,
      status: "running",
      startedAt: new Date(),
      trigger: triggerInfo?.source ? `${triggerInfo.type}:${triggerInfo.source}` : (triggerInfo?.type ?? "manual"),
    });

    if (triggerInfo) {
      const triggerDetails = triggerInfo.type === 'agent' && triggerInfo.source 
        ? `${triggerInfo.type} (${triggerInfo.source})` 
        : triggerInfo.type;
      this.logger.info(`Starting ${this.agentConfig.name} container run (triggered by ${triggerDetails})`);
      this.statusTracker?.addLogLine(this.agentConfig.name, `${this.instanceId} started (${triggerDetails})`);
    } else {
      this.logger.info(`Starting ${this.agentConfig.name} container run`);
      this.statusTracker?.addLogLine(this.agentConfig.name, `${this.instanceId} started (manual)`);
    }
    const runStartTime = Date.now();
    let runError: string | undefined;
    let runResult: RunResult = "error";

    const shutdownSecret = randomUUID();
    let credentials: RuntimeCredentials | undefined;
    let containerName: string | undefined;

    try {
      const timeout = this.agentConfig.timeout ?? this.globalConfig.local?.timeout ?? DEFAULT_AGENT_TIMEOUT;

      // Resolve credential refs — include provider keys for all models in the chain
      const credRefs = [...new Set(this.agentConfig.credentials)];
      for (const mc of this.agentConfig.models) {
        if (mc.authType === "pi_auth") continue;
        const providerKey = `${mc.provider}_key`;
        if (!credRefs.some((r) => r === providerKey || r.startsWith(`${providerKey}:`))) {
          credRefs.push(providerKey);
        }
      }

      // Let the runtime prepare credentials in its native way
      credentials = await this.runtime.prepareCredentials(credRefs);

      // Build env vars — only pass the dynamic prompt suffix.
      // Static content (agent config, SKILL.md, prompt skeleton, timeout)
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

      // Set cloud console URL for TUI display
      const taskUrl = this.runtime.getTaskUrl(containerName);
      if (taskUrl) {
        this.statusTracker?.setTaskUrl(this.agentConfig.name, taskUrl);
      }

      this.logger.info({ container: containerName }, "container launched");

      // Monitor the container (stream logs, wait for exit, cleanup)
      ({ runResult, runError } = await this.monitorContainer({
        containerName,
        shutdownSecret,
        timeout,
        credentials,
        parentSpan,
      }));
      // monitorContainer already cleaned up credentials and container
      credentials = undefined;
      containerName = undefined;
    } catch (err: any) {
      this.logger.error({ err }, `${this.agentConfig.name} container run failed`);
      runError = String(err?.message || err).slice(0, 200);
      // If we failed before monitorContainer ran, clean up what we have
      if (credentials) {
        this.runtime.cleanupCredentials(credentials);
      }
      if (containerName) {
        await this.runtime.remove(containerName).catch(() => {});
      }
      this._containerName = undefined;
    } finally {
      const elapsed = Date.now() - runStartTime;
      const instanceStatus = this._aborting ? "killed" as const : runError ? "error" as const : "completed" as const;
      this.statusTracker?.completeInstance(this.instanceId, instanceStatus);
      this.statusTracker?.endRun(this.agentConfig.name, elapsed, runError, this._tokenUsage);
      this._running = false;
    }
    return { result: runResult, triggers: [], returnValue: this._returnValue, usage: this._tokenUsage };
  }
}
