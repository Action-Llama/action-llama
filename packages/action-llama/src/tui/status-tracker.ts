import { EventEmitter } from "events";
import type { AgentInstance } from "../scheduler/types.js";
import type { TokenUsage } from "../shared/usage.js";
import { addTokenUsage, zeroTokenUsage } from "../shared/usage.js";
import { AgentLifecycle } from "../execution/lifecycle/agent-lifecycle.js";
import { InstanceLifecycle } from "../execution/lifecycle/instance-lifecycle.js";

export interface AgentStatus {
  name: string;
  description?: string;
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
  locks?: Array<{ resourceKey: string; heldSince: number; }>; // resource locks held by this agent
}

export interface SchedulerInfo {
  mode: "docker" | "host";
  runtime?: "local" | "vps";  // only meaningful when mode === "docker"
  projectName?: string;
  gatewayPort: number | null;
  cronJobCount: number;
  webhooksActive: boolean;
  webhookUrls: string[];
  dashboardUrl?: string;
  startedAt: Date;
  paused: boolean;
  initializing?: boolean;
}

export interface LogLine {
  timestamp: Date;
  agent: string;
  message: string;
}

export interface InvalidationSignal {
  type: "runs" | "triggers" | "stats" | "instance" | "config";
  agent?: string;
  instanceId?: string;
}

export class StatusTracker extends EventEmitter {
  private agents = new Map<string, AgentStatus>();
  private agentLifecycles = new Map<string, AgentLifecycle>();
  private schedulerInfo: SchedulerInfo | null = null;
  private recentLogs: LogLine[] = [];
  private maxLogs = 100;
  private _baseImageStatus: string | null = null;
  private instances: Map<string, AgentInstance> = new Map();
  private pendingInvalidations: InvalidationSignal[] = [];

  private invalidate(signal: InvalidationSignal): void {
    const isDup = this.pendingInvalidations.some(
      (s) =>
        s.type === signal.type &&
        s.agent === signal.agent &&
        s.instanceId === signal.instanceId,
    );
    if (!isDup) {
      this.pendingInvalidations.push(signal);
    }
  }

  flushInvalidations(): InvalidationSignal[] {
    const signals = this.pendingInvalidations;
    this.pendingInvalidations = [];
    return signals;
  }

  registerAgent(name: string, scale = 1, description?: string): void {
    // Create AgentLifecycle and listen to its events
    const lifecycle = new AgentLifecycle(name);
    this.agentLifecycles.set(name, lifecycle);
    
    // Listen to lifecycle events to update UI
    lifecycle.on("agent:instance-start", () => this.emit("update"));
    lifecycle.on("agent:instance-end", () => this.emit("update"));
    lifecycle.on("agent:build-start", () => this.emit("update"));
    lifecycle.on("agent:build-complete", () => this.emit("update"));
    lifecycle.on("agent:error", () => this.emit("update"));
    lifecycle.on("agent:error-cleared", () => this.emit("update"));
    lifecycle.on("transition", () => this.emit("update"));

    this.agents.set(name, {
      name,
      description,
      state: lifecycle.getState(),
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
      locks: [],
    });
    this.emit("update");
  }

  unregisterAgent(name: string): void {
    // Clean up lifecycle
    const lifecycle = this.agentLifecycles.get(name);
    if (lifecycle) {
      lifecycle.removeAllListeners();
      this.agentLifecycles.delete(name);
    }
    
    this.agents.delete(name);
    this.emit("update");
  }

  setAgentState(name: string, state: "idle" | "running" | "building" | "error"): void {
    const agent = this.agents.get(name);
    if (!agent) return;
    
    // Direct state management for backward compatibility
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

    agent.runningCount += 1;
    agent.state = "running";
    agent.statusText = null;
    agent.lastError = null;
    agent.taskUrl = null;
    agent.runReason = reason ?? null;
    this.invalidate({ type: "runs", agent: name });
    this.invalidate({ type: "triggers" });
    this.invalidate({ type: "stats", agent: name });
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
    this.invalidate({ type: "runs", agent: name });
    this.invalidate({ type: "stats", agent: name });
    this.emit("update");
  }

  setTaskUrl(name: string, url: string | null): void {
    const agent = this.agents.get(name);
    if (!agent) return;
    agent.taskUrl = url;
    this.emit("update");
  }

  setAgentDescription(name: string, description: string | undefined): void {
    const agent = this.agents.get(name);
    if (!agent) return;
    agent.description = description;
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
    this.invalidate({ type: "runs", agent: name });
    this.invalidate({ type: "stats", agent: name });
    this.emit("update");
  }

  setQueuedWebhooks(name: string, count: number): void {
    const agent = this.agents.get(name);
    if (!agent) return;
    agent.queuedWebhooks = count;
    this.invalidate({ type: "triggers" });
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
    this.invalidate({ type: "config" });
    this.emit("update");
    this.emit("agent-enabled", name);
  }

  disableAgent(name: string): void {
    const agent = this.agents.get(name);
    if (!agent) return;
    agent.enabled = false;
    agent.nextRunAt = null; // Clear next run time when disabled
    this.invalidate({ type: "config" });
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
   * Unregister an agent instance (remove completely)
   */
  unregisterInstance(id: string): void {
    this.instances.delete(id);
    this.emit("update");
  }

  /**
   * Update an instance's status (e.g. running -> completed)
   */
  completeInstance(id: string, status: 'completed' | 'error' | 'killed'): void {
    const inst = this.instances.get(id);
    if (!inst) return;
    inst.status = status;
    this.invalidate({ type: "instance", agent: inst.agentName, instanceId: id });
    this.invalidate({ type: "runs", agent: inst.agentName });
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

  /**
   * Update an agent's scale (runtime only - does not persist to config)
   */
  updateAgentScale(name: string, scale: number): void {
    const agent = this.agents.get(name);
    if (!agent) return;
    agent.scale = scale;
    // If the scale is reduced below current running count, we don't kill instances
    // The pool will naturally adjust on next run
    this.invalidate({ type: "config" });
    this.emit("update");
    this.emit("agent-scale-changed", name, scale);
  }

  /**
   * Get an agent's current scale
   */
  getAgentScale(name: string): number {
    const agent = this.agents.get(name);
    return agent?.scale ?? 1;
  }

  /**
   * Get an agent's lifecycle instance
   */
  getAgentLifecycle(name: string): AgentLifecycle | undefined {
    return this.agentLifecycles.get(name);
  }

  /**
   * Start build process for an agent
   */
  startBuild(name: string, reason?: string): void {
    const agent = this.agents.get(name);
    const lifecycle = this.agentLifecycles.get(name);
    if (!agent || !lifecycle) return;

    lifecycle.startBuild(reason);
    agent.state = lifecycle.getState();
    this.emit("update");
  }

  /**
   * Complete build process for an agent
   */
  completeBuild(name: string): void {
    const agent = this.agents.get(name);
    const lifecycle = this.agentLifecycles.get(name);
    if (!agent || !lifecycle) return;

    lifecycle.completeBuild();
    agent.state = lifecycle.getState();
    this.emit("update");
  }

  /**
   * Create a new instance with lifecycle tracking
   */
  createInstance(instanceId: string, agentName: string, trigger: string): InstanceLifecycle | null {
    const lifecycle = this.agentLifecycles.get(agentName);
    if (!lifecycle) return null;

    const instanceLifecycle = new InstanceLifecycle(instanceId, agentName, trigger);
    lifecycle.addInstance(instanceLifecycle);

    // Listen to instance events to update the UI.
    // Note: We do NOT update agent.runningCount or agent.state here because
    // the runners' startRun()/endRun() calls are the authoritative source for
    // those fields. Updating both would double-count (the lifecycle increments
    // on instance:start, and startRun() also increments — for scale>1 agents
    // this caused "running 2/2" when only 1 instance was actually started).
    instanceLifecycle.on("instance:start", () => {
      this.emit("update");
    });

    instanceLifecycle.on("instance:complete", () => {
      this.emit("update");
    });

    instanceLifecycle.on("instance:error", () => {
      this.emit("update");
    });

    instanceLifecycle.on("instance:kill", () => {
      this.emit("update");
    });

    return instanceLifecycle;
  }
}
