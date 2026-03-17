import { EventEmitter } from "events";
import type { AgentInstance } from "../scheduler/types.js";
import type { TokenUsage } from "../shared/usage.js";
import { addTokenUsage, zeroTokenUsage } from "../shared/usage.js";

export interface AgentStatus {
  name: string;
  state: "idle" | "running" | "building" | "error";
  enabled: boolean;
  statusText: string | null;
  lastError: string | null;
  lastRunAt: Date | null;
  lastRunDuration: number | null; // ms
  nextRunAt: Date | null;
  queuedWebhooks: number;
  scale: number;        // total runner pool size
  runningCount: number; // how many runners are currently active
  taskUrl: string | null; // link to cloud task/execution (ECS or Cloud Run console)
  runReason: string | null; // why the agent is running (e.g. "schedule", "webhook", "rerun 2/10")
  lastRunUsage: TokenUsage | null;
  cumulativeUsage: TokenUsage | null;  // accumulated across all runs in this session
}

export interface SchedulerInfo {
  mode: "docker" | "host";
  runtime?: "local" | "cloud-run" | "ecs" | "vps";  // only meaningful when mode === "docker"
  gatewayPort: number | null;
  cronJobCount: number;
  webhooksActive: boolean;
  webhookUrls: string[];
  dashboardUrl?: string;
  startedAt: Date;
  paused: boolean;
}

export interface LogLine {
  timestamp: Date;
  agent: string;
  message: string;
}

export class StatusTracker extends EventEmitter {
  private agents = new Map<string, AgentStatus>();
  private schedulerInfo: SchedulerInfo | null = null;
  private recentLogs: LogLine[] = [];
  private maxLogs = 100;
  private _baseImageStatus: string | null = null;
  private instances: Map<string, AgentInstance> = new Map();

  registerAgent(name: string, scale = 1): void {
    this.agents.set(name, {
      name,
      state: "idle",
      enabled: scale > 0,
      statusText: null,
      lastError: null,
      lastRunAt: null,
      lastRunDuration: null,
      nextRunAt: null,
      queuedWebhooks: 0,
      scale,
      runningCount: 0,
      taskUrl: null,
      runReason: null,
      lastRunUsage: null,
      cumulativeUsage: null,
    });
    this.emit("update");
  }

  setAgentState(name: string, state: "idle" | "running" | "building" | "error"): void {
    const agent = this.agents.get(name);
    if (!agent) return;
    agent.state = state;
    if (state === "running") {
      agent.statusText = null;
      agent.lastError = null;
    }
    this.emit("update");
  }

  /** Increment running count and set state to running */
  startRun(name: string, reason?: string): void {
    const agent = this.agents.get(name);
    if (!agent) return;
    agent.runningCount = Math.min(agent.runningCount + 1, agent.scale);
    agent.state = "running";
    agent.statusText = null;
    agent.lastError = null;
    agent.taskUrl = null;
    agent.runReason = reason ?? null;
    this.emit("update");
  }

  /** Decrement running count and update state accordingly */
  endRun(name: string, durationMs: number, error?: string, usage?: TokenUsage): void {
    const agent = this.agents.get(name);
    if (!agent) return;
    agent.runningCount = Math.max(agent.runningCount - 1, 0);
    agent.lastRunAt = new Date();
    agent.lastRunDuration = durationMs;
    agent.statusText = null;
    agent.taskUrl = null;

    // Update token usage
    if (usage) {
      agent.lastRunUsage = usage;
      agent.cumulativeUsage = agent.cumulativeUsage
        ? addTokenUsage(agent.cumulativeUsage, usage)
        : usage;
    }

    if (error) {
      agent.lastError = error;
      agent.state = "error";
    } else if (agent.runningCount === 0) {
      agent.state = "idle";
      agent.runReason = null;
    }
    // If still running instances, keep state as "running"
    this.emit("update");
  }

  setTaskUrl(name: string, url: string | null): void {
    const agent = this.agents.get(name);
    if (!agent) return;
    agent.taskUrl = url;
    this.emit("update");
  }

  setAgentStatusText(name: string, text: string): void {
    const agent = this.agents.get(name);
    if (!agent) return;
    agent.statusText = text;
    this.emit("update");
  }

  setAgentError(name: string, error: string): void {
    const agent = this.agents.get(name);
    if (!agent) return;
    agent.lastError = error;
    this.emit("update");
  }

  completeRun(name: string, durationMs: number, error?: string): void {
    const agent = this.agents.get(name);
    if (!agent) return;
    agent.state = error ? "error" : "idle";
    agent.lastRunAt = new Date();
    agent.lastRunDuration = durationMs;
    agent.statusText = null;
    agent.runReason = null;
    if (error) {
      agent.lastError = error;
    }
    this.emit("update");
  }

  setQueuedWebhooks(name: string, count: number): void {
    const agent = this.agents.get(name);
    if (!agent) return;
    agent.queuedWebhooks = count;
    this.emit("update");
  }

  setNextRunAt(name: string, nextRunAt: Date | null): void {
    const agent = this.agents.get(name);
    if (!agent) return;
    agent.nextRunAt = nextRunAt;
    this.emit("update");
  }

  enableAgent(name: string): void {
    const agent = this.agents.get(name);
    if (!agent) return;
    agent.enabled = true;
    this.emit("update");
    this.emit("agent-enabled", name);
  }

  disableAgent(name: string): void {
    const agent = this.agents.get(name);
    if (!agent) return;
    agent.enabled = false;
    agent.nextRunAt = null; // Clear next run time when disabled
    this.emit("update");
    this.emit("agent-disabled", name);
  }

  isAgentEnabled(name: string): boolean {
    const agent = this.agents.get(name);
    return agent ? agent.enabled : false;
  }

  setSchedulerInfo(info: SchedulerInfo): void {
    this.schedulerInfo = info;
    this.emit("update");
  }

  addLogLine(agent: string, message: string): void {
    this.recentLogs.push({ timestamp: new Date(), agent, message });
    if (this.recentLogs.length > this.maxLogs) {
      this.recentLogs.shift();
    }
    this.emit("update");
  }

  getAllAgents(): AgentStatus[] {
    return Array.from(this.agents.values());
  }

  getSchedulerInfo(): SchedulerInfo | null {
    return this.schedulerInfo;
  }

  setBaseImageStatus(text: string | null): void {
    this._baseImageStatus = text;
    this.emit("update");
  }

  getBaseImageStatus(): string | null {
    return this._baseImageStatus;
  }

  getRecentLogs(n = 10): LogLine[] {
    return this.recentLogs.slice(-n);
  }

  /**
   * Register a running agent instance
   */
  registerInstance(instance: AgentInstance): void {
    this.instances.set(instance.id, instance);
    this.emit("update");
  }

  /**
   * Unregister an agent instance
   */
  unregisterInstance(id: string): void {
    this.instances.delete(id);
    this.emit("update");
  }

  /**
   * Get all running instances
   */
  getInstances(): AgentInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * Set scheduler paused state
   */
  setPaused(paused: boolean): void {
    if (this.schedulerInfo) {
      this.schedulerInfo.paused = paused;
      this.emit("update");
    }
  }

  /**
   * Get scheduler paused state
   */
  isPaused(): boolean {
    return this.schedulerInfo?.paused ?? false;
  }
}
