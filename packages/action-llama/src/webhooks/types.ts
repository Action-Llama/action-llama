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
  conclusion?: string;
  comment?: string;
  sender: string;
  timestamp: string;
  receiptId?: string;
}

// --- Filters ---

export interface GitHubWebhookFilter {
  repos?: string[];
  org?: string;
  orgs?: string[];
  events?: string[];
  actions?: string[];
  labels?: string[];
  assignee?: string;
  author?: string;
  branches?: string[];
  conclusions?: string[];
}

export interface SentryWebhookFilter {
  resources?: string[];  // event_alert, metric_alert, issue, error, comment
}

export interface LinearWebhookFilter {
  organizations?: string[];
  events?: string[];
  actions?: string[];
  labels?: string[];
  assignee?: string;
  author?: string;
}

export interface MintlifyWebhookFilter {
  projects?: string[];
  events?: string[];     // build.failed, build.succeeded
  actions?: string[];    // failed, succeeded  
  branches?: string[];
}

export interface DiscordWebhookFilter {
  guilds?: string[];     // Discord server/guild IDs
  channels?: string[];   // Channel IDs
  commands?: string[];   // Slash command names
  events?: string[];     // Interaction types: application_command, message_component, etc.
}

export interface SlackWebhookFilter {
  events?: string[];     // e.g. "message", "app_mention", "reaction_added"
  channels?: string[];   // Slack channel IDs
  team_ids?: string[];   // Slack workspace/team IDs
}

export interface TwitterWebhookFilter {
  events?: string[];   // e.g. tweet_create_events, favorite_events, follow_events
  users?: string[];    // for_user_id values (subscribed account IDs)
}

export type WebhookFilter = GitHubWebhookFilter | SentryWebhookFilter | LinearWebhookFilter | MintlifyWebhookFilter | DiscordWebhookFilter | SlackWebhookFilter | TwitterWebhookFilter;

// --- Webhook trigger (used in agent config) ---

export interface WebhookTrigger {
  source: string;     // references a named webhook in config.toml [webhooks.<name>]
  events?: string[];
  actions?: string[];
  repos?: string[];
  org?: string;       // singular shorthand for orgs
  orgs?: string[];
  organizations?: string[];  // Linear organizations
  labels?: string[];
  assignee?: string;
  author?: string;
  branches?: string[];
  conclusions?: string[];
  resources?: string[];
  guilds?: string[];     // Discord guild IDs
  channels?: string[];   // Discord channel IDs
  commands?: string[];   // Discord slash command names
}

// --- Provider interface ---

export interface WebhookProvider {
  source: string;
  validateRequest(headers: Record<string, string | undefined>, rawBody: string, secrets?: Record<string, string>, allowUnsigned?: boolean): string | null;
  parseEvent(headers: Record<string, string | undefined>, body: any): WebhookContext | null;
  matchesFilter(context: WebhookContext, filter: WebhookFilter): boolean;
  getDeliveryId?(headers: Record<string, string | undefined>): string | null;
  handleChallenge?(headers: Record<string, string | undefined>, rawBody: string, secrets?: Record<string, string>, allowUnsigned?: boolean): object | null;
  handleCrcChallenge?(queryParams: Record<string, string>, secrets?: Record<string, string>): { status: number; body: any } | null;
}

// --- Registry binding ---

export interface WebhookBinding {
  agentName: string;
  type: string;       // provider type: "github", "sentry"
  source?: string;    // credential instance name (optional — omit to match any source)
  filter?: WebhookFilter;
  trigger: (context: WebhookContext) => boolean;
}

// --- Dispatch result ---

export interface DispatchResult {
  ok: boolean;
  matched: number;
  skipped: number;
  errors?: string[];
  matchedSource?: string;
}

// --- Dry run types ---

export interface DryRunBindingResult {
  agentName: string;
  matched: boolean;
  reasons: string[];
  filterDetails?: {
    type: boolean;
    source: boolean;
    event?: boolean;
    action?: boolean;
    repo?: boolean;
    org?: boolean;
    label?: boolean;
    assignee?: boolean;
    author?: boolean;
    branch?: boolean;
    conclusion?: boolean;
    resource?: boolean;
  };
}

export interface DryRunResult {
  ok: boolean;
  context: WebhookContext | null;
  validationResult: string | null;
  parseError?: string;
  bindings: DryRunBindingResult[];
  matchedSource?: string;
}
