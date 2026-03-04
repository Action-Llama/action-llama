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
  source: "github";
  repos?: string[];
  events?: string[];
  actions?: string[];
  labels?: string[];
  assignee?: string;
  author?: string;
  branches?: string[];
}

export type WebhookFilter = GitHubWebhookFilter;

// --- Agent config additions ---

export interface WebhookTriggerConfig {
  filters: WebhookFilter[];
}

// --- Provider interface ---

export interface WebhookProvider {
  source: string;
  validateRequest(headers: Record<string, string | undefined>, rawBody: string, secret?: string): boolean;
  parseEvent(headers: Record<string, string | undefined>, body: any): WebhookContext | null;
  matchesFilter(context: WebhookContext, filter: WebhookFilter): boolean;
}

// --- Registry binding ---

export interface WebhookBinding {
  agentName: string;
  filter: WebhookFilter;
  trigger: (context: WebhookContext) => void;
}

// --- Dispatch result ---

export interface DispatchResult {
  ok: boolean;
  matched: number;
  skipped: number;
  errors?: string[];
}
