/**
 * Integration tests: execution/call-store.ts — no Docker required.
 *
 * CallStore is an in-memory store for agent-to-agent call entries.
 * It tracks the lifecycle of sub-agent calls: pending → running → completed/error.
 * Optional StateStore persistence means the in-memory map is the source of truth
 * for the running scheduler.
 *
 * The class is tested indirectly by the Docker-based subagent tests, but the
 * in-memory API itself has never been exercised in unit-style isolation.
 *
 * Test scenarios (no Docker or StateStore required):
 *   1. create() builds a CallEntry with correct fields and status "pending"
 *   2. create() returns different callIds for successive calls
 *   3. setRunning() transitions pending → running, returns true
 *   4. setRunning() returns false for a non-pending entry (already running/completed/error)
 *   5. setRunning() returns false for an unknown callId
 *   6. complete() transitions to "completed" with returnValue
 *   7. complete() returns false for a completed entry
 *   8. complete() works from "running" state
 *   9. fail() transitions to "error" with errorMessage
 *  10. fail() returns false for already-completed entry
 *  11. fail() returns false for already-errored entry
 *  12. check() returns status/returnValue/errorMessage for correct callerInstanceId
 *  13. check() returns null for wrong callerInstanceId
 *  14. check() returns null for unknown callId
 *  15. get() returns the full CallEntry by callId
 *  16. get() returns undefined for unknown callId
 *  17. failAllByCaller() fails all pending+running calls for a caller
 *  18. failAllByCaller() skips completed/error entries
 *  19. failAllByCaller() returns the count of entries changed
 *  20. dispose() clears the internal map (get returns undefined after dispose)
 *
 * Covers:
 *   - execution/call-store.ts: all public methods and state transitions
 */

import { describe, it, expect, afterEach } from "vitest";

const { CallStore } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/call-store.js"
);

describe("integration: CallStore (no Docker required)", () => {
  let store: InstanceType<typeof CallStore>;

  afterEach(() => {
    if (store) store.dispose();
  });

  // ── create() ──────────────────────────────────────────────────────────────

  describe("create()", () => {
    it("returns a CallEntry with correct fields and status 'pending'", () => {
      store = new CallStore(3600); // large sweep interval — no spurious sweeps
      const entry = store.create({
        callerAgent: "caller-agent",
        callerInstanceId: "caller-inst-001",
        targetAgent: "target-agent",
        context: JSON.stringify({ key: "value" }),
        depth: 1,
      });
      expect(typeof entry.callId).toBe("string");
      expect(entry.callId.length).toBeGreaterThan(0);
      expect(entry.callerAgent).toBe("caller-agent");
      expect(entry.callerInstanceId).toBe("caller-inst-001");
      expect(entry.targetAgent).toBe("target-agent");
      expect(entry.context).toBe(JSON.stringify({ key: "value" }));
      expect(entry.status).toBe("pending");
      expect(typeof entry.createdAt).toBe("number");
      expect(entry.depth).toBe(1);
      expect(entry.returnValue).toBeUndefined();
      expect(entry.errorMessage).toBeUndefined();
      expect(entry.completedAt).toBeUndefined();
    });

    it("returns a new unique callId for each create() call", () => {
      store = new CallStore(3600);
      const e1 = store.create({ callerAgent: "a", callerInstanceId: "i1", targetAgent: "b", context: "", depth: 0 });
      const e2 = store.create({ callerAgent: "a", callerInstanceId: "i1", targetAgent: "b", context: "", depth: 0 });
      expect(e1.callId).not.toBe(e2.callId);
    });
  });

  // ── setRunning() ──────────────────────────────────────────────────────────

  describe("setRunning()", () => {
    it("transitions status from 'pending' to 'running', returns true", () => {
      store = new CallStore(3600);
      const entry = store.create({ callerAgent: "a", callerInstanceId: "i", targetAgent: "b", context: "", depth: 0 });
      const result = store.setRunning(entry.callId);
      expect(result).toBe(true);
      expect(store.get(entry.callId)!.status).toBe("running");
    });

    it("returns false for an already-running entry", () => {
      store = new CallStore(3600);
      const entry = store.create({ callerAgent: "a", callerInstanceId: "i", targetAgent: "b", context: "", depth: 0 });
      store.setRunning(entry.callId); // first call
      const result = store.setRunning(entry.callId); // second call
      expect(result).toBe(false);
    });

    it("returns false for an unknown callId", () => {
      store = new CallStore(3600);
      const result = store.setRunning("nonexistent-call-id");
      expect(result).toBe(false);
    });
  });

  // ── complete() ────────────────────────────────────────────────────────────

  describe("complete()", () => {
    it("transitions pending entry to 'completed' with returnValue", () => {
      store = new CallStore(3600);
      const entry = store.create({ callerAgent: "a", callerInstanceId: "i", targetAgent: "b", context: "", depth: 0 });
      const result = store.complete(entry.callId, "done");
      expect(result).toBe(true);
      const updated = store.get(entry.callId)!;
      expect(updated.status).toBe("completed");
      expect(updated.returnValue).toBe("done");
      expect(typeof updated.completedAt).toBe("number");
    });

    it("transitions running entry to 'completed'", () => {
      store = new CallStore(3600);
      const entry = store.create({ callerAgent: "a", callerInstanceId: "i", targetAgent: "b", context: "", depth: 0 });
      store.setRunning(entry.callId);
      const result = store.complete(entry.callId, "result");
      expect(result).toBe(true);
      expect(store.get(entry.callId)!.status).toBe("completed");
    });

    it("allows completing without a returnValue (undefined)", () => {
      store = new CallStore(3600);
      const entry = store.create({ callerAgent: "a", callerInstanceId: "i", targetAgent: "b", context: "", depth: 0 });
      store.complete(entry.callId);
      expect(store.get(entry.callId)!.returnValue).toBeUndefined();
    });

    it("returns false for an already-completed entry", () => {
      store = new CallStore(3600);
      const entry = store.create({ callerAgent: "a", callerInstanceId: "i", targetAgent: "b", context: "", depth: 0 });
      store.complete(entry.callId, "done");
      const result = store.complete(entry.callId, "done again");
      expect(result).toBe(false);
    });
  });

  // ── fail() ────────────────────────────────────────────────────────────────

  describe("fail()", () => {
    it("transitions pending entry to 'error' with errorMessage", () => {
      store = new CallStore(3600);
      const entry = store.create({ callerAgent: "a", callerInstanceId: "i", targetAgent: "b", context: "", depth: 0 });
      const result = store.fail(entry.callId, "something went wrong");
      expect(result).toBe(true);
      const updated = store.get(entry.callId)!;
      expect(updated.status).toBe("error");
      expect(updated.errorMessage).toBe("something went wrong");
      expect(typeof updated.completedAt).toBe("number");
    });

    it("transitions running entry to 'error'", () => {
      store = new CallStore(3600);
      const entry = store.create({ callerAgent: "a", callerInstanceId: "i", targetAgent: "b", context: "", depth: 0 });
      store.setRunning(entry.callId);
      const result = store.fail(entry.callId, "timeout");
      expect(result).toBe(true);
      expect(store.get(entry.callId)!.status).toBe("error");
    });

    it("returns false for an already-completed entry", () => {
      store = new CallStore(3600);
      const entry = store.create({ callerAgent: "a", callerInstanceId: "i", targetAgent: "b", context: "", depth: 0 });
      store.complete(entry.callId, "done");
      const result = store.fail(entry.callId, "too late");
      expect(result).toBe(false);
    });

    it("returns false for an already-errored entry", () => {
      store = new CallStore(3600);
      const entry = store.create({ callerAgent: "a", callerInstanceId: "i", targetAgent: "b", context: "", depth: 0 });
      store.fail(entry.callId, "error 1");
      const result = store.fail(entry.callId, "error 2");
      expect(result).toBe(false);
    });
  });

  // ── check() ──────────────────────────────────────────────────────────────

  describe("check()", () => {
    it("returns status/returnValue for the correct callerInstanceId", () => {
      store = new CallStore(3600);
      const entry = store.create({ callerAgent: "a", callerInstanceId: "caller-id-123", targetAgent: "b", context: "", depth: 0 });
      store.complete(entry.callId, "my-result");
      const result = store.check(entry.callId, "caller-id-123");
      expect(result).not.toBeNull();
      expect(result!.status).toBe("completed");
      expect(result!.returnValue).toBe("my-result");
    });

    it("returns null for a wrong callerInstanceId", () => {
      store = new CallStore(3600);
      const entry = store.create({ callerAgent: "a", callerInstanceId: "caller-id-abc", targetAgent: "b", context: "", depth: 0 });
      const result = store.check(entry.callId, "wrong-caller-id");
      expect(result).toBeNull();
    });

    it("returns null for an unknown callId", () => {
      store = new CallStore(3600);
      const result = store.check("nonexistent-id", "any-caller");
      expect(result).toBeNull();
    });

    it("includes errorMessage in check result for failed calls", () => {
      store = new CallStore(3600);
      const entry = store.create({ callerAgent: "a", callerInstanceId: "caller-xyz", targetAgent: "b", context: "", depth: 0 });
      store.fail(entry.callId, "target crashed");
      const result = store.check(entry.callId, "caller-xyz");
      expect(result!.status).toBe("error");
      expect(result!.errorMessage).toBe("target crashed");
    });
  });

  // ── get() ─────────────────────────────────────────────────────────────────

  describe("get()", () => {
    it("returns the full CallEntry by callId", () => {
      store = new CallStore(3600);
      const entry = store.create({ callerAgent: "a", callerInstanceId: "i", targetAgent: "b", context: "ctx", depth: 2 });
      const fetched = store.get(entry.callId);
      expect(fetched).not.toBeUndefined();
      expect(fetched!.callId).toBe(entry.callId);
      expect(fetched!.depth).toBe(2);
    });

    it("returns undefined for an unknown callId", () => {
      store = new CallStore(3600);
      expect(store.get("ghost-id")).toBeUndefined();
    });
  });

  // ── failAllByCaller() ────────────────────────────────────────────────────

  describe("failAllByCaller()", () => {
    it("fails all pending and running calls from a given callerInstanceId", () => {
      store = new CallStore(3600);
      const e1 = store.create({ callerAgent: "a", callerInstanceId: "caller-A", targetAgent: "b", context: "", depth: 0 });
      const e2 = store.create({ callerAgent: "a", callerInstanceId: "caller-A", targetAgent: "c", context: "", depth: 0 });
      store.setRunning(e2.callId); // e1 pending, e2 running
      const count = store.failAllByCaller("caller-A");
      expect(count).toBe(2);
      expect(store.get(e1.callId)!.status).toBe("error");
      expect(store.get(e1.callId)!.errorMessage).toContain("caller container exited");
      expect(store.get(e2.callId)!.status).toBe("error");
    });

    it("does not affect calls from a different callerInstanceId", () => {
      store = new CallStore(3600);
      const e1 = store.create({ callerAgent: "a", callerInstanceId: "caller-X", targetAgent: "b", context: "", depth: 0 });
      const e2 = store.create({ callerAgent: "a", callerInstanceId: "caller-Y", targetAgent: "b", context: "", depth: 0 });
      store.failAllByCaller("caller-X");
      // caller-Y's entry should remain pending
      expect(store.get(e2.callId)!.status).toBe("pending");
      // caller-X's entry is failed
      expect(store.get(e1.callId)!.status).toBe("error");
    });

    it("skips already-completed entries and returns 0 for them", () => {
      store = new CallStore(3600);
      const e1 = store.create({ callerAgent: "a", callerInstanceId: "caller-C", targetAgent: "b", context: "", depth: 0 });
      store.complete(e1.callId, "done");
      const count = store.failAllByCaller("caller-C");
      expect(count).toBe(0); // completed entry is skipped
      expect(store.get(e1.callId)!.status).toBe("completed"); // unchanged
    });

    it("returns 0 when no matching calls exist", () => {
      store = new CallStore(3600);
      const count = store.failAllByCaller("nonexistent-caller");
      expect(count).toBe(0);
    });
  });

  // ── dispose() ────────────────────────────────────────────────────────────

  describe("dispose()", () => {
    it("clears the internal map so get() returns undefined", () => {
      store = new CallStore(3600);
      const entry = store.create({ callerAgent: "a", callerInstanceId: "i", targetAgent: "b", context: "", depth: 0 });
      expect(store.get(entry.callId)).toBeDefined();
      store.dispose();
      expect(store.get(entry.callId)).toBeUndefined();
    });

    it("is safe to call twice without throwing", () => {
      store = new CallStore(3600);
      store.dispose();
      expect(() => store.dispose()).not.toThrow();
    });
  });
});
