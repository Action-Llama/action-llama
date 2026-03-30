import type { Server } from "http";
import type { CallDispatcher } from "../execution/routes/calls.js";
import type { SignalContext } from "../execution/routes/signals.js";
import type { ContainerRegistry } from "../execution/container-registry.js";
import type { LockStore } from "../execution/lock-store.js";
import type { CallStore } from "../execution/call-store.js";
import type { ContainerRegistration } from "../execution/types.js";
import type { StateStore } from "../shared/state-store.js";
import type { WebhookRegistry } from "../webhooks/registry.js";
import type { Logger } from "../shared/logger.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { WebhookSourceConfig } from "../shared/config.js";
import type { ControlRoutesDeps } from "../control/routes/control.js";
import type { ApiKeySource } from "../control/auth.js";
import type { SchedulerEventBus } from "../scheduler/events.js";
import type { StatsStore } from "../stats/store.js";
import type { ChatSessionManager } from "../chat/session-manager.js";
import type { ChatWebSocketState } from "../chat/ws-handler.js";
import type { LaunchChatCallback, StopChatCallback } from "../chat/routes.js";

export type { ContainerRegistration } from "../execution/types.js";

// Re-export SignalContext, CallDispatcher for convenience
export type { SignalContext, CallDispatcher };

export interface GatewayOptions {
  port: number;
  hostname?: string;
  logger: Logger;
  killContainer?: (name: string) => Promise<void>;
  webhookRegistry?: WebhookRegistry;
  webhookSecrets?: Record<string, Record<string, string>>;
  webhookConfigs?: Record<string, WebhookSourceConfig>;
  statusTracker?: StatusTracker;
  projectPath?: string;
  webUI?: boolean;
  lockTimeout?: number;
  signalContext?: SignalContext;
  controlDeps?: ControlRoutesDeps;
  /** Static API key string or an async provider that re-reads the key from disk on every auth check, enabling hot-reload of rotated credentials. */
  apiKey?: ApiKeySource;
  stateStore?: StateStore;
  skipStatusEndpoint?: boolean;
  /** Optional path to the pre-built frontend dist directory (overrides resolveFrontendDist; useful for testing). */
  frontendDistPath?: string;
  /** Optional event bus for lifecycle instrumentation. */
  events?: SchedulerEventBus;
  /** Optional stats store for dashboard aggregate stats. */
  statsStore?: StatsStore;
  /** Max concurrent chat sessions (default: 5). */
  maxChatSessions?: number;
  /** Callback to launch a chat container for a session. */
  launchChatContainer?: LaunchChatCallback;
  /** Callback to stop a chat container for a session. */
  stopChatContainer?: StopChatCallback;
}

export interface GatewayServer {
  server: Server;
  containerRegistry: ContainerRegistry;
  registerContainer: (secret: string, reg: ContainerRegistration) => Promise<void>;
  unregisterContainer: (secret: string) => Promise<void>;
  lockStore: LockStore;
  callStore: CallStore;
  setCallDispatcher: (dispatcher: CallDispatcher) => void;
  close: () => Promise<void>;
  chatSessionManager?: ChatSessionManager;
  chatWebSocketState?: ChatWebSocketState;
}
