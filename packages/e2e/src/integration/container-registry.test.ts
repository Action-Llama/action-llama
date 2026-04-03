/**
 * Integration tests: execution/container-registry.ts ContainerRegistry — no Docker required.
 *
 * ContainerRegistry is an in-memory + persistent store for container registrations.
 * Every running agent container registers its secret → ContainerRegistration mapping
 * on startup, which allows the execution routes (signals, locks, calls) to look up
 * which container is making each request.
 *
 * The class has ZERO existing test coverage. It's a simple CRUD cache over a
 * StateStore, making it ideal for direct unit-style testing without Docker.
 *
 * Test scenarios (no Docker or real StateStore required):
 *   1. get(): returns undefined for unregistered secret
 *   2. register(): adds to in-memory cache, get() returns it
 *   3. register(): overwrites existing registration for same secret
 *   4. unregister(): removes from cache, get() returns undefined
 *   5. unregister(): is a no-op for unknown secret
 *   6. hasInstance(): returns true when instanceId exists
 *   7. hasInstance(): returns false when instanceId not registered
 *   8. listAll(): returns all registrations as array
 *   9. listAll(): returns empty array when no registrations
 *  10. findByContainerName(): returns {secret, reg} for known container name
 *  11. findByContainerName(): returns undefined for unknown container name
 *  12. clear(): removes all registrations from cache
 *  13. size: reports count of registrations accurately
 *  14. size: is 0 for empty registry
 *  15. Multiple registrations coexist without interference
 *
 * Covers:
 *   - execution/container-registry.ts: all methods
 *   - execution/types.ts: ContainerRegistration interface (loaded as part of import)
 */

import { describe, it, expect } from "vitest";

const { ContainerRegistry } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/container-registry.js"
);

function makeReg(overrides?: Partial<{ containerName: string; agentName: string; instanceId: string }>) {
  return {
    containerName: overrides?.containerName ?? "al-my-agent-abc123",
    agentName: overrides?.agentName ?? "my-agent",
    instanceId: overrides?.instanceId ?? "my-agent-1",
  };
}

describe("integration: ContainerRegistry (no Docker required)", () => {

  // ── get() ─────────────────────────────────────────────────────────────────

  it("get() returns undefined for an unregistered secret", () => {
    const registry = new ContainerRegistry();
    expect(registry.get("nonexistent-secret")).toBeUndefined();
  });

  // ── register() ────────────────────────────────────────────────────────────

  it("register() adds to the in-memory cache and get() returns it", async () => {
    const registry = new ContainerRegistry();
    const reg = makeReg();
    await registry.register("secret-abc", reg);
    const found = registry.get("secret-abc");
    expect(found).toBeDefined();
    expect(found!.containerName).toBe(reg.containerName);
    expect(found!.agentName).toBe(reg.agentName);
    expect(found!.instanceId).toBe(reg.instanceId);
  });

  it("register() overwrites an existing registration for the same secret", async () => {
    const registry = new ContainerRegistry();
    const reg1 = makeReg({ agentName: "agent-1", instanceId: "agent-1-run1" });
    const reg2 = makeReg({ agentName: "agent-1", instanceId: "agent-1-run2" });
    await registry.register("secret-shared", reg1);
    await registry.register("secret-shared", reg2);
    const found = registry.get("secret-shared");
    expect(found!.instanceId).toBe("agent-1-run2");
  });

  // ── unregister() ──────────────────────────────────────────────────────────

  it("unregister() removes from cache so get() returns undefined", async () => {
    const registry = new ContainerRegistry();
    await registry.register("secret-to-remove", makeReg());
    expect(registry.get("secret-to-remove")).toBeDefined();
    await registry.unregister("secret-to-remove");
    expect(registry.get("secret-to-remove")).toBeUndefined();
  });

  it("unregister() is a no-op for unknown secret (does not throw)", async () => {
    const registry = new ContainerRegistry();
    await expect(registry.unregister("ghost-secret")).resolves.toBeUndefined();
  });

  // ── hasInstance() ─────────────────────────────────────────────────────────

  it("hasInstance() returns true when instanceId is registered", async () => {
    const registry = new ContainerRegistry();
    await registry.register("secret-has", makeReg({ instanceId: "my-agent-42" }));
    expect(registry.hasInstance("my-agent-42")).toBe(true);
  });

  it("hasInstance() returns false when instanceId is not registered", async () => {
    const registry = new ContainerRegistry();
    await registry.register("secret-other", makeReg({ instanceId: "other-instance-99" }));
    expect(registry.hasInstance("nonexistent-instance")).toBe(false);
  });

  it("hasInstance() returns false for empty registry", () => {
    const registry = new ContainerRegistry();
    expect(registry.hasInstance("any-instance-id")).toBe(false);
  });

  // ── listAll() ────────────────────────────────────────────────────────────

  it("listAll() returns all registrations as an array", async () => {
    const registry = new ContainerRegistry();
    await registry.register("secret-1", makeReg({ agentName: "agent-a", instanceId: "inst-1" }));
    await registry.register("secret-2", makeReg({ agentName: "agent-b", instanceId: "inst-2" }));
    const all = registry.listAll();
    expect(all.length).toBe(2);
    const instanceIds = all.map((r: { instanceId: string }) => r.instanceId);
    expect(instanceIds).toContain("inst-1");
    expect(instanceIds).toContain("inst-2");
  });

  it("listAll() returns empty array for empty registry", () => {
    const registry = new ContainerRegistry();
    expect(registry.listAll()).toEqual([]);
  });

  // ── findByContainerName() ─────────────────────────────────────────────────

  it("findByContainerName() returns {secret, reg} for a known container name", async () => {
    const registry = new ContainerRegistry();
    const reg = makeReg({ containerName: "al-my-agent-unique-xyz" });
    await registry.register("secret-xyz", reg);
    const found = registry.findByContainerName("al-my-agent-unique-xyz");
    expect(found).toBeDefined();
    expect(found!.secret).toBe("secret-xyz");
    expect(found!.reg.instanceId).toBe(reg.instanceId);
  });

  it("findByContainerName() returns undefined for unknown container name", async () => {
    const registry = new ContainerRegistry();
    await registry.register("secret-exists", makeReg({ containerName: "al-other-agent" }));
    const found = registry.findByContainerName("al-nonexistent-container");
    expect(found).toBeUndefined();
  });

  it("findByContainerName() returns undefined for empty registry", () => {
    const registry = new ContainerRegistry();
    expect(registry.findByContainerName("any-container")).toBeUndefined();
  });

  // ── clear() ──────────────────────────────────────────────────────────────

  it("clear() removes all registrations from the cache", async () => {
    const registry = new ContainerRegistry();
    await registry.register("secret-a", makeReg({ instanceId: "inst-a" }));
    await registry.register("secret-b", makeReg({ instanceId: "inst-b" }));
    await registry.clear();
    expect(registry.size).toBe(0);
    expect(registry.listAll()).toEqual([]);
    expect(registry.get("secret-a")).toBeUndefined();
  });

  it("clear() on empty registry does not throw", async () => {
    const registry = new ContainerRegistry();
    await expect(registry.clear()).resolves.toBeUndefined();
  });

  // ── size ─────────────────────────────────────────────────────────────────

  it("size reports 0 for empty registry", () => {
    const registry = new ContainerRegistry();
    expect(registry.size).toBe(0);
  });

  it("size increases on register and decreases on unregister", async () => {
    const registry = new ContainerRegistry();
    expect(registry.size).toBe(0);
    await registry.register("s1", makeReg({ instanceId: "i1" }));
    expect(registry.size).toBe(1);
    await registry.register("s2", makeReg({ instanceId: "i2" }));
    expect(registry.size).toBe(2);
    await registry.unregister("s1");
    expect(registry.size).toBe(1);
    await registry.unregister("s2");
    expect(registry.size).toBe(0);
  });

  // ── Multiple registrations coexist ────────────────────────────────────────

  it("multiple registrations coexist without interference", async () => {
    const registry = new ContainerRegistry();
    const agents = ["alpha", "beta", "gamma"];
    for (const name of agents) {
      await registry.register(`secret-${name}`, makeReg({ agentName: name, instanceId: `${name}-1` }));
    }
    expect(registry.size).toBe(3);
    for (const name of agents) {
      const reg = registry.get(`secret-${name}`);
      expect(reg!.agentName).toBe(name);
      expect(registry.hasInstance(`${name}-1`)).toBe(true);
    }
  });
});
