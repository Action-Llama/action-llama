import type { Hono } from "hono";
import { registerLockRoutes } from "../../execution/routes/locks.js";
import { registerCallRoutes, type CallDispatcher } from "../../execution/routes/calls.js";
import { registerSignalRoutes, type SignalContext } from "../../execution/routes/signals.js";
import type { ContainerRegistry } from "../../execution/container-registry.js";
import type { LockStore } from "../../execution/lock-store.js";
import type { CallStore } from "../../execution/call-store.js";
import type { Logger } from "../../shared/logger.js";
import type { StatusTracker } from "../../tui/status-tracker.js";
import type { SchedulerEventBus } from "../../scheduler/events.js";

/**
 * Register execution-plane routes: locks, calls, and signals.
 */
export function registerExecutionRoutes(
  app: Hono,
  opts: {
    containerRegistry: ContainerRegistry;
    lockStore: LockStore;
    callStore: CallStore;
    callDispatcherProvider: () => CallDispatcher | undefined;
    logger: Logger;
    statusTracker?: StatusTracker;
    signalContext?: SignalContext;
    skipStatusEndpoint?: boolean;
    events?: SchedulerEventBus;
  },
): void {
  const {
    containerRegistry,
    lockStore,
    callStore,
    callDispatcherProvider,
    logger,
    statusTracker,
    signalContext,
    skipStatusEndpoint,
    events,
  } = opts;

  registerLockRoutes(app, containerRegistry, lockStore, logger, { skipStatusEndpoint, events });
  registerCallRoutes(app, containerRegistry, callStore, callDispatcherProvider, logger, events);
  registerSignalRoutes(app, containerRegistry, logger, statusTracker, signalContext, events);
}
