import { EventEmitter } from "events";

export interface AgentStatus {
  name: string;
  state: "idle" | "running";
  statusText: string | null;
  lastRunAt: Date | null;
  lastRunDuration: number | null; // ms
  nextRunAt: Date | null;
}

export interface SchedulerInfo {
  mode: "docker" | "host";
  gatewayPort: number | null;
  cronJobCount: number;
  webhooksActive: boolean;
  webhookUrls: string[];
  startedAt: Date;
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

  registerAgent(name: string): void {
    this.agents.set(name, {
      name,
      state: "idle",
      statusText: null,
      lastRunAt: null,
      lastRunDuration: null,
      nextRunAt: null,
    });
    this.emit("update");
  }

  setAgentState(name: string, state: "idle" | "running"): void {
    const agent = this.agents.get(name);
    if (!agent) return;
    agent.state = state;
    if (state === "running") {
      agent.statusText = null;
    }
    this.emit("update");
  }

  setAgentStatusText(name: string, text: string): void {
    const agent = this.agents.get(name);
    if (!agent) return;
    agent.statusText = text;
    this.emit("update");
  }

  completeRun(name: string, durationMs: number): void {
    const agent = this.agents.get(name);
    if (!agent) return;
    agent.state = "idle";
    agent.lastRunAt = new Date();
    agent.lastRunDuration = durationMs;
    agent.statusText = null;
    this.emit("update");
  }

  setNextRunAt(name: string, nextRunAt: Date | null): void {
    const agent = this.agents.get(name);
    if (!agent) return;
    agent.nextRunAt = nextRunAt;
    this.emit("update");
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

  getRecentLogs(n = 10): LogLine[] {
    return this.recentLogs.slice(-n);
  }
}
