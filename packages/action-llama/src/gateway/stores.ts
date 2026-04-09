import { LockStore } from "../execution/lock-store.js";
import { CallStore } from "../execution/call-store.js";
import { SessionStore } from "../control/session-store.js";
import type { StateStore } from "../shared/state-store.js";

export interface GatewayStores {
  lockStore: LockStore;
  callStore: CallStore;
  sessionStore: SessionStore | undefined;
}

/**
 * Create and hydrate all stores needed by the gateway.
 */
export async function createGatewayStores(opts: {
  lockTimeout?: number;
  stateStore?: StateStore;
}): Promise<GatewayStores> {
  const { lockTimeout, stateStore } = opts;

  const lockStore = new LockStore(lockTimeout, undefined, stateStore);
  const callStore = new CallStore(undefined, stateStore);
  const sessionStore = stateStore ? new SessionStore(stateStore) : undefined;

  await lockStore.init();
  await callStore.init();

  return { lockStore, callStore, sessionStore };
}
