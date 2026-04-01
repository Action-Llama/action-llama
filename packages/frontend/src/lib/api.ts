const BASE = "";

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const MAX_RETRIES = 2;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      credentials: "same-origin",
      ...init,
    });

    if (res.status === 401) {
      window.location.href = "/login";
      throw new Error("Unauthorized");
    }

    // Retry on 429 with exponential backoff
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfterHeader = res.headers.get("Retry-After");
      const baseWaitMs = retryAfterHeader
        ? parseFloat(retryAfterHeader) * 1000
        : 1000;
      const waitMs = baseWaitMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      let message = text || `HTTP ${res.status}`;
      try {
        const json = JSON.parse(text);
        if (typeof json.error === "string") message = json.error;
        else if (typeof json.message === "string") message = json.message;
      } catch { /* not JSON — use raw text */ }
      throw new Error(message);
    }

    return res.json();
  }
}

function ctrlPost<T = { success: boolean; message?: string }>(
  path: string,
  body?: unknown,
): Promise<T> {
  return fetchJSON<T>(path, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

// --- Dashboard data ---

export interface AgentStatus {
  name: string;
  description?: string;
  state: "idle" | "running" | "building" | "error";
  enabled: boolean;
  statusText: string | null;
  lastError: string | null;
  lastRunAt: string | null;
  lastRunDuration: number | null;
  nextRunAt: string | null;
  queuedWebhooks: number;
  scale: number;
  runningCount: number;
  taskUrl: string | null;
  runReason: string | null;
  lastRunUsage: TokenUsage | null;
  cumulativeUsage: TokenUsage | null;
  locks?: { resourceKey: string; holder?: string; heldSince?: string }[];
  triggers?: string[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;
  turnCount: number;
}

export interface SchedulerInfo {
  mode: "docker" | "host";
  runtime?: "local" | "vps";
  projectName?: string;
  gatewayPort: number | null;
  cronJobCount: number;
  webhooksActive: boolean;
  webhookUrls: string[];
  dashboardUrl?: string;
  startedAt: string;
  paused: boolean;
  initializing?: boolean;
}

export interface LogLine {
  timestamp: string;
  agent: string;
  message: string;
}

export interface InvalidationSignal {
  type: "runs" | "triggers" | "stats" | "instance" | "config";
  agent?: string;
  instanceId?: string;
}

export interface DashboardStatus {
  agents: AgentStatus[];
  schedulerInfo: SchedulerInfo | null;
  recentLogs: LogLine[];
}

export interface AgentInstance {
  id: string;
  agentName: string;
  status: string;
  startedAt: string;
  trigger: string;
}

export interface TriggerHistoryRow {
  ts: number;
  triggerType: string;
  triggerSource?: string;
  agentName?: string;
  instanceId?: string;
  result: string;
  webhookReceiptId?: string;
  deadLetterReason?: string | null;
}

export interface JobRow {
  ts: number;
  triggerType: string;
  triggerSource?: string | null;
  agentName?: string | null;
  instanceId?: string | null;
  result: string;
  webhookReceiptId?: string | null;
  deadLetterReason?: string | null;
}

export interface ActivityRow {
  ts: number;
  triggerType: string;
  triggerSource?: string | null;
  /** Webhook event detail, e.g. "issues opened", "push" */
  eventSummary?: string | null;
  agentName?: string | null;
  instanceId?: string | null;
  /** "pending" | "running" | "completed" | "rerun" | "error" | "dead-letter" */
  result: string;
  webhookReceiptId?: string | null;
  deadLetterReason?: string | null;
}

export interface TriggerDetailData {
  instanceId: string;
  agentName: string;
  triggerType: string;
  triggerSource?: string | null;
  triggerContext?: string | null;
  startedAt: number;
  webhook?: {
    receiptId: string;
    source: string;
    eventSummary?: string | null;
    deliveryId?: string | null;
    timestamp: number;
    headers?: string | null;
    body?: string | null;
    matchedAgents: number;
    status: string;
  };
  callerAgent?: string;
  callerInstance?: string;
  callDepth?: number;
}

export interface WebhookReceiptDetail {
  id: string;
  deliveryId?: string;
  source: string;
  eventSummary?: string;
  timestamp: number;
  headers?: string;
  body?: string;
  matchedAgents: number;
  status: "processed" | "dead-letter";
  deadLetterReason?: string;
}

export interface AgentSummary {
  agentName: string;
  totalRuns: number;
  okRuns: number;
  errorRuns: number;
  avgDurationMs: number;
  totalTokens: number;
  totalCost: number;
}

export interface RunRecord {
  instance_id: string;
  agent_name: string;
  trigger_type: string;
  trigger_source?: string;
  result: string;
  exit_code?: number;
  started_at: number;
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  cost_usd: number;
  turn_count: number;
  error_message?: string;
  webhook_receipt_id?: string;
}

export interface AgentConfig {
  description?: string;
  schedule?: string;
  models?: {
    provider: string;
    model: string;
    authType: string;
    thinkingLevel?: string;
  }[];
  credentials?: string[];
  webhooks?: {
    source?: string;
    events?: string[];
    actions?: string[];
    repos?: string[];
    org?: string;
    orgs?: string[];
    labels?: string[];
    assignee?: string;
    author?: string;
    branches?: string[];
  }[];
  hooks?: { pre?: string[]; post?: string[] };
  params?: Record<string, unknown>;
  timeout?: number;
}

export interface AgentDetailData {
  agent: AgentStatus | null;
  agentConfig: AgentConfig | null;
  summary: AgentSummary | null;
  runningInstances: AgentInstance[];
  totalHistorical: number;
}

export interface InstanceDetailData {
  run: RunRecord | null;
  runningInstance: AgentInstance | null;
  parentEdge?: { caller_agent: string; caller_instance: string };
  webhookReceipt?: { source: string; eventSummary?: string; deliveryId?: string };
}

export interface ProjectConfigData {
  projectName?: string;
  projectScale: number;
  gatewayPort?: number;
  webhooksActive: boolean;
}

// --- API functions ---

export function getDashboardStatus(signal?: AbortSignal): Promise<DashboardStatus> {
  return fetchJSON("/api/dashboard/status", signal ? { signal } : undefined);
}

export function getAgentDetail(name: string, signal?: AbortSignal): Promise<AgentDetailData> {
  return fetchJSON(`/api/dashboard/agents/${encodeURIComponent(name)}`, signal ? { signal } : undefined);
}

export function getAgentSkill(name: string, signal?: AbortSignal): Promise<{ body: string; agentConfig: AgentConfig | null }> {
  return fetchJSON(
    `/api/dashboard/agents/${encodeURIComponent(name)}/skill`,
    signal ? { signal } : undefined,
  );
}

export function getProjectConfig(signal?: AbortSignal): Promise<ProjectConfigData> {
  return fetchJSON("/api/dashboard/config", signal ? { signal } : undefined);
}

export function getAgentRuns(
  name: string,
  page: number,
  limit: number,
  signal?: AbortSignal,
): Promise<{ runs: RunRecord[]; total: number; page: number; limit: number }> {
  return fetchJSON(
    `/api/stats/agents/${encodeURIComponent(name)}/runs?page=${page}&limit=${limit}`,
    signal ? { signal } : undefined,
  );
}

export function getWebhookReceipt(receiptId: string, signal?: AbortSignal): Promise<{ receipt: WebhookReceiptDetail | null }> {
  return fetchJSON(`/api/stats/webhooks/${encodeURIComponent(receiptId)}`, signal ? { signal } : undefined);
}

export function replayWebhook(receiptId: string): Promise<{ ok: boolean; matched: number; skipped: number; replayReceiptId?: string }> {
  return ctrlPost(`/api/webhooks/${encodeURIComponent(receiptId)}/replay`);
}

export function getTriggerHistory(
  limit: number,
  offset: number,
  includeDeadLetters: boolean,
  agent?: string,
  triggerType?: string,
  signal?: AbortSignal,
): Promise<{ triggers: TriggerHistoryRow[]; total: number }> {
  let url = `/api/stats/triggers?limit=${limit}&offset=${offset}&all=${includeDeadLetters ? "1" : "0"}`;
  if (agent) url += `&agent=${encodeURIComponent(agent)}`;
  if (triggerType) url += `&triggerType=${encodeURIComponent(triggerType)}`;
  return fetchJSON(url, signal ? { signal } : undefined);
}

export function getJobs(
  limit: number,
  offset: number,
  agent?: string,
  signal?: AbortSignal,
): Promise<{ jobs: JobRow[]; total: number; pending: Record<string, number>; totalPending: number }> {
  let url = `/api/stats/jobs?limit=${limit}&offset=${offset}`;
  if (agent) url += `&agent=${encodeURIComponent(agent)}`;
  return fetchJSON(url, signal ? { signal } : undefined);
}

export function getActivity(
  limit: number,
  offset: number,
  agent?: string,
  triggerType?: string,
  statuses?: string[],
  signal?: AbortSignal,
): Promise<{ rows: ActivityRow[]; total: number }> {
  let url = `/api/stats/activity?limit=${limit}&offset=${offset}`;
  if (agent) url += `&agent=${encodeURIComponent(agent)}`;
  if (triggerType) url += `&triggerType=${encodeURIComponent(triggerType)}`;
  if (statuses && statuses.length > 0) url += `&status=${statuses.map(encodeURIComponent).join(",")}`;
  return fetchJSON(url, signal ? { signal } : undefined);
}

export function getTriggerDetail(instanceId: string, signal?: AbortSignal): Promise<{ trigger: TriggerDetailData | null }> {
  return fetchJSON(`/api/dashboard/triggers/${encodeURIComponent(instanceId)}`, signal ? { signal } : undefined);
}

export function getInstanceDetail(
  name: string,
  instanceId: string,
  signal?: AbortSignal,
): Promise<InstanceDetailData> {
  return fetchJSON(
    `/api/dashboard/agents/${encodeURIComponent(name)}/instances/${encodeURIComponent(instanceId)}`,
    signal ? { signal } : undefined,
  );
}

export function getLocks(signal?: AbortSignal): Promise<{
  locks: {
    resourceKey: string;
    holder?: string;
    heldSince?: string;
    agentName?: string;
  }[];
}> {
  return fetchJSON("/dashboard/api/locks", signal ? { signal } : undefined);
}

export interface LogEntry {
  level: number;
  time: number;
  msg: string;
  instance?: string;
  text?: string;
  cmd?: string;
  tool?: string;
  result?: string;
  container?: string;
  name?: string;
  err?: unknown;
  [key: string]: unknown;
}

export function getAgentLogs(
  name: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ entries: LogEntry[]; cursor: string | null; hasMore: boolean }> {
  const qs = new URLSearchParams(params).toString();
  return fetchJSON(
    `/api/logs/agents/${encodeURIComponent(name)}${qs ? `?${qs}` : ""}`,
    signal ? { signal } : undefined,
  );
}

export function getInstanceLogs(
  name: string,
  instanceId: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ entries: LogEntry[]; cursor: string | null; hasMore: boolean }> {
  const qs = new URLSearchParams(params).toString();
  return fetchJSON(
    `/api/logs/agents/${encodeURIComponent(name)}/${encodeURIComponent(instanceId)}${qs ? `?${qs}` : ""}`,
    signal ? { signal } : undefined,
  );
}

// --- Control operations ---

export function triggerAgent(name: string, prompt?: string): Promise<{ success: boolean; message?: string; instanceId?: string }> {
  return ctrlPost<{ success: boolean; message?: string; instanceId?: string }>(
    `/control/trigger/${encodeURIComponent(name)}`,
    prompt ? { prompt } : undefined,
  );
}

export function killAgentInstances(name: string) {
  return ctrlPost(`/control/agents/${encodeURIComponent(name)}/kill`);
}

export function killInstance(instanceId: string) {
  return ctrlPost(`/control/kill/${encodeURIComponent(instanceId)}`);
}

export function enableAgent(name: string) {
  return ctrlPost(`/control/agents/${encodeURIComponent(name)}/enable`);
}

export function disableAgent(name: string) {
  return ctrlPost(`/control/agents/${encodeURIComponent(name)}/disable`);
}

export function pauseScheduler() {
  return ctrlPost("/control/pause");
}

export function resumeScheduler() {
  return ctrlPost("/control/resume");
}

export function updateProjectScale(scale: number) {
  return ctrlPost("/control/project/scale", { scale });
}

export function updateAgentScale(name: string, scale: number) {
  return ctrlPost(`/control/agents/${encodeURIComponent(name)}/scale`, {
    scale,
  });
}

export async function login(key: string): Promise<boolean> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  return res.ok;
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
}

export function summarizeLogs(
  name: string,
  instanceId: string,
  signal?: AbortSignal,
): Promise<{ summary: string; cached?: boolean; error?: string }> {
  return fetchJSON(
    `/api/logs/agents/${encodeURIComponent(name)}/${encodeURIComponent(instanceId)}/summarize`,
    {
      method: "POST",
      signal,
    },
  );
}
