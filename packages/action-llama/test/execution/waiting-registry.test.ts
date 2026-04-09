import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WaitingRegistry, matchDotPath, type WaitingInstance, type WaitFilter } from "../../src/execution/waiting-registry.js";
import type { WebhookContext } from "../../src/webhooks/types.js";

function makeWebhookContext(overrides: Partial<WebhookContext> = {}): WebhookContext {
  return {
    source: "github",
    event: "pull_request",
    action: "opened",
    repo: "owner/repo",
    sender: "user",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeWaitingInstance(overrides: Partial<WaitingInstance> = {}): WaitingInstance {
  return {
    instanceId: `inst-${Math.random().toString(36).slice(2, 8)}`,
    agentName: "test-agent",
    filter: { type: "webhook" },
    deadline: Date.now() + 60_000,
    registeredAt: Date.now(),
    runId: "container-123",
    runtimeType: "container",
    cwd: "/workspace",
    ...overrides,
  };
}

describe("matchDotPath", () => {
  it("matches top-level keys", () => {
    expect(matchDotPath({ action: "closed" }, "action", "closed")).toBe(true);
    expect(matchDotPath({ action: "opened" }, "action", "closed")).toBe(false);
  });

  it("matches nested keys", () => {
    const obj = { pull_request: { merged: true, head: { ref: "main" } } };
    expect(matchDotPath(obj, "pull_request.merged", "true")).toBe(true);
    expect(matchDotPath(obj, "pull_request.head.ref", "main")).toBe(true);
    expect(matchDotPath(obj, "pull_request.head.ref", "dev")).toBe(false);
  });

  it("returns false for missing paths", () => {
    expect(matchDotPath({}, "a.b.c", "x")).toBe(false);
    expect(matchDotPath({ a: null }, "a.b", "x")).toBe(false);
  });

  it("converts values to string for comparison", () => {
    expect(matchDotPath({ count: 42 }, "count", "42")).toBe(true);
    expect(matchDotPath({ flag: false }, "flag", "false")).toBe(true);
  });
});

describe("WaitingRegistry", () => {
  let registry: WaitingRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new WaitingRegistry();
  });

  afterEach(() => {
    // Clean up any registered timers
    for (const entry of registry.getAll()) {
      registry.remove(entry.instanceId);
    }
    vi.useRealTimers();
  });

  describe("register", () => {
    it("adds an entry", () => {
      const entry = makeWaitingInstance();
      registry.register(entry);
      expect(registry.count()).toBe(1);
      expect(registry.getAll()).toHaveLength(1);
    });

    it("rejects immediately if already expired", () => {
      const reject = vi.fn();
      const entry = makeWaitingInstance({
        deadline: Date.now() - 1000,
        reject,
      });
      registry.register(entry);
      expect(reject).toHaveBeenCalledWith(expect.any(Error));
      expect(registry.count()).toBe(0);
    });

    it("times out after deadline", () => {
      const reject = vi.fn();
      const entry = makeWaitingInstance({
        deadline: Date.now() + 5000,
        reject,
      });
      registry.register(entry);
      expect(registry.count()).toBe(1);

      vi.advanceTimersByTime(5000);

      expect(reject).toHaveBeenCalledWith(expect.objectContaining({ message: "Wait timeout expired" }));
      expect(registry.count()).toBe(0);
    });
  });

  describe("matchWebhook", () => {
    it("matches a broad webhook filter", () => {
      const resolve = vi.fn();
      registry.register(makeWaitingInstance({
        agentName: "my-agent",
        filter: { type: "webhook" },
        resolve,
      }));

      const context = makeWebhookContext();
      const match = registry.matchWebhook("my-agent", context);

      expect(match).not.toBeNull();
      expect(match!.agentName).toBe("my-agent");
      expect(registry.count()).toBe(0); // removed after match
    });

    it("matches by source", () => {
      registry.register(makeWaitingInstance({
        agentName: "my-agent",
        filter: { type: "webhook", source: "github" },
      }));

      expect(registry.matchWebhook("my-agent", makeWebhookContext({ source: "sentry" }))).toBeNull();
      expect(registry.matchWebhook("my-agent", makeWebhookContext({ source: "github" }))).not.toBeNull();
    });

    it("matches by event", () => {
      registry.register(makeWaitingInstance({
        agentName: "my-agent",
        filter: { type: "webhook", event: "pull_request" },
      }));

      expect(registry.matchWebhook("my-agent", makeWebhookContext({ event: "push" }))).toBeNull();
      expect(registry.matchWebhook("my-agent", makeWebhookContext({ event: "pull_request" }))).not.toBeNull();
    });

    it("matches by dot-path predicates", () => {
      registry.register(makeWaitingInstance({
        agentName: "my-agent",
        filter: { type: "webhook", match: { action: "closed", repo: "owner/repo" } },
      }));

      expect(registry.matchWebhook("my-agent", makeWebhookContext({ action: "opened" }))).toBeNull();
      expect(registry.matchWebhook("my-agent", makeWebhookContext({ action: "closed" }))).not.toBeNull();
    });

    it("returns null for wrong agent name", () => {
      registry.register(makeWaitingInstance({
        agentName: "other-agent",
        filter: { type: "webhook" },
      }));

      expect(registry.matchWebhook("my-agent", makeWebhookContext())).toBeNull();
    });

    it("uses FIFO ordering", () => {
      const first = makeWaitingInstance({
        instanceId: "first",
        agentName: "my-agent",
        filter: { type: "webhook" },
        registeredAt: 1000,
      });
      const second = makeWaitingInstance({
        instanceId: "second",
        agentName: "my-agent",
        filter: { type: "webhook" },
        registeredAt: 2000,
      });
      registry.register(second);
      registry.register(first);

      const match = registry.matchWebhook("my-agent", makeWebhookContext());
      expect(match!.instanceId).toBe("first");
      expect(registry.count()).toBe(1);
    });

    it("skips non-webhook filters", () => {
      registry.register(makeWaitingInstance({
        agentName: "my-agent",
        filter: { type: "agent-trigger" },
      }));

      expect(registry.matchWebhook("my-agent", makeWebhookContext())).toBeNull();
    });
  });

  describe("matchAgentTrigger", () => {
    it("matches a broad agent-trigger filter", () => {
      registry.register(makeWaitingInstance({
        agentName: "target-agent",
        filter: { type: "agent-trigger" },
      }));

      const match = registry.matchAgentTrigger("target-agent", "source-agent");
      expect(match).not.toBeNull();
      expect(registry.count()).toBe(0);
    });

    it("matches by sourceAgent", () => {
      registry.register(makeWaitingInstance({
        agentName: "target-agent",
        filter: { type: "agent-trigger", sourceAgent: "specific-agent" },
      }));

      expect(registry.matchAgentTrigger("target-agent", "other-agent")).toBeNull();
      expect(registry.matchAgentTrigger("target-agent", "specific-agent")).not.toBeNull();
    });

    it("skips non-agent-trigger filters", () => {
      registry.register(makeWaitingInstance({
        agentName: "my-agent",
        filter: { type: "webhook" },
      }));

      expect(registry.matchAgentTrigger("my-agent", "source-agent")).toBeNull();
    });
  });

  describe("remove", () => {
    it("removes an entry by instanceId", () => {
      const entry = makeWaitingInstance({ instanceId: "test-id" });
      registry.register(entry);
      expect(registry.count()).toBe(1);

      const removed = registry.remove("test-id");
      expect(removed).not.toBeNull();
      expect(removed!.instanceId).toBe("test-id");
      expect(registry.count()).toBe(0);
    });

    it("returns null for non-existent instanceId", () => {
      expect(registry.remove("nonexistent")).toBeNull();
    });

    it("clears the timeout timer on removal", () => {
      const reject = vi.fn();
      const entry = makeWaitingInstance({
        instanceId: "timed",
        deadline: Date.now() + 10_000,
        reject,
      });
      registry.register(entry);
      registry.remove("timed");

      vi.advanceTimersByTime(15_000);
      expect(reject).not.toHaveBeenCalled();
    });
  });

  describe("getByAgent", () => {
    it("filters by agent name", () => {
      registry.register(makeWaitingInstance({ agentName: "a", instanceId: "i1" }));
      registry.register(makeWaitingInstance({ agentName: "b", instanceId: "i2" }));
      registry.register(makeWaitingInstance({ agentName: "a", instanceId: "i3" }));

      expect(registry.getByAgent("a")).toHaveLength(2);
      expect(registry.getByAgent("b")).toHaveLength(1);
      expect(registry.getByAgent("c")).toHaveLength(0);
    });
  });

  describe("persistence", () => {
    it("persists and rehydrates entries", async () => {
      // Use a simple mock KV store
      const kvData = new Map<string, any>();
      const mockStore = {
        kv: {
          get: async (_ns: string, key: string) => kvData.get(`${_ns}:${key}`) ?? null,
          set: async (_ns: string, key: string, value: any) => { kvData.set(`${_ns}:${key}`, value); },
          delete: async (_ns: string, key: string) => { kvData.delete(`${_ns}:${key}`); },
          deleteAll: async (ns: string) => {
            for (const key of kvData.keys()) {
              if (key.startsWith(`${ns}:`)) kvData.delete(key);
            }
          },
          list: async (ns: string) => {
            const results: Array<{ key: string; value: any }> = [];
            for (const [k, v] of kvData.entries()) {
              if (k.startsWith(`${ns}:`)) {
                results.push({ key: k.slice(ns.length + 1), value: v });
              }
            }
            return results;
          },
        },
      } as any;

      const entry = makeWaitingInstance({
        instanceId: "persist-test",
        agentName: "test-agent",
        filter: { type: "webhook", source: "github", event: "push" },
        deadline: Date.now() + 30_000,
      });
      registry.register(entry);

      await registry.persist(mockStore);

      // Rehydrate into a new registry
      const rehydrated = await WaitingRegistry.rehydrate(mockStore);
      expect(rehydrated.count()).toBe(1);

      const entries = rehydrated.getAll();
      expect(entries[0].instanceId).toBe("persist-test");
      expect(entries[0].filter).toEqual({ type: "webhook", source: "github", event: "push" });

      // Clean up
      for (const e of rehydrated.getAll()) rehydrated.remove(e.instanceId);
    });

    it("skips expired entries on rehydrate", async () => {
      const kvData = new Map<string, any>();
      const mockStore = {
        kv: {
          get: async (_ns: string, key: string) => kvData.get(`${_ns}:${key}`) ?? null,
          set: async (_ns: string, key: string, value: any) => { kvData.set(`${_ns}:${key}`, value); },
          delete: async (_ns: string, key: string) => { kvData.delete(`${_ns}:${key}`); },
          deleteAll: async (ns: string) => {
            for (const key of kvData.keys()) {
              if (key.startsWith(`${ns}:`)) kvData.delete(key);
            }
          },
          list: async (ns: string) => {
            const results: Array<{ key: string; value: any }> = [];
            for (const [k, v] of kvData.entries()) {
              if (k.startsWith(`${ns}:`)) {
                results.push({ key: k.slice(ns.length + 1), value: v });
              }
            }
            return results;
          },
        },
      } as any;

      // Manually insert an expired entry
      kvData.set("waiting-instances:expired-test", {
        instanceId: "expired-test",
        agentName: "test-agent",
        filter: { type: "webhook" },
        deadline: Date.now() - 1000, // already expired
        registeredAt: Date.now() - 60_000,
        runId: "container",
        runtimeType: "container",
        cwd: "/workspace",
      });

      const rehydrated = await WaitingRegistry.rehydrate(mockStore);
      expect(rehydrated.count()).toBe(0);
    });
  });
});
