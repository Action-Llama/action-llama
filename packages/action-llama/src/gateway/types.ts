import type { Server } from "http";
import type { LockStore } from "../execution/lock-store.js";
import type { CallStore } from "../execution/call-store.js";
import type { StateStore } from "../shared/state-store.js";
import type { WebhookRegistry } from "../webhooks/registry.js";
import type { Logger } from "../shared/logger.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { WebhookSourceConfig } from "../shared/config.js";
import type { ControlRoutesDeps } from "../control/routes/control.js";
import type { ApiKeySource } from "../control/auth.js";
import type { SchedulerEventBus } from "../scheduler/events.js";
import type { StatsStore } from "../stats/store.js";

export interface GatewayOptions {
  port: number;
  hostname?: string;
  logger: Logger;
  webhookRegistry?: WebhookRegistry;
  webhookSecrets?: Record<string, Record<string, string>>;
  webhookConfigs?: Record<string, WebhookSourceConfig>;
  statusTracker?: StatusTracker;
  projectPath?: string;
  webUI?: boolean;
  lockTimeout?: number;
  controlDeps?: ControlRoutesDeps;
  /** Static API key string or an async provider that re-reads the key from disk on every auth check, enabling hot-reload of rotated credentials. */
  apiKey?: ApiKeySource;
  stateStore?: StateStore;
  /** Optional path to the pre-built frontend dist directory (overrides resolveFrontendDist; useful for testing). */
  frontendDistPath?: string;
  /** Optional event bus for lifecycle instrumentation. */
  events?: SchedulerEventBus;
  /** Optional stats store for dashboard aggregate stats. */
  statsStore?: StatsStore;
}

export interface GatewayServer {
  server: Server;
  lockStore: LockStore;
  callStore: CallStore;
  close: () => Promise<void>;
}
