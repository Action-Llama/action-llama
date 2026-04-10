/**
 * TransportAgentRunner — runs Pi sessions in the scheduler process,
 * driving a remote runtime via a Transport.
 *
 * Replaces ContainerAgentRunner for the centralized architecture where:
 *  - The scheduler is the "brain" (LLM session, tool orchestration)
 *  - The runtime is the "body" (filesystem, shell, credentials)
 *  - The transport connects them (DockerExecTransport, SshTransport, etc.)
 *
 * Key differences from ContainerAgentRunner:
 *  - Pi session runs in-process (not inside the container)
 *  - Events are captured directly (no JSON log parsing)
 *  - Credentials staged via transport (no volume mounts needed)
 *  - No gateway registration (direct access to scheduler services)
 *  - No signal files (scheduler tools handle reruns, returns, etc.)
 */

import { randomBytes } from "crypto";
import { execFileSync } from "child_process";
import { getModel } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
  ModelRegistry,
} from "@mariozechner/pi-coding-agent";
import type { AgentConfig, GlobalConfig } from "../shared/config.js";
import type { Logger } from "../shared/logger.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { TokenUsage } from "../shared/usage.js";
import { sessionStatsToUsage } from "../shared/usage.js";
import type { RunResult, RunOutcome } from "./types.js";
import type { PoolRunner } from "../execution/runner-pool.js";
import { DEFAULT_AGENT_TIMEOUT } from "../shared/constants.js";
import { ModelCircuitBreaker, selectAvailableModels, isRateLimitError } from "./model-fallback.js";
import { DockerExecTransport } from "../transport/docker-exec.js";
import { SshTransport } from "../transport/ssh.js";
import { HostUserTransport } from "../transport/host-user.js";
import { createTransportTools } from "../transport/operations.js";
import type { Transport } from "../transport/transport.js";
import { writeFile } from "../transport/transport.js";
import { parseCredentialRef, getDefaultBackend } from "../shared/credentials.js";
import { parseFrontmatter } from "../shared/frontmatter.js";
import { withSpan } from "../telemetry/index.js";
import { SpanKind } from "@opentelemetry/api";
import type { SchedulerToolsOpts } from "./scheduler-tools.js";
import { createSchedulerTools } from "./scheduler-tools.js";
import type { WaitFilter, WaitingRegistry, WaitingInstance } from "../execution/waiting-registry.js";
import { DEFAULT_WAIT_TIMEOUT } from "../shared/constants.js";

const MAX_MODEL_PASSES = 3;
const DEFAULT_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 300_000;
const CONTAINER_CWD = "/tmp";

export interface TransportAgentRunnerOpts {
  globalConfig: GlobalConfig;
  agentConfig: AgentConfig;
  logger: Logger;
  circuitBreaker: ModelCircuitBreaker;
  statusTracker?: StatusTracker;
  /** Base Docker image to use for provisioning containers. */
  baseImage: string;
  /** Project path on the host, for reading SKILL.md and config. */
  projectPath: string;
  /** Provider API keys (provider name → key). */
  providerKeys?: Map<string, string>;
  /** Scheduler tools dependencies. When provided, agents get lock/call/status tools. */
  schedulerToolsDeps?: Omit<SchedulerToolsOpts, "agentName" | "instanceId" | "depth" | "onReturnValue">;
  /** Waiting registry for suspend/resume support. */
  waitingRegistry?: WaitingRegistry;
  /** Callback when instance transitions to/from waiting state. */
  onWaitStateChange?: (instanceId: string, state: "waiting" | "resumed") => void;
}

export class TransportAgentRunner implements PoolRunner {
  private _running = false;
  private _suspended = false;
  private _aborting = false;
  private _transport: Transport | null = null;
  private _containerName: string | null = null;
  private _session: any = null;
  private _turnTextBuffer = "";
  private _turnThinkingBuffer = "";

  public instanceId: string;
  /** Trigger depth for subagent call tracking. Set by the scheduler before run(). */
  public depth = 0;

  private globalConfig: GlobalConfig;
  private agentConfig: AgentConfig;
  private baseLogger: Logger;
  private logger: Logger;
  private circuitBreaker: ModelCircuitBreaker;
  private statusTracker?: StatusTracker;
  private baseImage: string;
  private projectPath: string;
  private providerKeys: Map<string, string>;
  private schedulerToolsDeps?: Omit<SchedulerToolsOpts, "agentName" | "instanceId" | "depth" | "onReturnValue">;
  private waitingRegistry?: WaitingRegistry;
  private onWaitStateChange?: (instanceId: string, state: "waiting" | "resumed") => void;

  constructor(opts: TransportAgentRunnerOpts) {
    this.globalConfig = opts.globalConfig;
    this.agentConfig = opts.agentConfig;
    this.baseLogger = opts.logger;
    this.logger = opts.logger;
    this.circuitBreaker = opts.circuitBreaker;
    this.statusTracker = opts.statusTracker;
    this.baseImage = opts.baseImage;
    this.projectPath = opts.projectPath;
    this.providerKeys = opts.providerKeys ?? new Map();
    this.schedulerToolsDeps = opts.schedulerToolsDeps;
    this.waitingRegistry = opts.waitingRegistry;
    this.onWaitStateChange = opts.onWaitStateChange;
    this.instanceId = opts.agentConfig.name;
  }

  get isRunning(): boolean {
    return this._running;
  }

  setAgentConfig(config: AgentConfig): void {
    this.agentConfig = config;
  }

  get isSuspended(): boolean {
    return this._suspended;
  }

  abort(): void {
    this._aborting = true;
    this.logger.info("Transport agent runner abort requested");

    // Dispose the Pi session to stop the LLM loop
    if (this._session) {
      try { this._session.dispose(); } catch { /* best effort */ }
    }

    // Unpause container first if suspended, then kill
    if (this._containerName) {
      if (this._suspended) {
        try {
          execFileSync("docker", ["unpause", this._containerName], {
            timeout: 10_000,
            stdio: ["pipe", "pipe", "pipe"],
          });
        } catch { /* container may not be paused */ }
      }
      try {
        execFileSync("docker", ["kill", this._containerName], {
          timeout: 10_000,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch { /* container may already be dead */ }
    }

    // Close the transport
    if (this._transport) {
      this._transport.close().catch(() => {});
    }
  }

  async run(
    prompt: string,
    triggerInfo?: { type: 'schedule' | 'manual' | 'webhook' | 'agent'; source?: string },
    instanceId?: string,
  ): Promise<RunOutcome> {
    if (this._running) {
      this.logger.warn(`${this.agentConfig.name} is already running, skipping`);
      return { result: "error", triggers: [] };
    }

    this._running = true;
    this._aborting = false;
    this.instanceId = instanceId ?? `${this.agentConfig.name}-${randomBytes(4).toString("hex")}`;
    this.logger = this.baseLogger.child({ instance: this.instanceId });

    try {
      return await withSpan(
        "transport_agent.run",
        async (span) => {
          span.setAttributes({
            "agent.name": this.agentConfig.name,
            "agent.run_id": this.instanceId,
            "agent.trigger_type": triggerInfo?.type || "manual",
            "agent.trigger_source": triggerInfo?.source || "",
            "agent.model_provider": this.agentConfig.models[0]?.provider,
            "agent.model_name": this.agentConfig.models[0]?.model,
            "execution.environment": "transport",
          });

          return this.runInternal(prompt, triggerInfo, span);
        },
        {},
        SpanKind.INTERNAL,
      );
    } catch (err: any) {
      this._running = false;
      this.logger.error({ err }, "transport run setup failed");
      return { result: "error", triggers: [] };
    }
  }

  private async runInternal(
    prompt: string,
    triggerInfo?: { type: 'schedule' | 'manual' | 'webhook' | 'agent'; source?: string },
    parentSpan?: any,
  ): Promise<RunOutcome> {
    const runStartTime = Date.now();
    let runResult: RunResult = "error";
    let runError: string | undefined;
    let returnValue: string | undefined;
    let tokenUsage: TokenUsage | undefined;

    // Surface run start in TUI
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

    this.logger.info(`Starting ${this.agentConfig.name} transport run`);
    this.statusTracker?.addLogLine(this.agentConfig.name, `${this.instanceId} started (${runReason ?? "manual"})`);

    // ── Timeout — kill the entire run if it exceeds the configured limit ──
    const timeoutSeconds = this.agentConfig.timeout ?? this.globalConfig.local?.timeout ?? DEFAULT_AGENT_TIMEOUT;
    const timeoutTimer = setTimeout(() => {
      this.logger.error({ timeoutSeconds }, "agent timeout reached, aborting");
      this.abort();
    }, timeoutSeconds * 1000);
    timeoutTimer.unref();

    try {
      // ── 1–2. Provision runtime & connect transport ──────────
      const transport = await this.createTransport();
      this._transport = transport;

      // ── 3. Stage credentials ─────────────────────────────────
      const providerKeys = await this.stageCredentials(transport);
      // Merge with pre-configured provider keys
      for (const [k, v] of this.providerKeys) {
        if (!providerKeys.has(k)) providerKeys.set(k, v);
      }

      // ── 4. Run hooks.pre ─────────────────────────────────────
      if (this.agentConfig.hooks?.pre && this.agentConfig.hooks.pre.length > 0) {
        for (const hook of this.agentConfig.hooks.pre) {
          this.logger.info({ hook }, "running pre hook via transport");
          await transport.exec(hook);
        }
      }

      // ── 5. Build SKILL.md and prompt ─────────────────────────
      // Read SKILL.md from the project directory on the host
      const { readFileSync, existsSync } = await import("fs");
      const { join } = await import("path");
      const skillPath = join(this.projectPath, "agents", this.agentConfig.name, "SKILL.md");
      let skillBody = "";
      if (existsSync(skillPath)) {
        const { body } = parseFrontmatter(readFileSync(skillPath, "utf-8"));
        skillBody = body;
      }

      // Process context injection (runs commands on the transport)
      // TODO: In the future, context injection should execute on the transport
      // For now, we skip it since the commands won't have access to the runtime

      // ── 6. Create Pi session with transport tools ────────────
      const result = await this.runPiSession(prompt, skillBody, transport, providerKeys);
      runResult = result.result;
      returnValue = result.returnValue;
      tokenUsage = result.usage;
      runError = result.error;

      // ── 7. Run hooks.post ────────────────────────────────────
      if (this.agentConfig.hooks?.post && this.agentConfig.hooks.post.length > 0) {
        for (const hook of this.agentConfig.hooks.post) {
          this.logger.info({ hook }, "running post hook via transport");
          try {
            await transport.exec(hook);
          } catch (err: any) {
            this.logger.error({ err }, "post hook failed");
          }
        }
      }
    } catch (err: any) {
      this.logger.error({ err }, `${this.agentConfig.name} transport run failed`);
      runError = String(err?.message || err).slice(0, 200);
    } finally {
      clearTimeout(timeoutTimer);

      // ── 8. Cleanup ───────────────────────────────────────────
      if (this._transport) {
        try { await this._transport.close(); } catch { /* best effort */ }
        this._transport = null;
      }
      if (this._containerName) {
        try {
          execFileSync("docker", ["rm", "-f", this._containerName], {
            timeout: 10_000,
            stdio: ["pipe", "pipe", "pipe"],
          });
        } catch { /* best effort */ }
        this._containerName = null;
      }

      const elapsed = Date.now() - runStartTime;
      const instanceStatus = this._aborting ? "killed" as const : runError ? "error" as const : "completed" as const;
      this.statusTracker?.completeInstance(this.instanceId, instanceStatus);
      this.statusTracker?.endRun(this.agentConfig.name, elapsed, runError, tokenUsage);

      const elapsedStr = (elapsed / 1000).toFixed(1);
      const turnInfo = tokenUsage?.turnCount != null ? `, ${tokenUsage.turnCount} turns` : "";
      const costInfo = tokenUsage?.cost != null ? `, $${tokenUsage.cost.toFixed(4)}` : "";
      const errInfo = runError ? ` — ${runError.slice(0, 100)}` : "";
      this.statusTracker?.addLogLine(this.agentConfig.name, `${this.instanceId} ${runResult} (${elapsedStr}s${turnInfo}${costInfo})${errInfo}`);

      this.logger.info({
        result: runResult,
        elapsed: `${elapsedStr}s`,
        hasReturnValue: !!returnValue,
        turnCount: tokenUsage?.turnCount,
        totalTokens: tokenUsage?.totalTokens,
        cost: tokenUsage?.cost,
        error: runError,
      }, "run outcome");

      if (parentSpan) {
        parentSpan.setAttributes({
          "execution.result": runResult,
          "execution.has_return_value": !!returnValue,
        });
        if (tokenUsage) {
          parentSpan.setAttributes({
            "llm.token.input": tokenUsage.inputTokens,
            "llm.token.output": tokenUsage.outputTokens,
            "llm.token.total": tokenUsage.totalTokens,
            "llm.cost.total": tokenUsage.cost,
            "llm.turns": tokenUsage.turnCount,
          });
        }
        if (runResult === "error") {
          parentSpan.recordException(new Error(`Transport execution failed: ${runError || "Unknown error"}`));
        }
      }

      this._running = false;
    }

    return {
      result: runResult,
      triggers: [],
      returnValue,
      usage: tokenUsage,
      exitReason: runError,
    };
  }

  /**
   * Handle a wait_for_trigger call from the agent.
   * Suspends the container, registers in the waiting registry, and returns
   * a promise that resolves when a matching trigger arrives.
   */
  private async _handleWait(filter: WaitFilter, timeoutMs: number, transport: Transport): Promise<any> {
    if (!this.waitingRegistry) {
      throw new Error("Waiting registry not available");
    }

    const runtimeType = this.agentConfig.runtime?.type ?? "container";
    const deadline = Date.now() + timeoutMs;

    // Disconnect transport and pause container
    await transport.close();
    this._suspended = true;

    if (runtimeType === "container" && this._containerName) {
      try {
        execFileSync("docker", ["pause", this._containerName], {
          timeout: 10_000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        this.logger.info({ container: this._containerName }, "container paused for wait");
      } catch (err: any) {
        this.logger.warn({ err: err.message }, "failed to pause container");
      }
    }

    // Notify status tracker
    this.statusTracker?.setInstanceWaiting(this.instanceId);
    this.onWaitStateChange?.(this.instanceId, "waiting");

    return new Promise<any>((resolve, reject) => {
      const entry: WaitingInstance = {
        instanceId: this.instanceId,
        agentName: this.agentConfig.name,
        filter,
        deadline,
        registeredAt: Date.now(),
        runId: this._containerName ?? this.instanceId,
        runtimeType,
        cwd: CONTAINER_CWD,
        resolve: async (payload: any) => {
          // Resume: unpause container, reconnect transport
          try {
            await this._resumeFromWait(transport);
            resolve(payload);
          } catch (err) {
            reject(err);
          }
        },
        reject: (err: Error) => {
          // Timeout or kill — still need to clean up
          this._suspended = false;
          this.onWaitStateChange?.(this.instanceId, "resumed");
          reject(err);
        },
      };

      this.waitingRegistry!.register(entry);
      this.logger.info({ filter, deadline: new Date(deadline).toISOString() }, "instance registered for wait");
    });
  }

  /**
   * Resume from a suspended wait state: unpause container and reconnect transport.
   */
  private async _resumeFromWait(transport: Transport): Promise<void> {
    const runtimeType = this.agentConfig.runtime?.type ?? "container";

    if (runtimeType === "container" && this._containerName) {
      try {
        execFileSync("docker", ["unpause", this._containerName], {
          timeout: 10_000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        this.logger.info({ container: this._containerName }, "container unpaused after wait");
      } catch (err: any) {
        this.logger.warn({ err: err.message }, "failed to unpause container");
      }
    }

    // Reconnect the transport
    await transport.connect();
    this._suspended = false;

    this.statusTracker?.resumeInstance(this.instanceId);
    this.onWaitStateChange?.(this.instanceId, "resumed");
    this.logger.info("transport reconnected after wait resume");
  }

  /**
   * Create and connect the appropriate transport based on the agent's runtime config.
   */
  private async createTransport(): Promise<Transport> {
    const runtimeType = this.agentConfig.runtime?.type ?? "container";

    switch (runtimeType) {
      case "ssh": {
        const rt = this.agentConfig.runtime!;
        if (!rt.host) throw new Error("SSH runtime requires 'host' in [runtime] config");
        const transport = new SshTransport({
          host: rt.host,
          port: rt.port,
          user: rt.user,
          keyPath: rt.key_path,
          cwd: rt.cwd,
          sshOptions: rt.ssh_options,
        });
        await transport.connect();
        this.logger.debug({ host: rt.host, user: rt.user }, "SSH transport connected");
        return transport;
      }

      case "host-user": {
        const rt = this.agentConfig.runtime ?? {};
        const user = rt.run_as ?? "al-agent";
        const transport = new HostUserTransport({
          user,
          groups: rt.groups,
          cwd: rt.cwd,
        });
        await transport.connect();
        this.logger.debug({ user }, "Host-user transport connected");
        return transport;
      }

      case "container":
      default: {
        const containerName = await this.provisionContainer();
        this._containerName = containerName;
        const transport = new DockerExecTransport({
          container: containerName,
          cwd: CONTAINER_CWD,
        });
        await transport.connect();
        this.logger.debug({ container: containerName }, "Docker transport connected");
        return transport;
      }
    }
  }

  /**
   * Provision a Docker container that stays alive for the transport to connect to.
   * Returns the container name.
   */
  private async provisionContainer(): Promise<string> {
    const runId = randomBytes(4).toString("hex");
    const containerName = `al-${this.agentConfig.name}-${runId}`;
    const memory = this.globalConfig.local?.memory || "4g";

    // Build agent-specific image if a Dockerfile exists, otherwise use base
    const { ensureAgentImage } = await import("../docker/image.js");
    const image = await ensureAgentImage(
      this.agentConfig.name,
      this.projectPath,
      this.baseImage,
      (msg) => {
        this.logger.debug(msg);
        this.statusTracker?.addLogLine(this.agentConfig.name, msg);
      },
    );

    // Ensure the image is available locally
    this.ensureImageAvailable(image);

    const args = [
      "run", "-d",
      "--name", containerName,
      "--tmpfs", "/tmp:rw,exec,nosuid",
      "--tmpfs", "/credentials:rw,nosuid,nodev,noexec",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges:true",
      "--memory", memory,
    ];

    if (this.globalConfig.local?.cpus) {
      args.push("--cpus", String(this.globalConfig.local.cpus));
    }

    // Keep the container alive with tail -f /dev/null
    args.push(image, "tail", "-f", "/dev/null");

    execFileSync("docker", args, {
      timeout: 30_000,
      encoding: "utf-8",
    });

    this.logger.debug({ container: containerName }, "container provisioned");
    return containerName;
  }

  /**
   * Ensure a Docker image is available locally. If not, attempt to pull it.
   */
  private ensureImageAvailable(image: string): void {
    try {
      execFileSync("docker", ["image", "inspect", image], {
        timeout: 10_000,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      // Image not found locally — try to pull
      this.logger.debug({ image }, "image not found locally, pulling...");
      try {
        execFileSync("docker", ["pull", image], {
          timeout: 120_000,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (pullErr: any) {
        throw new Error(`Base image "${image}" not found and pull failed: ${pullErr.message}`);
      }
    }
  }

  /**
   * Stage credentials onto the runtime via the transport.
   * Returns a map of provider → API key for Pi session auth.
   */
  private async stageCredentials(transport: Transport): Promise<Map<string, string>> {
    const providerKeys = new Map<string, string>();
    const credRefs = [...new Set(this.agentConfig.credentials ?? [])];

    // Add provider keys for all configured models
    for (const mc of this.agentConfig.models) {
      if (mc.authType === "pi_auth") continue;
      const providerKey = `${mc.provider}_key`;
      if (!credRefs.some((r) => r === providerKey || r.startsWith(`${providerKey}:`))) {
        credRefs.push(providerKey);
      }
    }

    if (credRefs.length === 0) return providerKeys;

    // For host-user runtime, stage credentials to a temp dir (not /credentials which is root-only).
    // For container runtimes, /credentials is inside the container filesystem.
    const runtimeType = this.agentConfig.runtime?.type ?? "container";
    const isHostUser = runtimeType === "host-user";
    const credBase = isHostUser
      ? `/tmp/al-creds-${randomBytes(4).toString("hex")}`
      : "/credentials";

    const backend = getDefaultBackend();
    const credFiles = new Map<string, Buffer>();

    for (const credRef of credRefs) {
      const { type, instance } = parseCredentialRef(credRef);
      const fields = await backend.readAll(type, instance);
      if (!fields) continue;

      for (const [field, value] of Object.entries(fields)) {
        // Stage credential file on the runtime
        const remotePath = `${credBase}/${type}/${instance}/${field}`;
        credFiles.set(remotePath, Buffer.from(value + "\n", "utf-8"));

        // Extract provider API keys for Pi session auth
        if (field === "api_key" || field === "token") {
          if (type.endsWith("_key")) {
            const provider = type.replace(/_key$/, "");
            providerKeys.set(provider, value);
          }
        }
      }
    }

    // Batch write all credential files
    if (credFiles.size > 0) {
      // Clean and recreate credential directory for a fresh state
      await transport.exec(`rm -rf ${credBase} 2>/dev/null; mkdir -p ${credBase}`);
      await transport.writeFiles(credFiles);
      await transport.exec(`find ${credBase} -type f -exec chmod 400 {} +`);
      this.logger.debug({ count: credFiles.size, credBase }, "credentials staged via transport");
    }

    return providerKeys;
  }

  /**
   * Run the Pi session in-process with transport-backed tools.
   */
  private async runPiSession(
    prompt: string,
    skillBody: string,
    transport: Transport,
    providerKeys: Map<string, string>,
  ): Promise<{ result: RunResult; returnValue?: string; usage?: TokenUsage; error?: string }> {
    const models = this.agentConfig.models;

    // Create resource loader with the skill body
    const agentsContent = skillBody || `# ${this.agentConfig.name} Agent\n\nCustom agent.\n`;
    const resourceLoader = new DefaultResourceLoader({
      noExtensions: true,
      agentsFilesOverride: () => ({
        agentsFiles: [
          { path: "/tmp/SKILL.md", content: agentsContent },
        ],
      }),
    });
    await resourceLoader.reload();

    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: true, maxRetries: 2 },
    });

    // Create transport-backed tools
    const tools = createTransportTools(transport, CONTAINER_CWD);

    // Create scheduler tools (locks, calls, status, return, wait) if deps provided
    let capturedReturnValue: string | undefined;
    const customTools = this.schedulerToolsDeps
      ? createSchedulerTools({
          ...this.schedulerToolsDeps,
          agentName: this.agentConfig.name,
          instanceId: this.instanceId,
          depth: this.depth,
          onReturnValue: (value) => { capturedReturnValue = value; },
          onWait: this.waitingRegistry ? (filter, timeoutMs) => this._handleWait(filter, timeoutMs, transport) : undefined,
          defaultWaitTimeout: this.agentConfig.waitTimeout ?? this.globalConfig.defaultWaitTimeout,
        })
      : undefined;

    let anyModelSucceeded = false;

    for (let pass = 0; pass <= MAX_MODEL_PASSES; pass++) {
      const availableModels = selectAvailableModels(models, this.circuitBreaker);
      let modelSucceeded = false;

      for (const modelConfig of availableModels) {
        if (this._aborting) {
          return { result: "error", error: "Aborted" };
        }

        const authStorage = AuthStorage.create();
        const providerKey = providerKeys.get(modelConfig.provider);
        if (providerKey) {
          authStorage.setRuntimeApiKey(modelConfig.provider, providerKey);
        }

        // Resolve model — either from built-in registry or custom provider with baseUrl
        let llmModel;
        let customModelRegistry: ModelRegistry | undefined;
        if (modelConfig.baseUrl) {
          // Create a model registry with the custom provider registered
          customModelRegistry = ModelRegistry.inMemory(authStorage);
          const providerName = `custom_${modelConfig.provider}`;
          // Register API key under custom provider name too
          if (providerKey) {
            authStorage.setRuntimeApiKey(providerName, providerKey);
          }
          customModelRegistry.registerProvider(providerName, {
            baseUrl: modelConfig.baseUrl,
            apiKey: providerKey || "dummy-key",
            models: [{
              id: modelConfig.model,
              name: modelConfig.model,
              api: "openai-completions" as any,
              reasoning: false,
              input: ["text" as const],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128000,
              maxTokens: 16384,
            }],
          });
          llmModel = customModelRegistry.find(providerName, modelConfig.model);
          if (!llmModel) {
            throw new Error(`Failed to register custom model ${modelConfig.provider}/${modelConfig.model} at ${modelConfig.baseUrl}`);
          }
        } else {
          llmModel = getModel(modelConfig.provider as any, modelConfig.model as any);
        }

        this.logger.debug({
          model: modelConfig.model,
          thinking: modelConfig.thinkingLevel,
          baseUrl: modelConfig.baseUrl,
        }, "creating Pi session with transport tools");

        const { session } = await createAgentSession({
          cwd: CONTAINER_CWD,
          model: llmModel,
          modelRegistry: customModelRegistry,
          thinkingLevel: modelConfig.thinkingLevel,
          authStorage,
          resourceLoader,
          tools,
          customTools,
          sessionManager: SessionManager.inMemory(),
          settingsManager,
        });

        this._session = session;

        // Subscribe to events for logging and status tracking
        this.subscribeToEvents(session);

        try {
          const state = session.state;
          this.logger.debug({
            promptLength: prompt.length,
            model: state?.model ? { id: state.model.id, provider: state.model.provider, api: state.model.api, baseUrl: state.model.baseUrl } : "NO MODEL",
            toolCount: state?.tools?.length ?? 0,
          }, "about to call session.prompt()");

          await session.prompt(prompt);
          this.flushTurnBuffers();

          const allMessages = session.state?.messages ?? [];
          const lastMsg = allMessages[allMessages.length - 1] as any;
          if (lastMsg?.stopReason === "error") {
            this.logger.error({
              errorMessage: lastMsg?.errorMessage ?? session.state?.errorMessage,
            }, "session.prompt() completed with error");
          }

          this.circuitBreaker.recordSuccess(modelConfig.provider, modelConfig.model);

          // Get usage stats
          const sessionStats = session.getSessionStats();
          const usage: TokenUsage = sessionStatsToUsage(sessionStats);

          this.logger.info({
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            turnCount: usage.turnCount,
            cost: usage.cost,
          }, "session completed");

          session.dispose();
          this._session = null;
          modelSucceeded = true;
          anyModelSucceeded = true;

          return { result: "completed", usage, returnValue: capturedReturnValue };
        } catch (promptErr: any) {
          const msg = String(promptErr?.message || promptErr || "");
          if (isRateLimitError(msg)) {
            this.circuitBreaker.recordFailure(modelConfig.provider, modelConfig.model);
            this.logger.warn({
              provider: modelConfig.provider,
              model: modelConfig.model,
            }, "rate limited, trying next model");
            session.dispose();
            this._session = null;
            continue;
          }
          session.dispose();
          this._session = null;
          return { result: "error", error: msg };
        }
      }

      if (modelSucceeded) break;

      if (pass < MAX_MODEL_PASSES) {
        const delayMs = Math.min(DEFAULT_BACKOFF_MS * Math.pow(2, pass), MAX_BACKOFF_MS);
        this.logger.warn({ pass: pass + 1, delayMs }, "all models exhausted, backing off");
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    if (!anyModelSucceeded) {
      this.logger.error("all models exhausted across all retry passes");
      return { result: "error", error: "All models exhausted — rate limited across all retries" };
    }

    return { result: "completed" };
  }

  /**
   * Subscribe to Pi session events and forward them to the logger and status tracker.
   * Since the session runs in-process, we get direct access to events.
   */
  private subscribeToEvents(session: any): void {
    session.subscribe((event: any) => {
      this.logger.debug({ eventType: event.type }, "session event");

      if (event.type === "tool_execution_start") {
        const toolName = String(event.toolName || "unknown");
        const summary = toolName === "bash"
          ? String(event.args?.command || "").slice(0, 200)
          : JSON.stringify(event.args ?? {}).slice(0, 200);
        this.logger.info({ toolName, summary }, "[tool]");
      }

      if (event.type === "tool_execution_end") {
        const toolName = String(event.toolName || "unknown");
        const resultStr = typeof event.result === "string"
          ? event.result
          : JSON.stringify(event.result);

        if (event.isError) {
          const errorSummary = resultStr.slice(0, 200);
          this.statusTracker?.setAgentError(this.agentConfig.name, errorSummary);
          this.logger.warn({ toolName, error: errorSummary }, "[error]");
        } else {
          this.logger.info({ toolName, summary: resultStr.slice(0, 200) }, "[result]");
        }
      }

      if (event.type === "text") {
        const text = String(event.text ?? event.content ?? "");
        if (text) this._turnTextBuffer += text;
      }

      if (event.type === "thinking") {
        const text = String(event.text ?? event.content ?? "");
        if (text) this._turnThinkingBuffer += text;
      }

      if (event.type === "turn_end") {
        this.flushTurnBuffers();
      }

      if (event.type === "error") {
        const err = (event as any).error;
        const errorMsg = err?.errorMessage
          || (typeof err === "string" ? err : null)
          || JSON.stringify(event);
        this.logger.error({ error: String(errorMsg).slice(0, 300) }, "[error]");
        this.statusTracker?.setAgentError(this.agentConfig.name, String(errorMsg).slice(0, 200));
      }
    });
  }

  /** Flush accumulated text/thinking buffers to the logger. */
  private flushTurnBuffers(): void {
    if (this._turnThinkingBuffer) {
      this.logger.info({ text: this._turnThinkingBuffer.slice(0, 500) }, "[thinking]");
      this._turnThinkingBuffer = "";
    }
    if (this._turnTextBuffer) {
      this.logger.info({ text: this._turnTextBuffer.slice(0, 500) }, "[text]");
      this._turnTextBuffer = "";
    }
  }
}
