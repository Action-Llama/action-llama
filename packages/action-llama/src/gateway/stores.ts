import { ContainerRegistry } from "../execution/container-registry.js";
import { LockStore } from "../execution/lock-store.js";
import { CallStore } from "../execution/call-store.js";
import { SessionStore } from "../control/session-store.js";
import type { StateStore } from "../shared/state-store.js";

export interface GatewayStores {
  containerRegistry: ContainerRegistry;
  lockStore: LockStore;
  callStore: CallStore;
  sessionStore: SessionStore | undefined;
}

/**
 * Create and hydrate all stores needed by the gateway.
 * SessionStore is created once here and shared between auth middleware and
 * the chat WebSocket handler, eliminating the previous duplication.
 */
export async function createGatewayStores(opts: {
  lockTimeout?: number;
  stateStore?: StateStore;
}): Promise<GatewayStores> {
  const { lockTimeout, stateStore } = opts;

  const containerRegistry = new ContainerRegistry(stateStore);
  const lockStore = new LockStore(lockTimeout, undefined, stateStore, {
    isHolderAlive: (holder) => containerRegistry.hasInstance(holder),
  });
  const callStore = new CallStore(undefined, stateStore);
  const sessionStore = stateStore ? new SessionStore(stateStore) : undefined;

  // Hydrate in-memory caches from the persistent store.
  await containerRegistry.init();
  await lockStore.init();
  await callStore.init();

  return { containerRegistry, lockStore, callStore, sessionStore };
}
