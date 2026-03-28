/**
 * Tests for persistence layer adapters (StateStoreAdapter and StatsStoreAdapter).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { StateStoreAdapter } from "../../../src/shared/persistence/adapters/state-store.js";
import { StatsStoreAdapter } from "../../../src/shared/persistence/adapters/stats-store.js";
import { createPersistenceStore, type PersistenceStore } from "../../../src/shared/persistence/index.js";
import type { RunRecord, CallEdgeRecord } from "../../../src/stats/store.js";

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    instanceId: `run-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    agentName: "dev",
    triggerType: "schedule",
    result: "completed",
    startedAt: Date.now(),
    durationMs: 5000,
    totalTokens: 100,
    costUsd: 0.001,
    inputTokens: 60,
    outputTokens: 40,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    turnCount: 1,
    ...overrides,
  };
}

function makeCallEdge(overrides: Partial<CallEdgeRecord> = {}): CallEdgeRecord {
  return {
    callerAgent: "orchestrator",
    callerInstance: `inst-caller-${Date.now()}`,
    targetAgent: "worker",
    targetInstance: `inst-worker-${Date.now()}`,
    depth: 1,
    startedAt: Date.now(),
    ...overrides,
  };
}

describe("StateStoreAdapter", () => {
  let persistence: PersistenceStore;
  let adapter: StateStoreAdapter;

  beforeEach(async () => {
    persistence = await createPersistenceStore({ type: "memory" });
    adapter = new StateStoreAdapter(persistence);
  });

  afterEach(async () => {
    await persistence.close();
  });

  it("set and get round-trips a value", async () => {
    await adapter.set("locks", "key1", { agent: "dev" });
    const result = await adapter.get<{ agent: string }>("locks", "key1");
    expect(result).toEqual({ agent: "dev" });
  });

  it("get returns null for a missing key", async () => {
    const result = await adapter.get("locks", "nonexistent");
    expect(result).toBeNull();
  });

  it("delete removes a key", async () => {
    await adapter.set("locks", "key1", { agent: "dev" });
    await adapter.delete("locks", "key1");
    const result = await adapter.get("locks", "key1");
    expect(result).toBeNull();
  });

  it("deleteAll removes all keys in a namespace", async () => {
    await adapter.set("sessions", "s1", { user: "alice" });
    await adapter.set("sessions", "s2", { user: "bob" });
    await adapter.deleteAll("sessions");

    const s1 = await adapter.get("sessions", "s1");
    const s2 = await adapter.get("sessions", "s2");
    expect(s1).toBeNull();
    expect(s2).toBeNull();
  });

  it("list returns all keys in a namespace", async () => {
    await adapter.set("containers", "c1", { id: 1 });
    await adapter.set("containers", "c2", { id: 2 });

    const items = await adapter.list("containers");
    expect(items).toHaveLength(2);
    const keys = items.map((i) => i.key).sort();
    expect(keys).toEqual(["c1", "c2"]);
  });

  it("list returns empty array for an empty namespace", async () => {
    const items = await adapter.list("empty-ns");
    expect(items).toEqual([]);
  });

  it("set respects TTL option", async () => {
    // Set with a very small TTL (0.001 seconds = 1ms)
    await adapter.set("sessions", "ttl-key", { user: "temp" }, { ttl: 0.001 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const result = await adapter.get("sessions", "ttl-key");
    expect(result).toBeNull();
  });

  it("close does not throw", async () => {
    await expect(adapter.close()).resolves.not.toThrow();
  });
});

describe("StatsStoreAdapter", () => {
  let persistence: PersistenceStore;
  let adapter: StatsStoreAdapter;

  beforeEach(async () => {
    persistence = await createPersistenceStore({ type: "memory" });
    adapter = new StatsStoreAdapter(persistence);
  });

  afterEach(async () => {
    await persistence.close();
  });

  describe("recordRun", () => {
    it("does not throw when recording a completed run", () => {
      expect(() => adapter.recordRun(makeRun())).not.toThrow();
    });

    it("does not throw when recording an error run", () => {
      expect(() => adapter.recordRun(makeRun({ result: "error", errorMessage: "timeout" }))).not.toThrow();
    });
  });

  describe("recordCallEdge", () => {
    it("returns an incrementing numeric call ID", () => {
      const id1 = adapter.recordCallEdge(makeCallEdge());
      const id2 = adapter.recordCallEdge(makeCallEdge());
      expect(typeof id1).toBe("number");
      expect(id2).toBe(id1 + 1);
    });

    it("does not throw for a call with duration (completed)", () => {
      expect(() =>
        adapter.recordCallEdge(makeCallEdge({ durationMs: 3000, status: "completed" }))
      ).not.toThrow();
    });

    it("does not throw for a call with error status", () => {
      expect(() =>
        adapter.recordCallEdge(makeCallEdge({ durationMs: 1000, status: "error" }))
      ).not.toThrow();
    });
  });

  describe("updateCallEdge", () => {
    it("does not throw when updating with durationMs", () => {
      const id = adapter.recordCallEdge(makeCallEdge());
      expect(() => adapter.updateCallEdge(id, { durationMs: 2000, status: "completed" })).not.toThrow();
    });

    it("does not throw when updating without durationMs", () => {
      const id = adapter.recordCallEdge(makeCallEdge());
      expect(() => adapter.updateCallEdge(id, { status: "running" })).not.toThrow();
    });

    it("does not throw when updating with error status", () => {
      const id = adapter.recordCallEdge(makeCallEdge());
      expect(() => adapter.updateCallEdge(id, { durationMs: 500, status: "error" })).not.toThrow();
    });
  });

  describe("prune", () => {
    it("returns a stub result { runs: 0, callEdges: 0 }", () => {
      const result = adapter.prune(30);
      expect(result).toEqual({ runs: 0, callEdges: 0 });
    });

    it("does not throw for any number of days", () => {
      expect(() => adapter.prune(0)).not.toThrow();
      expect(() => adapter.prune(365)).not.toThrow();
    });
  });

  describe("close", () => {
    it("does not throw", () => {
      expect(() => adapter.close()).not.toThrow();
    });
  });
});
