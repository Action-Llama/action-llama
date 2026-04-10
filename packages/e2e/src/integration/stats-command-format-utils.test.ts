/**
 * Integration tests: cli/commands/stats.ts formatDuration / formatTokens / formatCost
 * branches and per-agent run instance ID truncation — no Docker required.
 *
 * The private functions formatDuration(), formatTokens(), formatCost() are
 * exercised indirectly via execute() by storing runs with specific values in
 * a real StatsStore. This approach tests branches not covered by
 * stats-command.test.ts and stats-command-hook-timing.test.ts:
 *
 *   formatDuration(ms):
 *     - ms < 1000 → "${ms}ms"    (e.g. 500 → "500ms")
 *     - s < 60, s≥1 → "${s}s"   (e.g. 4500 → "5s")  [covered by existing tests]
 *     - m > 0, rem > 0 → "${m}m${rem}s"  (e.g. 90000 → "1m30s")
 *     - m > 0, rem === 0 → "${m}m"  (e.g. 120000 → "2m")
 *
 *   formatTokens(n):
 *     - n < 1000 → "${n}"            (e.g. 800 → "800")  [covered by existing]
 *     - n >= 1000 → "${n/1000}K"     (e.g. 5000 → "5.0K")
 *     - n >= 1_000_000 → "${n/1M}M"  (e.g. 1500000 → "1.5M")
 *
 *   formatCost(usd):
 *     - "$" + usd.toFixed(2)         (e.g. 0.0 → "$0.00")  [covered by existing]
 *
 *   per-agent run table:
 *     - instance_id.length > 18 → truncated to "...${last 15 chars}"
 *
 * Covers:
 *   - cli/commands/stats.ts: formatDuration() ms branch (< 1000ms)
 *   - cli/commands/stats.ts: formatDuration() minutes + remaining seconds branch
 *   - cli/commands/stats.ts: formatDuration() exact minutes branch (rem === 0)
 *   - cli/commands/stats.ts: formatTokens() K branch (>= 1000)
 *   - cli/commands/stats.ts: formatTokens() M branch (>= 1_000_000)
 *   - cli/commands/stats.ts: execute() --agent per-agent run table instance ID truncation
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const { execute } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/stats.js"
);

const { StatsStore } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/stats/store.js"
);

const { statsDbPath } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/paths.js"
);

/** Capture console.log output during a callback. */
async function captureLog(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...args: any[]) => lines.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.log = origLog;
  }
  return lines;
}

describe(
  "integration: cli/commands/stats.ts format utilities (no Docker required)",
  { timeout: 30_000 },
  () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), "al-stats-fmt-test-"));
      mkdirSync(join(projectDir, ".al"), { recursive: true });
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
    });

    // ── formatDuration: ms < 1000 ────────────────────────────────────────────

    it("formatDuration shows '500ms' for 500ms run (in per-agent view)", async () => {
      const store = new StatsStore(statsDbPath(projectDir));
      store.recordRun({
        sessionId: randomUUID(),
        agentName: "fast-agent",
        triggerType: "manual",
        result: "completed",
        startedAt: Date.now() - 600,
        durationMs: 500,      // < 1000ms → "500ms"
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        costUsd: 0.0001,
      });
      store.close();

      const lines = await captureLog(() =>
        execute({ project: projectDir, since: "1h", n: 10, agent: "fast-agent" })
      );
      const allOutput = lines.join("\n");
      expect(allOutput).toContain("500ms");
    });

    it("formatDuration shows '1ms' for 1ms run", async () => {
      const store = new StatsStore(statsDbPath(projectDir));
      store.recordRun({
        sessionId: randomUUID(),
        agentName: "tiny-agent",
        triggerType: "manual",
        result: "completed",
        startedAt: Date.now() - 100,
        durationMs: 1,        // 1ms
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        costUsd: 0.0,
      });
      store.close();

      const lines = await captureLog(() =>
        execute({ project: projectDir, since: "1h", n: 10, agent: "tiny-agent" })
      );
      const allOutput = lines.join("\n");
      expect(allOutput).toContain("1ms");
    });

    // ── formatDuration: minutes + remaining seconds ───────────────────────────

    it("formatDuration shows '1m30s' for 90000ms run", async () => {
      const store = new StatsStore(statsDbPath(projectDir));
      store.recordRun({
        sessionId: randomUUID(),
        agentName: "medium-agent",
        triggerType: "schedule",
        result: "completed",
        startedAt: Date.now() - 90_100,
        durationMs: 90_000,   // 90s = 1m30s
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
        costUsd: 0.003,
      });
      store.close();

      const lines = await captureLog(() =>
        execute({ project: projectDir, since: "1h", n: 10, agent: "medium-agent" })
      );
      const allOutput = lines.join("\n");
      expect(allOutput).toContain("1m30s");
    });

    // ── formatDuration: exact minutes (rem === 0) ─────────────────────────────

    it("formatDuration shows '2m' for 120000ms run", async () => {
      const store = new StatsStore(statsDbPath(projectDir));
      store.recordRun({
        sessionId: randomUUID(),
        agentName: "exact-min-agent",
        triggerType: "schedule",
        result: "completed",
        startedAt: Date.now() - 120_100,
        durationMs: 120_000,  // 120s = 2m exactly
        inputTokens: 300,
        outputTokens: 150,
        totalTokens: 450,
        costUsd: 0.004,
      });
      store.close();

      const lines = await captureLog(() =>
        execute({ project: projectDir, since: "1h", n: 10, agent: "exact-min-agent" })
      );
      const allOutput = lines.join("\n");
      expect(allOutput).toContain("2m");
      // Should NOT contain "2m0s" (the rem===0 branch returns just "2m")
      expect(allOutput).not.toContain("2m0s");
    });

    // ── formatTokens: K range ──────────────────────────────────────────────────

    it("formatTokens shows '5.0K' for 5000 tokens (in global summary)", async () => {
      const store = new StatsStore(statsDbPath(projectDir));
      store.recordRun({
        sessionId: randomUUID(),
        agentName: "k-tokens-agent",
        triggerType: "manual",
        result: "completed",
        startedAt: Date.now() - 5_000,
        durationMs: 3_000,
        inputTokens: 3000,
        outputTokens: 2000,
        totalTokens: 5000,    // >= 1000 → "5.0K"
        costUsd: 0.05,
      });
      store.close();

      const lines = await captureLog(() =>
        execute({ project: projectDir, since: "1h", n: 10 })
      );
      const allOutput = lines.join("\n");
      expect(allOutput).toContain("5.0K");
    });

    it("formatTokens shows '1.5K' for 1500 tokens", async () => {
      const store = new StatsStore(statsDbPath(projectDir));
      store.recordRun({
        sessionId: randomUUID(),
        agentName: "k-tokens-agent2",
        triggerType: "manual",
        result: "completed",
        startedAt: Date.now() - 5_000,
        durationMs: 2_000,
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,    // >= 1000 → "1.5K"
        costUsd: 0.015,
      });
      store.close();

      const lines = await captureLog(() =>
        execute({ project: projectDir, since: "1h", n: 10, agent: "k-tokens-agent2" })
      );
      const allOutput = lines.join("\n");
      expect(allOutput).toContain("1.5K");
    });

    // ── formatTokens: M range ──────────────────────────────────────────────────

    it("formatTokens shows '1.5M' for 1500000 tokens (in global summary)", async () => {
      const store = new StatsStore(statsDbPath(projectDir));
      store.recordRun({
        sessionId: randomUUID(),
        agentName: "m-tokens-agent",
        triggerType: "schedule",
        result: "completed",
        startedAt: Date.now() - 5_000,
        durationMs: 15_000,
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        totalTokens: 1_500_000,  // >= 1_000_000 → "1.5M"
        costUsd: 15.0,
      });
      store.close();

      const lines = await captureLog(() =>
        execute({ project: projectDir, since: "1h", n: 10 })
      );
      const allOutput = lines.join("\n");
      expect(allOutput).toContain("1.5M");
    });

    it("formatTokens shows '2.0M' for exactly 2000000 tokens", async () => {
      const store = new StatsStore(statsDbPath(projectDir));
      store.recordRun({
        sessionId: randomUUID(),
        agentName: "m-tokens-agent2",
        triggerType: "schedule",
        result: "completed",
        startedAt: Date.now() - 5_000,
        durationMs: 20_000,
        inputTokens: 1_500_000,
        outputTokens: 500_000,
        totalTokens: 2_000_000,  // "2.0M"
        costUsd: 20.0,
      });
      store.close();

      const lines = await captureLog(() =>
        execute({ project: projectDir, since: "1h", n: 10, agent: "m-tokens-agent2" })
      );
      const allOutput = lines.join("\n");
      expect(allOutput).toContain("2.0M");
    });

    // ── per-agent run table: instance ID truncation ───────────────────────────

    it("--agent shows truncated instance ID (> 18 chars) with '...' prefix", async () => {
      const longInstanceId = "very-long-instance-id-exceeds-18-chars-abcdef12345";
      const store = new StatsStore(statsDbPath(projectDir));
      store.recordRun({
        sessionId: longInstanceId,
        agentName: "trunc-run-agent",
        triggerType: "manual",
        result: "completed",
        startedAt: Date.now() - 5_000,
        durationMs: 3_000,
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        costUsd: 0.001,
      });
      store.close();

      const lines = await captureLog(() =>
        execute({ project: projectDir, since: "1h", n: 10, agent: "trunc-run-agent" })
      );
      const allOutput = lines.join("\n");
      // Should show "..." prefix + last 15 chars
      expect(allOutput).toContain("...");
      expect(allOutput).toContain(longInstanceId.slice(-15));
    });

    it("--agent shows short instance ID (≤ 18 chars) without truncation", async () => {
      const shortInstanceId = "inst-short-12"; // ≤ 18 chars
      const store = new StatsStore(statsDbPath(projectDir));
      store.recordRun({
        sessionId: shortInstanceId,
        agentName: "no-trunc-agent",
        triggerType: "manual",
        result: "completed",
        startedAt: Date.now() - 5_000,
        durationMs: 2_000,
        inputTokens: 80,
        outputTokens: 40,
        totalTokens: 120,
        costUsd: 0.0012,
      });
      store.close();

      const lines = await captureLog(() =>
        execute({ project: projectDir, since: "1h", n: 10, agent: "no-trunc-agent" })
      );
      const allOutput = lines.join("\n");
      // Full ID should appear without truncation
      expect(allOutput).toContain(shortInstanceId);
    });
  }
);
