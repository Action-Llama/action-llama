/**
 * Tests for persistence layer adapters (StateStoreAdapter and StatsStoreAdapter).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { StateStoreAdapter } from "../../../src/shared/persistence/adapters/state-store.js";
import { StatsStoreAdapter } from "../../../src/shared/persistence/adapters/stats-store.js";
import { createPersistenceStore, type PersistenceStore } from "../../../src/shared/persistence/index.js";
import type { RunRecord, CallEdgeRecord } from "../../../src/stats/store.js";

/** Build a minimal mock PersistenceStore whose query.sql is a controllable vi.fn() */
function createMockPersistence() {
  const sqlMock = vi.fn().mockResolvedValue([]);
  const mockStore = {
    events: {
      stream: (_name: string) => ({
        append: vi.fn().mockResolvedValue(undefined),
        replay: vi.fn().mockReturnValue(
          (async function* () {})()
        ),
        getSnapshot: vi.fn().mockResolvedValue(null),
        saveSnapshot: vi.fn().mockResolvedValue(undefined),
      }),
      listStreams: vi.fn().mockResolvedValue([]),
    },
    kv: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      deleteAll: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
    },
    query: { sql: sqlMock },
    transaction: vi.fn(async (fn: any) => fn(mockStore)),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as PersistenceStore & { query: { sql: ReturnType<typeof vi.fn> } };
  return { mockStore, sqlMock };
}

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

describe("StatsStoreAdapter – query methods", () => {
  let sqlMock: ReturnType<typeof vi.fn>;
  let mockAdapter: StatsStoreAdapter;

  beforeEach(() => {
    const { mockStore, sqlMock: s } = createMockPersistence();
    sqlMock = s;
    mockAdapter = new StatsStoreAdapter(mockStore);
  });

  describe("queryRunsByAgentPaginated", () => {
    it("returns rows from sql query for a given agent", async () => {
      const rows = [{ instanceId: "run-1", agentName: "dev" }];
      sqlMock.mockResolvedValueOnce(rows);

      const result = await mockAdapter.queryRunsByAgentPaginated("dev", 10, 0);
      expect(result).toEqual(rows);
      expect(sqlMock).toHaveBeenCalledWith(
        expect.stringContaining("agent_name = ?"),
        ["dev", 10, 0]
      );
    });

    it("returns empty array when no rows found", async () => {
      sqlMock.mockResolvedValueOnce([]);
      const result = await mockAdapter.queryRunsByAgentPaginated("missing", 5, 0);
      expect(result).toEqual([]);
    });
  });

  describe("countRunsByAgent", () => {
    it("returns the count from the sql result", async () => {
      sqlMock.mockResolvedValueOnce([{ count: 42 }]);
      const count = await mockAdapter.countRunsByAgent("dev");
      expect(count).toBe(42);
    });

    it("returns 0 when result is empty", async () => {
      sqlMock.mockResolvedValueOnce([]);
      const count = await mockAdapter.countRunsByAgent("empty-agent");
      expect(count).toBe(0);
    });

    it("returns 0 when count field is missing", async () => {
      sqlMock.mockResolvedValueOnce([{}]);
      const count = await mockAdapter.countRunsByAgent("agent");
      expect(count).toBe(0);
    });
  });

  describe("queryRunByInstanceId", () => {
    it("returns the first result row", async () => {
      const row = { instanceId: "inst-123", agentName: "dev" };
      sqlMock.mockResolvedValueOnce([row]);
      const result = await mockAdapter.queryRunByInstanceId("inst-123");
      expect(result).toEqual(row);
    });

    it("returns undefined when no rows found", async () => {
      sqlMock.mockResolvedValueOnce([]);
      const result = await mockAdapter.queryRunByInstanceId("nonexistent");
      expect(result).toBeUndefined();
    });
  });

  describe("queryRuns", () => {
    it("queries without agent filter when no agent provided", async () => {
      const rows = [{ instanceId: "r1" }, { instanceId: "r2" }];
      sqlMock.mockResolvedValueOnce(rows);
      const result = await mockAdapter.queryRuns({});
      expect(result).toEqual(rows);
      expect(sqlMock).toHaveBeenCalledWith(
        expect.stringContaining("started_at >= ?"),
        expect.arrayContaining([0, 100])
      );
    });

    it("queries with agent filter when agent is provided", async () => {
      const rows = [{ instanceId: "r1", agentName: "dev" }];
      sqlMock.mockResolvedValueOnce(rows);
      const result = await mockAdapter.queryRuns({ agent: "dev", limit: 50 });
      expect(result).toEqual(rows);
      expect(sqlMock).toHaveBeenCalledWith(
        expect.stringContaining("agent_name = ?"),
        expect.arrayContaining(["dev"])
      );
    });

    it("uses default limit of 100 and since of 0", async () => {
      sqlMock.mockResolvedValueOnce([]);
      await mockAdapter.queryRuns();
      expect(sqlMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([0, 100])
      );
    });

    it("passes since parameter when provided", async () => {
      sqlMock.mockResolvedValueOnce([]);
      const since = Date.now() - 1000 * 60 * 60;
      await mockAdapter.queryRuns({ since });
      expect(sqlMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([since])
      );
    });
  });

  describe("queryAgentSummary", () => {
    it("returns summary rows for all agents when no agent specified", async () => {
      const rows = [{ agentName: "dev", totalRuns: 5 }];
      sqlMock.mockResolvedValueOnce(rows);
      const result = await mockAdapter.queryAgentSummary({});
      expect(result).toEqual(rows);
      expect(sqlMock).toHaveBeenCalledWith(
        expect.stringContaining("GROUP BY agent_name"),
        expect.arrayContaining([0])
      );
    });

    it("returns summary rows for a specific agent", async () => {
      const rows = [{ agentName: "dev", totalRuns: 3, errorRuns: 1 }];
      sqlMock.mockResolvedValueOnce(rows);
      const result = await mockAdapter.queryAgentSummary({ agent: "dev", since: 1000 });
      expect(result).toEqual(rows);
      expect(sqlMock).toHaveBeenCalledWith(
        expect.stringContaining("agent_name = ?"),
        expect.arrayContaining(["dev", 1000])
      );
    });

    it("uses defaults when called with no arguments", async () => {
      sqlMock.mockResolvedValueOnce([]);
      await mockAdapter.queryAgentSummary();
      expect(sqlMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([0])
      );
    });
  });

  describe("queryGlobalSummary", () => {
    it("returns the first row when rows exist", async () => {
      const summary = { totalRuns: 10, okRuns: 8, errorRuns: 2, totalTokens: 500, totalCost: 0.01 };
      sqlMock.mockResolvedValueOnce([summary]);
      const result = await mockAdapter.queryGlobalSummary(0);
      expect(result).toEqual(summary);
    });

    it("returns default zeros when no rows returned", async () => {
      sqlMock.mockResolvedValueOnce([]);
      const result = await mockAdapter.queryGlobalSummary();
      expect(result).toEqual({ totalRuns: 0, okRuns: 0, errorRuns: 0, totalTokens: 0, totalCost: 0 });
    });

    it("passes since parameter to the sql query", async () => {
      sqlMock.mockResolvedValueOnce([]);
      const since = 9999;
      await mockAdapter.queryGlobalSummary(since);
      expect(sqlMock).toHaveBeenCalledWith(expect.any(String), [since]);
    });
  });

  describe("queryCallGraph", () => {
    it("returns call graph rows", async () => {
      const rows = [{ callerAgent: "orch", targetAgent: "worker", count: 3 }];
      sqlMock.mockResolvedValueOnce(rows);
      const result = await mockAdapter.queryCallGraph({ since: 0 });
      expect(result).toEqual(rows);
      expect(sqlMock).toHaveBeenCalledWith(
        expect.stringContaining("caller_agent"),
        expect.arrayContaining([0])
      );
    });

    it("returns empty array when no edges found", async () => {
      sqlMock.mockResolvedValueOnce([]);
      const result = await mockAdapter.queryCallGraph({});
      expect(result).toEqual([]);
    });

    it("uses since=0 by default", async () => {
      sqlMock.mockResolvedValueOnce([]);
      await mockAdapter.queryCallGraph();
      expect(sqlMock).toHaveBeenCalledWith(expect.any(String), [0]);
    });
  });
});
