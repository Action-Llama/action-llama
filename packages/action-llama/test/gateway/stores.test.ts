import { describe, it, expect } from "vitest";
import { createGatewayStores } from "../../src/gateway/stores.js";

describe("createGatewayStores", () => {
  it("creates all stores without a persistent state store", async () => {
    const stores = await createGatewayStores({ lockTimeout: 30_000 });

    expect(stores.lockStore).toBeDefined();
    expect(stores.callStore).toBeDefined();
    expect(stores.sessionStore).toBeUndefined();
  });

  it("lock store supports basic acquire/release workflow", async () => {
    const stores = await createGatewayStores({ lockTimeout: 30_000 });

    const holderA = "instance-a";
    const holderB = "instance-b";
    const resource = "github://test/repo/issues/1";
    const lockStore = stores.lockStore;

    // Step 1: holderA acquires the lock
    const acquireA = lockStore.acquire(resource, holderA);
    expect(acquireA.ok).toBe(true);

    // Step 2: holderB tries to acquire the same resource (should fail)
    const acquireB = lockStore.acquire(resource, holderB);
    expect(acquireB.ok).toBe(false);

    // Step 3: holderA releases the lock
    const released = lockStore.release(resource, holderA);
    expect(released.ok).toBe(true);

    // Step 4: holderB can now acquire the lock
    const acquireB2 = lockStore.acquire(resource, holderB);
    expect(acquireB2.ok).toBe(true);
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
