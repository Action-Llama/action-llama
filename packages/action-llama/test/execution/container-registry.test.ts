import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContainerRegistry } from "../../src/execution/container-registry.js";
import type { StateStore } from "../../src/shared/state-store.js";
import type { ContainerRegistration } from "../../src/execution/types.js";

function makeReg(overrides?: Partial<ContainerRegistration>): ContainerRegistration {
  return {
    containerName: "container-1",
    agentName: "test-agent",
    instanceId: "test-agent-1",
    ...overrides,
  };
}

function makeStore(entries: Array<{ key: string; value: ContainerRegistration }> = []): StateStore {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteAll: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue(entries),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe("ContainerRegistry", () => {
  describe("constructor", () => {
    it("creates an empty registry without a store", () => {
      const registry = new ContainerRegistry();
      expect(registry.size).toBe(0);
    });

    it("creates an empty registry with a store before init", () => {
      const store = makeStore();
      const registry = new ContainerRegistry(store);
      expect(registry.size).toBe(0);
    });
  });

  describe("init()", () => {
    it("does nothing when no store is provided", async () => {
      const registry = new ContainerRegistry();
      await registry.init();
      expect(registry.size).toBe(0);
    });

    it("hydrates cache from persistent store entries", async () => {
      const reg1 = makeReg({ containerName: "c1", instanceId: "agent-1" });
      const reg2 = makeReg({ containerName: "c2", instanceId: "agent-2" });
      const store = makeStore([
        { key: "secret-1", value: reg1 },
        { key: "secret-2", value: reg2 },
      ]);
      const registry = new ContainerRegistry(store);
      await registry.init();

      expect(registry.size).toBe(2);
      expect(registry.get("secret-1")).toEqual(reg1);
      expect(registry.get("secret-2")).toEqual(reg2);
    });

    it("calls store.list with the correct namespace", async () => {
      const store = makeStore();
      const registry = new ContainerRegistry(store);
      await registry.init();

      expect(store.list).toHaveBeenCalledWith("containers");
    });
  });

  describe("get()", () => {
    it("returns undefined for an unknown secret", () => {
      const registry = new ContainerRegistry();
      expect(registry.get("unknown-secret")).toBeUndefined();
    });

    it("returns the registration for a known secret", async () => {
      const reg = makeReg();
      const registry = new ContainerRegistry();
      await registry.register("my-secret", reg);

      expect(registry.get("my-secret")).toEqual(reg);
    });
  });

  describe("register()", () => {
    it("adds the registration to the in-memory cache", async () => {
      const registry = new ContainerRegistry();
      const reg = makeReg();
      await registry.register("secret-abc", reg);

      expect(registry.get("secret-abc")).toEqual(reg);
      expect(registry.size).toBe(1);
    });

    it("persists the registration to the store", async () => {
      const store = makeStore();
      const registry = new ContainerRegistry(store);
      const reg = makeReg();
      await registry.register("secret-abc", reg);

      expect(store.set).toHaveBeenCalledWith("containers", "secret-abc", reg);
    });

    it("does not throw when no store is configured", async () => {
      const registry = new ContainerRegistry();
      await expect(registry.register("s", makeReg())).resolves.toBeUndefined();
    });

    it("overwrites an existing registration with the same secret", async () => {
      const registry = new ContainerRegistry();
      const reg1 = makeReg({ containerName: "c1" });
      const reg2 = makeReg({ containerName: "c2" });

      await registry.register("secret", reg1);
      await registry.register("secret", reg2);

      expect(registry.get("secret")).toEqual(reg2);
      expect(registry.size).toBe(1);
    });
  });

  describe("unregister()", () => {
    it("removes the registration from the in-memory cache", async () => {
      const registry = new ContainerRegistry();
      await registry.register("secret", makeReg());
      await registry.unregister("secret");

      expect(registry.get("secret")).toBeUndefined();
      expect(registry.size).toBe(0);
    });

    it("deletes from the persistent store", async () => {
      const store = makeStore();
      const registry = new ContainerRegistry(store);
      await registry.register("secret", makeReg());
      await registry.unregister("secret");

      expect(store.delete).toHaveBeenCalledWith("containers", "secret");
    });

    it("does not throw when unregistering a non-existent secret", async () => {
      const registry = new ContainerRegistry();
      await expect(registry.unregister("no-such-secret")).resolves.toBeUndefined();
    });

    it("does not throw when no store is configured", async () => {
      const registry = new ContainerRegistry();
      await registry.register("s", makeReg());
      await expect(registry.unregister("s")).resolves.toBeUndefined();
    });
  });

  describe("hasInstance()", () => {
    it("returns false when the registry is empty", () => {
      const registry = new ContainerRegistry();
      expect(registry.hasInstance("any-instance")).toBe(false);
    });

    it("returns true when the instanceId is registered", async () => {
      const registry = new ContainerRegistry();
      await registry.register("secret", makeReg({ instanceId: "my-agent-1" }));

      expect(registry.hasInstance("my-agent-1")).toBe(true);
    });

    it("returns false when the instanceId is not registered", async () => {
      const registry = new ContainerRegistry();
      await registry.register("secret", makeReg({ instanceId: "my-agent-1" }));

      expect(registry.hasInstance("other-agent-2")).toBe(false);
    });

    it("returns true when one of multiple registrations matches", async () => {
      const registry = new ContainerRegistry();
      await registry.register("s1", makeReg({ instanceId: "agent-1" }));
      await registry.register("s2", makeReg({ instanceId: "agent-2" }));

      expect(registry.hasInstance("agent-2")).toBe(true);
      expect(registry.hasInstance("agent-3")).toBe(false);
    });
  });

  describe("listAll()", () => {
    it("returns an empty array when no containers are registered", () => {
      const registry = new ContainerRegistry();
      expect(registry.listAll()).toEqual([]);
    });

    it("returns all registered containers", async () => {
      const registry = new ContainerRegistry();
      const reg1 = makeReg({ containerName: "c1", instanceId: "i1" });
      const reg2 = makeReg({ containerName: "c2", instanceId: "i2" });

      await registry.register("s1", reg1);
      await registry.register("s2", reg2);

      const all = registry.listAll();
      expect(all).toHaveLength(2);
      expect(all).toContainEqual(reg1);
      expect(all).toContainEqual(reg2);
    });
  });

  describe("clear()", () => {
    it("empties the in-memory cache", async () => {
      const registry = new ContainerRegistry();
      await registry.register("s1", makeReg({ instanceId: "i1" }));
      await registry.register("s2", makeReg({ instanceId: "i2" }));
      await registry.clear();

      expect(registry.size).toBe(0);
      expect(registry.listAll()).toEqual([]);
    });

    it("deletes each entry from the persistent store", async () => {
      const store = makeStore();
      const registry = new ContainerRegistry(store);
      await registry.register("s1", makeReg({ instanceId: "i1" }));
      await registry.register("s2", makeReg({ instanceId: "i2" }));

      vi.clearAllMocks();
      await registry.clear();

      expect(store.delete).toHaveBeenCalledWith("containers", "s1");
      expect(store.delete).toHaveBeenCalledWith("containers", "s2");
    });

    it("does not throw when the registry is already empty", async () => {
      const registry = new ContainerRegistry();
      await expect(registry.clear()).resolves.toBeUndefined();
    });

    it("does not throw when no store is configured", async () => {
      const registry = new ContainerRegistry();
      await registry.register("s", makeReg());
      await expect(registry.clear()).resolves.toBeUndefined();
      expect(registry.size).toBe(0);
    });
  });

  describe("size", () => {
    it("returns 0 for a new registry", () => {
      const registry = new ContainerRegistry();
      expect(registry.size).toBe(0);
    });

    it("increments after each registration", async () => {
      const registry = new ContainerRegistry();
      await registry.register("s1", makeReg({ instanceId: "i1" }));
      expect(registry.size).toBe(1);
      await registry.register("s2", makeReg({ instanceId: "i2" }));
      expect(registry.size).toBe(2);
    });

    it("decrements after unregistration", async () => {
      const registry = new ContainerRegistry();
      await registry.register("s1", makeReg({ instanceId: "i1" }));
      await registry.register("s2", makeReg({ instanceId: "i2" }));
      await registry.unregister("s1");
      expect(registry.size).toBe(1);
    });
  });
});
