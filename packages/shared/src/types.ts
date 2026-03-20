export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;       // total cost in USD
  turnCount: number;  // number of assistant messages (LLM turns)
}

/**
 * Add two TokenUsage objects together
 */
export function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    cost: a.cost + b.cost,
    turnCount: a.turnCount + b.turnCount,
  };
}

/**
 * Create a zero TokenUsage object
 */
export function zeroTokenUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    cost: 0,
    turnCount: 0,
  };
}

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
