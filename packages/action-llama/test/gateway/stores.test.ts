import { describe, it, expect } from "vitest";
import { createGatewayStores } from "../../src/gateway/stores.js";

describe("createGatewayStores", () => {
  it("creates all stores without a persistent state store", async () => {
    const stores = await createGatewayStores({ lockTimeout: 30_000 });

    expect(stores.containerRegistry).toBeDefined();
    expect(stores.lockStore).toBeDefined();
    expect(stores.callStore).toBeDefined();
    expect(stores.sessionStore).toBeUndefined();
  });

  it("isHolderAlive callback evicts orphaned locks from dead holders", async () => {
    const stores = await createGatewayStores({ lockTimeout: 30_000 });

    // holderA is NOT registered in containerRegistry (simulates dead container)
    const holderA = "dead-container-instance-id";
    const holderB = "live-container-instance-id";
    const resource = "github://test/repo/issues/1";
    const lockStore = stores.lockStore;

    // Step 1: holderA acquires the lock
    const acquireA = lockStore.acquire(resource, holderA);
    expect(acquireA.ok).toBe(true);

    // Step 2: holderB tries to acquire the same resource
    // Since holderA is NOT in containerRegistry, isHolderAlive(holderA) returns false
    // The lock should be evicted and holderB should succeed
    const acquireB = lockStore.acquire(resource, holderB);
    expect(acquireB.ok).toBe(true);
  });

  it("creates sessionStore when stateStore is provided", async () => {
    // Create a minimal in-memory StateStore implementation
    const stateStore = {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
      deleteAll: async () => {},
      list: async () => [],
      close: async () => {},
    };
    const stores = await createGatewayStores({ lockTimeout: 30_000, stateStore });
    expect(stores.sessionStore).toBeDefined();
  });
});
