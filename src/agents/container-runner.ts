import { readFileSync } from "fs";
import { resolve } from "path";
import { randomUUID } from "crypto";
import type { GlobalConfig, AgentConfig } from "../shared/config.js";
import type { Logger } from "../shared/logger.js";
import type { ContainerRuntime, RuntimeCredentials } from "../docker/runtime.js";
import type { ContainerRegistration } from "../gateway/types.js";
import type { StatusTracker } from "../tui/status-tracker.js";

export class ContainerAgentRunner {
  private _running = false;
  private runtime: ContainerRuntime;
  private globalConfig: GlobalConfig;
  private agentConfig: AgentConfig;
  private logger: Logger;
  private registerContainer: (secret: string, reg: ContainerRegistration) => void;
  private unregisterContainer: (secret: string) => void;
  private gatewayUrl: string;
  private projectPath: string;
  private image: string;
  private statusTracker?: StatusTracker;

  constructor(
    runtime: ContainerRuntime,
    globalConfig: GlobalConfig,
    agentConfig: AgentConfig,
    logger: Logger,
    registerContainer: (secret: string, reg: ContainerRegistration) => void,
    unregisterContainer: (secret: string) => void,
    gatewayUrl: string,
    projectPath: string,
    image: string,
    statusTracker?: StatusTracker
  ) {
    this.runtime = runtime;
    this.globalConfig = globalConfig;
    this.agentConfig = agentConfig;
    this.logger = logger;
    this.registerContainer = registerContainer;
    this.unregisterContainer = unregisterContainer;
    this.gatewayUrl = gatewayUrl;
    this.projectPath = projectPath;
    this.image = image;
    this.statusTracker = statusTracker;
  }

  get isRunning(): boolean {
    return this._running;
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

    // Detect [STATUS: <text>] in plain output
    const statusMatch = line.match(/\[STATUS:\s*([^\]]+)\]/);
    if (statusMatch) {
      this.statusTracker?.setAgentStatusText(this.agentConfig.name, statusMatch[1].trim());
    }

    if (line === "[SILENT]") {
      this.logger.info("no work to do");
      this.statusTracker?.addLogLine(this.agentConfig.name, "no work to do");
    }
  }

  async run(prompt: string): Promise<void> {
    if (this._running) {
      this.logger.warn(`${this.agentConfig.name} is already running, skipping`);
      return;
    }

    this._running = true;
    this.statusTracker?.setAgentState(this.agentConfig.name, "running");
    this.logger.info(`Starting ${this.agentConfig.name} container run`);
    const runStartTime = Date.now();
    let runError: string | undefined;

    const shutdownSecret = randomUUID();
    let credentials: RuntimeCredentials | undefined;
    let containerName: string | undefined;
    let logStream: { stop: () => void } | undefined;

    try {
      const timeout = this.globalConfig.local?.timeout || 3600;

      // Resolve credential refs — always include anthropic_key for non-pi_auth
      const credRefs = [...new Set(this.agentConfig.credentials)];
      if (this.agentConfig.model.authType !== "pi_auth") {
        if (!credRefs.includes("anthropic_key:default")) {
          credRefs.push("anthropic_key:default");
        }
      }

      // Let the runtime prepare credentials in its native way
      credentials = await this.runtime.prepareCredentials(credRefs);

      // Read PLAYBOOK.md from disk and include it in the serialized config
      const agentsMdPath = resolve(this.projectPath, this.agentConfig.name, "PLAYBOOK.md");
      const agentsMd = readFileSync(agentsMdPath, "utf-8");
      const configWithMd = { ...this.agentConfig, _agentsMd: agentsMd };

      // Build env vars — only include gateway info if the runtime needs it
      const env: Record<string, string> = {
        AGENT_CONFIG: JSON.stringify(configWithMd),
        PROMPT: prompt,
      };
      if (this.runtime.needsGateway) {
        env.GATEWAY_URL = this.gatewayUrl;
        env.SHUTDOWN_SECRET = shutdownSecret;
      }

      containerName = await this.runtime.launch({
        image: this.image,
        agentName: this.agentConfig.name,
        env,
        credentials,
        memory: this.globalConfig.local?.memory,
        cpus: this.globalConfig.local?.cpus,
      });

      // Register container with gateway for shutdown, credential serving, and log ingestion
      if (this.runtime.needsGateway) {
        const bundle = credentials.strategy === "volume" ? credentials.bundle : undefined;
        this.registerContainer(shutdownSecret, {
          containerName,
          credentials: bundle,
          onLogLine: (line) => this.forwardLogLine(line),
        });
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

      if (exitCode !== 0) {
        this.logger.error({ exitCode, elapsed: `${elapsed}s` }, "container exited with error");
        runError = `Container exited with code ${exitCode}`;
      } else {
        this.logger.info({ exitCode, elapsed: `${elapsed}s` }, "container finished");
      }
    } catch (err: any) {
      this.logger.error({ err }, `${this.agentConfig.name} container run failed`);
      runError = String(err?.message || err).slice(0, 200);
    } finally {
      if (logStream) logStream.stop();
      if (this.runtime.needsGateway) {
        this.unregisterContainer(shutdownSecret);
      }
      if (credentials) {
        this.runtime.cleanupCredentials(credentials);
      }
      if (containerName) {
        await this.runtime.remove(containerName);
      }
      const elapsed = Date.now() - runStartTime;
      this.statusTracker?.completeRun(this.agentConfig.name, elapsed, runError);
      this._running = false;
    }
  }
}
