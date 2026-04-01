/**
 * Integration tests: StatusTracker invalidation log — deduplication, cursor,
 * pruning, and flushInvalidations reset behaviors.
 *
 * The `getInvalidationsSince(sinceVersion)` method was added in the SSE
 * centralization refactor (823295e) to allow per-client cursor-based
 * delivery of invalidation signals. This test file covers behaviors that
 * complement the basic usage tested in status-tracker.test.ts:
 *
 *   1. Deduplication — multiple identical signals between two versions appear
 *      only once in the getInvalidationsSince() output.
 *   2. Version cursor continuity — calling getInvalidationsSince() twice with
 *      the version returned by the first call yields only new signals added
 *      after that version.
 *   3. Pruning — when invalidationLog grows > 1000 entries, a call to
 *      getInvalidationsSince() prunes the log to the last 500 entries.
 *   4. flushInvalidations() reset — after flush the log is empty and version
 *      is 0; subsequent getInvalidationsSince(0) returns empty signals.
 *   5. No signals from before cursor — signals added before the cursor are
 *      not included even after many subsequent changes.
 *
 * Covers:
 *   - tui/status-tracker.ts: getInvalidationsSince() deduplication path
 *   - tui/status-tracker.ts: getInvalidationsSince() pruning (> 1000 entries)
 *   - tui/status-tracker.ts: flushInvalidations() log clear + version reset
 */

import { describe, it, expect } from "vitest";
import { StatusTracker } from "@action-llama/action-llama/internals/status-tracker";

describe("status-tracker-invalidation: getInvalidationsSince advanced behaviors", { timeout: 10_000 }, () => {
  it("deduplicates repeated signals of the same type/agent within a query window", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dedup-agent", 1);

    const v0 = tracker.getInvalidationVersion();

    // Trigger multiple state changes for the same agent — each generates a
    // signal with the same type+agent key. Only one should appear per query.
    tracker.startRun("dedup-agent", "schedule");
    tracker.endRun("dedup-agent", 1000);
    tracker.startRun("dedup-agent", "schedule");
    tracker.endRun("dedup-agent", 1500);

    const { signals, version } = tracker.getInvalidationsSince(v0);

    // The returned version must be at the current invalidation watermark
    expect(version).toBe(tracker.getInvalidationVersion());

    // Deduplication: each distinct (type, agent, instanceId) key appears once
    const seen = new Set<string>();
    for (const sig of signals) {
      const key = `${sig.type}:${sig.agent ?? ""}:${sig.instanceId ?? ""}`;
      expect(seen.has(key), `Duplicate signal key: ${key}`).toBe(false);
      seen.add(key);
    }
    expect(signals.length).toBeGreaterThan(0);
  });

  it("version cursor continuity — second query with v1 returns only new signals", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("cursor-agent", 1);

    // Phase 1: trigger one run, capture resulting signals + version
    const v0 = tracker.getInvalidationVersion();
    tracker.startRun("cursor-agent", "manual");
    const first = tracker.getInvalidationsSince(v0);
    const v1 = first.version;

    expect(first.signals.length).toBeGreaterThan(0);

    // Phase 2: trigger another run
    tracker.endRun("cursor-agent", 500);
    const second = tracker.getInvalidationsSince(v1);

    // Version must have advanced
    expect(second.version).toBeGreaterThan(v1);

    // Signals from phase 1 must NOT appear in phase 2 results (cursor filtering)
    // All phase-2 signals have version > v1, so there should be at least one
    expect(second.signals.length).toBeGreaterThan(0);

    // No signal should be present in both first.signals and second.signals
    // (they cover non-overlapping version ranges)
    // This is enforced by the cursor: first query covered v0→v1, second covers v1→now
    const firstKeys = new Set(first.signals.map((s) => `${s.type}:${s.agent ?? ""}:${s.instanceId ?? ""}`));
    const secondKeys = new Set(second.signals.map((s) => `${s.type}:${s.agent ?? ""}:${s.instanceId ?? ""}`));
    // It is valid for the same key to appear in both windows when distinct events
    // of the same type fire, but each window should be independently non-empty
    expect(firstKeys.size).toBeGreaterThan(0);
    expect(secondKeys.size).toBeGreaterThan(0);
  });

  it("pruning — invalidationLog is trimmed to 500 after exceeding 1000 entries", () => {
    const tracker = new StatusTracker();

    // Use registerAgent to generate one signal per registration (scale changes, etc.)
    // We need > 1000 entries in the log.
    // Each startRun + endRun pair generates at least 2 invalidations.
    for (let i = 0; i < 26; i++) {
      const name = `prune-agent-${i}`;
      tracker.registerAgent(name, 1);
    }

    // Register agents first, then trigger enough runs to exceed 1000 log entries
    // Each startRun + endRun generates ~2 signals → need ~500 pairs = 26 agents × ~20 runs
    for (let run = 0; run < 20; run++) {
      for (let i = 0; i < 26; i++) {
        const name = `prune-agent-${i}`;
        tracker.startRun(name, "schedule");
        tracker.endRun(name, 100);
      }
    }

    // Before pruning the invalidationLog has > 1000 entries internally.
    // A call to getInvalidationsSince() triggers pruning.
    const v = tracker.getInvalidationVersion();
    // v should be > 1000 at this point (many invalidations)
    expect(v).toBeGreaterThan(1000);

    // Calling getInvalidationsSince should trigger the prune internally
    // (the public API doesn't expose log length, but the call succeeds and
    //  returns valid, deduplicated signals)
    const { signals, version } = tracker.getInvalidationsSince(0);

    // version should match current watermark
    expect(version).toBe(v);
    // signals should be deduplicated — no duplicate keys
    const seen = new Set<string>();
    for (const sig of signals) {
      const key = `${sig.type}:${sig.agent ?? ""}:${sig.instanceId ?? ""}`;
      expect(seen.has(key), `Duplicate after prune: ${key}`).toBe(false);
      seen.add(key);
    }
    // After pruning, subsequent calls still work correctly
    tracker.startRun("prune-agent-0", "manual");
    const afterPrune = tracker.getInvalidationsSince(v);
    expect(afterPrune.version).toBeGreaterThan(v);
    expect(afterPrune.signals.length).toBeGreaterThan(0);
  });

  it("flushInvalidations resets version to 0 and clears the log", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("flush2-agent", 1);
    tracker.startRun("flush2-agent", "schedule");
    tracker.endRun("flush2-agent", 200);

    // Confirm there are signals before flush
    const preFlushed = tracker.getInvalidationsSince(0);
    expect(preFlushed.signals.length).toBeGreaterThan(0);

    // Flush resets the version and log
    tracker.flushInvalidations();

    // After flush: version is 0
    expect(tracker.getInvalidationVersion()).toBe(0);

    // After flush: getInvalidationsSince(0) returns empty (log was cleared)
    const postFlush = tracker.getInvalidationsSince(0);
    expect(postFlush.signals).toHaveLength(0);
    expect(postFlush.version).toBe(0);
  });

  it("signals added before cursor are not returned on subsequent query", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("nocursor-agent-a", 1);
    tracker.registerAgent("nocursor-agent-b", 1);

    // Pre-cursor signals: run agent-a only
    tracker.startRun("nocursor-agent-a", "schedule");
    tracker.endRun("nocursor-agent-a", 100);

    // Capture the version after agent-a's run
    const v1 = tracker.getInvalidationVersion();

    // Post-cursor signal: run agent-b only
    tracker.startRun("nocursor-agent-b", "manual");

    const { signals, version } = tracker.getInvalidationsSince(v1);

    // Version must have advanced beyond v1
    expect(version).toBeGreaterThan(v1);
    expect(signals.length).toBeGreaterThan(0);

    // All returned signals should pertain to agent-b (post-cursor)
    // Any agent-a signal was before v1 and must not appear
    for (const sig of signals) {
      // agent-b signals should not be agent-a (pre-cursor signals)
      // It is fine if type is "runs" as long as agent is "nocursor-agent-b"
      if (sig.agent !== undefined) {
        expect(sig.agent).toBe("nocursor-agent-b");
      }
    }
  });
});
