import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CallStore } from "../../src/execution/call-store.js";

describe("CallStore", () => {
  let store: CallStore;

  beforeEach(() => {
    store = new CallStore(9999); // Long sweep interval so it doesn't interfere
  });

  afterEach(() => {
    store.dispose();
  });

  describe("create", () => {
    it("creates an entry with pending status", () => {
      const entry = store.create({
        callerAgent: "dev",
        callerInstanceId: "dev(1)",
        targetAgent: "researcher",
        context: "find competitors",
        depth: 0,
      });
      expect(entry.callId).toBeTruthy();
      expect(entry.status).toBe("pending");
      expect(entry.callerAgent).toBe("dev");
      expect(entry.targetAgent).toBe("researcher");
      expect(entry.context).toBe("find competitors");
      expect(entry.depth).toBe(0);
    });

    it("generates unique call IDs", () => {
      const e1 = store.create({ callerAgent: "a", callerInstanceId: "a", targetAgent: "b", context: "", depth: 0 });
      const e2 = store.create({ callerAgent: "a", callerInstanceId: "a", targetAgent: "b", context: "", depth: 0 });
      expect(e1.callId).not.toBe(e2.callId);
    });
  });

  describe("setRunning", () => {
    it("transitions from pending to running", () => {
      const entry = store.create({ callerAgent: "a", callerInstanceId: "a", targetAgent: "b", context: "", depth: 0 });
      expect(store.setRunning(entry.callId)).toBe(true);
      const result = store.check(entry.callId, "a");
      expect(result?.status).toBe("running");
    });

    it("fails for non-pending entries", () => {
      const entry = store.create({ callerAgent: "a", callerInstanceId: "a", targetAgent: "b", context: "", depth: 0 });
      store.setRunning(entry.callId);
      expect(store.setRunning(entry.callId)).toBe(false);
    });

    it("fails for non-existent entries", () => {
      expect(store.setRunning("nonexistent")).toBe(false);
    });
  });

  describe("complete", () => {
    it("transitions to completed with return value", () => {
      const entry = store.create({ callerAgent: "a", callerInstanceId: "a", targetAgent: "b", context: "", depth: 0 });
      store.setRunning(entry.callId);
      expect(store.complete(entry.callId, "result data")).toBe(true);
      const result = store.check(entry.callId, "a");
      expect(result?.status).toBe("completed");
      expect(result?.returnValue).toBe("result data");
    });

    it("works without return value", () => {
      const entry = store.create({ callerAgent: "a", callerInstanceId: "a", targetAgent: "b", context: "", depth: 0 });
      store.setRunning(entry.callId);
      expect(store.complete(entry.callId)).toBe(true);
      const result = store.check(entry.callId, "a");
      expect(result?.status).toBe("completed");
      expect(result?.returnValue).toBeUndefined();
    });

    it("can complete directly from pending", () => {
      const entry = store.create({ callerAgent: "a", callerInstanceId: "a", targetAgent: "b", context: "", depth: 0 });
      expect(store.complete(entry.callId, "fast result")).toBe(true);
    });

    it("fails for already completed entries", () => {
      const entry = store.create({ callerAgent: "a", callerInstanceId: "a", targetAgent: "b", context: "", depth: 0 });
      store.complete(entry.callId);
      expect(store.complete(entry.callId)).toBe(false);
    });
  });

  describe("fail", () => {
    it("transitions to error with message", () => {
      const entry = store.create({ callerAgent: "a", callerInstanceId: "a", targetAgent: "b", context: "", depth: 0 });
      store.setRunning(entry.callId);
      expect(store.fail(entry.callId, "something broke")).toBe(true);
      const result = store.check(entry.callId, "a");
      expect(result?.status).toBe("error");
      expect(result?.errorMessage).toBe("something broke");
    });

    it("fails for already terminal entries", () => {
      const entry = store.create({ callerAgent: "a", callerInstanceId: "a", targetAgent: "b", context: "", depth: 0 });
      store.fail(entry.callId, "err");
      expect(store.fail(entry.callId, "err2")).toBe(false);
    });
  });

  describe("check", () => {
    it("returns null for non-existent call", () => {
      expect(store.check("nonexistent", "a")).toBeNull();
    });

    it("returns null when caller does not match", () => {
      const entry = store.create({ callerAgent: "a", callerInstanceId: "a(1)", targetAgent: "b", context: "", depth: 0 });
      expect(store.check(entry.callId, "wrong-caller")).toBeNull();
    });

    it("returns status for matching caller", () => {
      const entry = store.create({ callerAgent: "a", callerInstanceId: "a(1)", targetAgent: "b", context: "", depth: 0 });
      const result = store.check(entry.callId, "a(1)");
      expect(result).toEqual({ status: "pending", returnValue: undefined, errorMessage: undefined });
    });
  });

  describe("failAllByCaller", () => {
    it("fails all pending/running calls from a caller", () => {
      const e1 = store.create({ callerAgent: "a", callerInstanceId: "a(1)", targetAgent: "b", context: "", depth: 0 });
      const e2 = store.create({ callerAgent: "a", callerInstanceId: "a(1)", targetAgent: "c", context: "", depth: 0 });
      store.setRunning(e2.callId);

      const count = store.failAllByCaller("a(1)");
      expect(count).toBe(2);

      expect(store.check(e1.callId, "a(1)")?.status).toBe("error");
      expect(store.check(e2.callId, "a(1)")?.status).toBe("error");
      expect(store.check(e1.callId, "a(1)")?.errorMessage).toBe("caller container exited");
    });

    it("does not fail completed calls", () => {
      const e1 = store.create({ callerAgent: "a", callerInstanceId: "a(1)", targetAgent: "b", context: "", depth: 0 });
      store.complete(e1.callId, "done");
      const e2 = store.create({ callerAgent: "a", callerInstanceId: "a(1)", targetAgent: "c", context: "", depth: 0 });

      const count = store.failAllByCaller("a(1)");
      expect(count).toBe(1);
      expect(store.check(e1.callId, "a(1)")?.status).toBe("completed");
      expect(store.check(e2.callId, "a(1)")?.status).toBe("error");
    });

    it("does not affect other callers", () => {
      store.create({ callerAgent: "a", callerInstanceId: "a(1)", targetAgent: "b", context: "", depth: 0 });
      const e2 = store.create({ callerAgent: "x", callerInstanceId: "x(1)", targetAgent: "b", context: "", depth: 0 });

      store.failAllByCaller("a(1)");
      expect(store.check(e2.callId, "x(1)")?.status).toBe("pending");
    });

    it("returns 0 when no calls match", () => {
      expect(store.failAllByCaller("nobody")).toBe(0);
    });
  });

  describe("sweep", () => {
    it("expires terminal entries after TTL", () => {
      vi.useFakeTimers();
      try {
        const shortStore = new CallStore(1); // 1 second sweep
        const entry = shortStore.create({ callerAgent: "a", callerInstanceId: "a", targetAgent: "b", context: "", depth: 0 });
        shortStore.complete(entry.callId, "done");

        // Advance past 10 min terminal TTL
        vi.advanceTimersByTime(11 * 60 * 1000);

        expect(shortStore.check(entry.callId, "a")).toBeNull();
        shortStore.dispose();
      } finally {
        vi.useRealTimers();
      }
    });

    it("times out active entries after 2 hours", () => {
      vi.useFakeTimers();
      try {
        const shortStore = new CallStore(1);
        const entry = shortStore.create({ callerAgent: "a", callerInstanceId: "a", targetAgent: "b", context: "", depth: 0 });
        shortStore.setRunning(entry.callId);

        // Advance past 2 hour active TTL
        vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 1000);

        const result = shortStore.check(entry.callId, "a");
        expect(result?.status).toBe("error");
        expect(result?.errorMessage).toBe("call timed out");
        shortStore.dispose();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("dispose", () => {
    it("clears all entries", () => {
      const entry = store.create({ callerAgent: "a", callerInstanceId: "a", targetAgent: "b", context: "", depth: 0 });
      store.dispose();
      expect(store.check(entry.callId, "a")).toBeNull();
    });
  });

  describe("get", () => {
    it("returns the call entry by callId", () => {
      const entry = store.create({ callerAgent: "a", callerInstanceId: "a", targetAgent: "b", context: "ctx", depth: 0 });
      const result = store.get(entry.callId);
      expect(result).toBeDefined();
      expect(result?.callId).toBe(entry.callId);
      expect(result?.status).toBe("pending");
      expect(result?.targetAgent).toBe("b");
    });

    it("returns undefined for a non-existent callId", () => {
      expect(store.get("does-not-exist")).toBeUndefined();
    });
  });

  describe("init with state store", () => {
    it("hydrates in-memory state from persisted entries", async () => {
      // Create a minimal StateStore with pre-populated call entries
      const persistedCallId = "pre-existing-call-123";
      const callEntry = {
        callId: persistedCallId,
        callerAgent: "agent-x",
        callerInstanceId: "agent-x",
        targetAgent: "agent-y",
        context: "some context",
        depth: 0,
        status: "pending" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const storeData = new Map<string, unknown>();
      storeData.set(`calls:${persistedCallId}`, callEntry);

      const mockStateStore = {
        get: async (_ns: string, _key: string) => null,
        set: async () => {},
        delete: async () => {},
        deleteAll: async () => {},
        list: async <T>(_ns: string): Promise<Array<{ key: string; value: T }>> => {
          if (_ns === "calls") {
            return [{ key: persistedCallId, value: callEntry as T }];
          }
          return [];
        },
        close: async () => {},
      };

      const storeWithPersistence = new CallStore(9999, mockStateStore as any);
      await storeWithPersistence.init();

      // The persisted entry should now be accessible via get()
      const retrieved = storeWithPersistence.get(persistedCallId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.callId).toBe(persistedCallId);
      expect(retrieved?.callerAgent).toBe("agent-x");
      expect(retrieved?.targetAgent).toBe("agent-y");

      storeWithPersistence.dispose();
    });

    it("init with no state store is a no-op", async () => {
      const emptyStore = new CallStore(9999);
      await expect(emptyStore.init()).resolves.not.toThrow();
      emptyStore.dispose();
    });
  });
});
