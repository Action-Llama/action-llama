/**
 * Integration tests: tui/plain-logger.ts attachPlainLogger() uncovered branches — no Docker required.
 *
 * The existing scale-reconciliation-direct.test.ts covers basic attachPlainLogger paths but
 * misses two branches in the idle state handler and the stateKey() helper:
 *
 *   1. Idle state with lastRunUsage set (non-null) — log line includes
 *      "X tokens ($Y.ZZZZ)" from the usage variable in the idle case.
 *
 *   2. Idle state with nextRunAt set but no lastRunAt — log line shows
 *      "next run: <ISO timestamp>" without a "completed" prefix.
 *
 *   3. stateKey() usageKey branch — when lastRunUsage is non-null, the
 *      stateKey includes "totalTokens|cost", so a change in usage after
 *      the first idle log triggers a second log. This exercises the
 *      `usageKey !== ""` branch inside stateKey().
 *
 * Covers:
 *   - tui/plain-logger.ts: attachPlainLogger — idle state with lastRunUsage → logs "X tokens ($Y.ZZZZ)"
 *   - tui/plain-logger.ts: attachPlainLogger — idle state: nextRunAt set, no lastRunAt → logs "next run: ..."
 *   - tui/plain-logger.ts: stateKey() — usageKey non-empty when lastRunUsage is set (deduplication changes)
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  StatusTracker,
} from "@action-llama/action-llama/internals/status-tracker";

const {
  attachPlainLogger,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/tui/plain-logger.js"
);

describe(
  "integration: attachPlainLogger uncovered branches — lastRunUsage and nextRunAt (no Docker required)",
  { timeout: 10_000 },
  () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    // ── lastRunUsage non-null → usage line in idle/completed log ─────────────

    it("logs token count and cost when lastRunUsage is set on endRun", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);

      tracker.registerAgent("usage-agent", 1);
      tracker.startBuild("usage-agent");
      tracker.completeBuild("usage-agent");
      tracker.startRun("usage-agent", "manual");

      // endRun with a non-null usage object sets agent.lastRunUsage
      const usage = {
        inputTokens: 100,
        outputTokens: 200,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 300,
        cost: 0.0042,
        turnCount: 1,
      };
      tracker.endRun("usage-agent", 3000, undefined, usage);

      const messages = logSpy.mock.calls.map((c: any[]) => c[0]);

      // The idle branch fires: "completed (3.0s) | 300 tokens ($0.0042)"
      const completedLine = messages.find(
        (m: string) => m.includes("usage-agent") && m.includes("completed"),
      );
      expect(completedLine).toBeDefined();
      expect(completedLine).toContain("300 tokens");
      expect(completedLine).toContain("$0.0042");
    });

    it("completed log with lastRunUsage includes cost formatted to 4 decimal places", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);

      tracker.registerAgent("cost-agent", 1);
      tracker.startBuild("cost-agent");
      tracker.completeBuild("cost-agent");
      tracker.startRun("cost-agent", "schedule");

      const usage = {
        inputTokens: 50,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 100,
        cost: 0.0001,
        turnCount: 1,
      };
      tracker.endRun("cost-agent", 1000, undefined, usage);

      const messages = logSpy.mock.calls.map((c: any[]) => c[0]);
      const completedLine = messages.find(
        (m: string) => m.includes("cost-agent") && m.includes("tokens"),
      );
      expect(completedLine).toBeDefined();
      // Cost shown as $0.0001 (toFixed(4))
      expect(completedLine).toContain("$0.0001");
    });

    it("completed log without lastRunUsage does NOT include tokens or cost", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);

      tracker.registerAgent("nousage-agent", 1);
      tracker.startBuild("nousage-agent");
      tracker.completeBuild("nousage-agent");
      tracker.startRun("nousage-agent", "schedule");
      // completeRun does NOT pass usage — lastRunUsage stays null
      tracker.completeRun("nousage-agent", 2000);

      const messages = logSpy.mock.calls.map((c: any[]) => c[0]);
      const completedLine = messages.find(
        (m: string) => m.includes("nousage-agent") && m.includes("completed"),
      );
      expect(completedLine).toBeDefined();
      expect(completedLine).not.toContain("tokens");
      expect(completedLine).not.toContain("$");
    });

    // ── nextRunAt set but no lastRunAt → "next run: …" without "completed" ───

    it("logs 'next run' message when nextRunAt is set before completeBuild", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);

      tracker.registerAgent("nextrun-agent", 1);
      tracker.startBuild("nextrun-agent");

      // Set nextRunAt while agent is still in "building" state.
      // When completeBuild() transitions the agent to "idle", the stateKey
      // changes (state changes from "building" to "idle"), so the idle branch
      // fires and includes nextRunAt.
      const nextRun = new Date(Date.now() + 60_000);
      tracker.setNextRunAt("nextrun-agent", nextRun);

      // Now complete the build → agent transitions to idle with nextRunAt already set
      tracker.completeBuild("nextrun-agent");

      const messages = logSpy.mock.calls.map((c: any[]) => c[0]);

      // Should log a "next run" line
      const nextRunLine = messages.find(
        (m: string) => m.includes("nextrun-agent") && m.includes("next run:"),
      );
      expect(nextRunLine).toBeDefined();
      expect(nextRunLine).toContain(nextRun.toISOString());

      // Should NOT log a "completed" line (no lastRunAt — agent never ran)
      expect(
        messages.every((m: string) => !(m.includes("nextrun-agent") && m.includes("completed"))),
      ).toBe(true);
    });

    it("logs both 'completed' and 'next run' when both lastRunAt and nextRunAt are set", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);

      tracker.registerAgent("both-agent", 1);
      tracker.startBuild("both-agent");
      tracker.completeBuild("both-agent");
      tracker.startRun("both-agent", "schedule");

      // completeRun sets lastRunAt
      tracker.completeRun("both-agent", 1500);
      // Now the stateKey is stable for "idle" — next emit won't re-log

      // setNextRunAt changes agent.nextRunAt but the stateKey does NOT include
      // nextRunAt — so this update will NOT trigger a second log line for the
      // idle branch (because prevStates still matches the current stateKey).
      // Instead, we verify that when the agent FIRST enters idle with both set,
      // both messages are logged.

      // Reset and start fresh: register a new agent where both are set simultaneously
      tracker.registerAgent("both2-agent", 1);
      tracker.startBuild("both2-agent");
      tracker.completeBuild("both2-agent");
      tracker.startRun("both2-agent", "schedule");
      // Set nextRunAt before completing the run
      const nextRun2 = new Date(Date.now() + 300_000);
      tracker.setNextRunAt("both2-agent", nextRun2);
      // Now complete the run — agent goes to idle with lastRunAt set AND nextRunAt set
      tracker.completeRun("both2-agent", 2000);

      const messages = logSpy.mock.calls.map((c: any[]) => c[0]);

      const completedLine = messages.find(
        (m: string) => m.includes("both2-agent") && m.includes("completed"),
      );
      const nextRunLine = messages.find(
        (m: string) => m.includes("both2-agent") && m.includes("next run:"),
      );

      expect(completedLine).toBeDefined();
      expect(nextRunLine).toBeDefined();
    });

    // ── stateKey usageKey branch — usage change triggers new log ─────────────

    it("stateKey includes usage so second endRun with different usage re-logs", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);

      tracker.registerAgent("rerun-usage-agent", 1);
      tracker.startBuild("rerun-usage-agent");
      tracker.completeBuild("rerun-usage-agent");

      // First run with usage
      tracker.startRun("rerun-usage-agent", "schedule");
      tracker.endRun("rerun-usage-agent", 1000, undefined, {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 30,
        cost: 0.0001,
        turnCount: 1,
      });

      const after1st = logSpy.mock.calls.length;
      expect(after1st).toBeGreaterThan(0);

      // Second run with different usage — stateKey changes (different totalTokens|cost)
      // so the idle state will be re-logged
      tracker.startRun("rerun-usage-agent", "schedule");
      tracker.endRun("rerun-usage-agent", 2000, undefined, {
        inputTokens: 50,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 150,
        cost: 0.0025,
        turnCount: 2,
      });

      const messages = logSpy.mock.calls.map((c: any[]) => c[0]);

      // Both runs should produce "completed" lines (different stateKeys)
      const completedLines = messages.filter(
        (m: string) => m.includes("rerun-usage-agent") && m.includes("completed"),
      );
      expect(completedLines.length).toBeGreaterThanOrEqual(2);

      // Second line should mention the new token count
      expect(completedLines.some((m: string) => m.includes("150 tokens"))).toBe(true);
    });
  },
);
