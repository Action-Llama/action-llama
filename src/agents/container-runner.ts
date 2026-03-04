import { spawn } from "child_process";
import { mkdtempSync, symlinkSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import type { GlobalConfig, AgentConfig } from "../shared/config.js";
import type { Logger } from "../shared/logger.js";
import { CREDENTIALS_DIR } from "../shared/paths.js";
import {
  launchContainer,
  removeContainer,
} from "../docker/container.js";
import type { StatusTracker } from "../tui/status-tracker.js";

export class ContainerAgentRunner {
  private _running = false;
  private globalConfig: GlobalConfig;
  private agentConfig: AgentConfig;
  private logger: Logger;
  private registerContainer: (secret: string, containerName: string) => void;
  private gatewayUrl: string;
  private projectPath: string;
  private statusTracker?: StatusTracker;

  constructor(
    globalConfig: GlobalConfig,
    agentConfig: AgentConfig,
    logger: Logger,
    registerContainer: (secret: string, containerName: string) => void,
    gatewayUrl: string,
    projectPath: string,
    statusTracker?: StatusTracker
  ) {
    this.globalConfig = globalConfig;
    this.agentConfig = agentConfig;
    this.logger = logger;
    this.registerContainer = registerContainer;
    this.gatewayUrl = gatewayUrl;
    this.projectPath = projectPath;
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
          this.statusTracker?.addLogLine(this.agentConfig.name, msg);
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

  private streamContainerLogs(containerName: string): { stop: () => void } {
    const proc = spawn("docker", ["logs", "-f", containerName], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let buffer = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        this.forwardLogLine(line);
      }
    });

    // Also capture stderr
    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        this.logger.warn({ stderr: text.slice(0, 500) }, "container stderr");
      }
    });

    return {
      stop: () => {
        // Flush remaining buffer
        if (buffer.trim()) {
          this.forwardLogLine(buffer);
        }
        proc.kill();
      },
    };
  }

  private waitForContainer(containerName: string, timeoutSeconds: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const proc = spawn("docker", ["wait", containerName], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      const timer = setTimeout(() => {
        proc.kill();
        spawn("docker", ["kill", containerName], { stdio: "ignore" });
        reject(new Error(`Container ${containerName} timed out after ${timeoutSeconds}s`));
      }, timeoutSeconds * 1000);

      proc.on("close", () => {
        clearTimeout(timer);
        resolve(parseInt(stdout.trim(), 10));
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
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

    const shutdownSecret = randomUUID();
    const stagingDir = mkdtempSync(join(tmpdir(), "al-creds-"));
    let containerName: string | undefined;
    let logStream: { stop: () => void } | undefined;

    try {
      const image = this.globalConfig.docker?.image || "al-agent:latest";
      const timeout = this.globalConfig.docker?.timeout || 3600;

      // Symlink credentials into staging dir
      // Always include anthropic-key
      const allCreds = new Set([...this.agentConfig.credentials, "anthropic-key"]);
      for (const cred of allCreds) {
        const src = resolve(CREDENTIALS_DIR, cred);
        const dst = join(stagingDir, cred);
        try {
          symlinkSync(src, dst);
        } catch (err: any) {
          this.logger.warn({ cred, err: err.message }, "failed to symlink credential");
        }
      }

      // Read AGENTS.md from disk and include it in the serialized config
      const agentsMdPath = resolve(this.projectPath, this.agentConfig.name, "AGENTS.md");
      const agentsMd = readFileSync(agentsMdPath, "utf-8");
      const configWithMd = { ...this.agentConfig, _agentsMd: agentsMd };

      containerName = launchContainer({
        image,
        agentName: this.agentConfig.name,
        agentConfig: JSON.stringify(configWithMd),
        shutdownSecret,
        gatewayUrl: this.gatewayUrl,
        prompt,
        credentialsStagingDir: stagingDir,
        memory: this.globalConfig.docker?.memory,
        cpus: this.globalConfig.docker?.cpus,
        timeout,
      });

      // Register container for shutdown endpoint
      this.registerContainer(shutdownSecret, containerName);

      this.logger.info({ container: containerName }, "container launched");

      // Stream logs in real-time
      logStream = this.streamContainerLogs(containerName);

      const startTime = Date.now();
      const exitCode = await this.waitForContainer(containerName, timeout);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      // Give the log stream a moment to flush
      await new Promise((r) => setTimeout(r, 500));
      logStream.stop();
      logStream = undefined;

      if (exitCode !== 0) {
        this.logger.error({ exitCode, elapsed: `${elapsed}s` }, "container exited with error");
      } else {
        this.logger.info({ exitCode, elapsed: `${elapsed}s` }, "container finished");
      }
    } catch (err: any) {
      this.logger.error({ err }, `${this.agentConfig.name} container run failed`);
    } finally {
      if (logStream) logStream.stop();
      // Clean up staging dir
      try {
        rmSync(stagingDir, { recursive: true, force: true });
      } catch { /* best effort */ }
      if (containerName) {
        removeContainer(containerName);
      }
      const elapsed = Date.now() - runStartTime;
      this.statusTracker?.completeRun(this.agentConfig.name, elapsed);
      this._running = false;
    }
  }
}
