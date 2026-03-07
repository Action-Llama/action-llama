import type { IncomingMessage } from "http";

// --- Webhook context passed to agent prompts ---

export interface WebhookContext {
  source: string;
  event: string;
  action?: string;
  repo: string;
  number?: number;
  title?: string;
  body?: string;
  url?: string;
  author?: string;
  assignee?: string;
  labels?: string[];
  branch?: string;
  comment?: string;
  sender: string;
  timestamp: string;
}

// --- Filters ---

export interface GitHubWebhookFilter {
  repos?: string[];
  orgs?: string[];
  events?: string[];
  actions?: string[];
  labels?: string[];
  assignee?: string;
  author?: string;
  branches?: string[];
}

export interface SentryWebhookFilter {
  resources?: string[];  // event_alert, metric_alert, issue, error, comment
}

export type WebhookFilter = GitHubWebhookFilter | SentryWebhookFilter;

// --- Webhook trigger (used in agent config) ---

export interface WebhookTrigger {
  type: string;       // provider type: "github", "sentry"
  source?: string;    // credential instance name, e.g. "GenerationSoftwareOrg" (optional)
  events?: string[];
  actions?: string[];
  repos?: string[];
  orgs?: string[];
  labels?: string[];
  assignee?: string;
  author?: string;
  branches?: string[];
  resources?: string[];
}

// --- Provider interface ---

export interface WebhookProvider {
  source: string;
  validateRequest(headers: Record<string, string | undefined>, rawBody: string, secrets?: Record<string, string>): string | null;
  parseEvent(headers: Record<string, string | undefined>, body: any): WebhookContext | null;
  matchesFilter(context: WebhookContext, filter: WebhookFilter): boolean;
}

// --- Registry binding ---

export interface WebhookBinding {
  agentName: string;
  type: string;       // provider type: "github", "sentry"
  source?: string;    // credential instance name (optional — omit to match any source)
  filter?: WebhookFilter;
  trigger: (context: WebhookContext) => void;
}

// --- Dispatch result ---

export interface DispatchResult {
  ok: boolean;
  matched: number;
  skipped: number;
  errors?: string[];
  matchedSource?: string;
}
