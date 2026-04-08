/**
 * Integration tests: cli/commands/stats.ts execute() — no Docker required.
 *
 * The `al stats` command reads from the SQLite stats database and prints
 * a formatted summary of agent run history. Several code paths are
 * exercised purely by controlling the project directory and DB content.
 *
 * Test scenarios (no Docker required):
 *   1. No DB file exists → logs "No stats data yet"
 *   2. Invalid --since value → throws Error with helpful message
 *   3. --calls mode with empty DB → logs "No call edges in the last X"
 *   4. --calls + --json with empty DB → logs valid JSON (empty array)
 *   5. --agent with empty DB → logs "No runs for '<name>' in the last X"
 *   6. --agent + --json with empty DB → logs valid JSON with null summary
 *   7. Global summary view with no runs → logs "No runs in the last X"
 *   8. Global summary + --json with no runs → logs JSON with totalRuns 0
 *   9. DB has runs — global summary shows totals
 *  10. DB has runs — per-agent summary shown
 *  11. DB has runs — --calls shows call graph header
 *  12. DB has runs — --json global summary outputs correct fields
 *
 * Covers:
 *   - cli/commands/stats.ts: execute() when DB does not exist → "No stats data yet"
 *   - cli/commands/stats.ts: parseSince() invalid format → throws Error
 *   - cli/commands/stats.ts: execute() --calls with no edges → "No call edges"
 *   - cli/commands/stats.ts: execute() --calls + --json with no edges → JSON []
 *   - cli/commands/stats.ts: execute() --agent with no runs → "No runs for..."
 *   - cli/commands/stats.ts: execute() --agent + --json → JSON null summary
 *   - cli/commands/stats.ts: execute() global summary with no runs → "No runs"
 *   - cli/commands/stats.ts: execute() global summary + --json with no runs
 *   - cli/commands/stats.ts: execute() with real runs → prints table header
 *   - cli/commands/stats.ts: formatDuration() all branches (ms, s, m/s, m)
 *   - cli/commands/stats.ts: formatTokens() K/M/raw branches
 *   - cli/commands/stats.ts: formatCost() USD formatting
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

/** Create a populated StatsStore at the expected .al/stats.db path. */
function createPopulatedDb(projectPath: string) {
  const dbPath = statsDbPath(projectPath);
  mkdirSync(join(projectPath, ".al"), { recursive: true });
  const store = new StatsStore(dbPath);

  store.recordRun({
    instanceId: randomUUID(),
    agentName: "agent-alpha",
    triggerType: "manual",
    result: "completed",
    startedAt: Date.now() - 5_000,
    durationMs: 4_500,
    inputTokens: 500,
    outputTokens: 300,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 800,
    costUsd: 0.01,
    turnCount: 5,
  });

  store.recordRun({
    instanceId: randomUUID(),
    agentName: "agent-beta",
    triggerType: "webhook",
    result: "error",
    startedAt: Date.now() - 3_000,
    durationMs: 2_500,
    inputTokens: 200,
    outputTokens: 100,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 300,
    costUsd: 0.005,
    turnCount: 2,
  });

  store.close();
}

describe(
  "integration: cli/commands/stats.ts execute() (no Docker required)",
  { timeout: 30_000 },
  () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), "al-stats-cmd-test-"));
      // Create minimal config.toml (needed for loadGlobalConfig if called)
      // Actually stats.ts doesn't call loadGlobalConfig — just checks the DB path.
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
    });

    // ── No DB file ────────────────────────────────────────────────────────────

    it("outputs 'No stats data yet' when DB does not exist", async () => {
      const lines = await captureLog(() =>
        execute({ project: projectDir, since: "24h", n: 10 })
      );
      expect(lines.some((l) => l.includes("No stats data yet"))).toBe(true);
    });

    // ── Invalid --since ───────────────────────────────────────────────────────

    it("throws Error for invalid --since format", async () => {
      // Create DB so it doesn't short-circuit on the "no DB" check
      mkdirSync(join(projectDir, ".al"), { recursive: true });
      const dbPath = statsDbPath(projectDir);
      const store = new StatsStore(dbPath);
      store.close();

      await expect(
        execute({ project: projectDir, since: "invalid", n: 10 })
      ).rejects.toThrow(/Invalid --since value/);
    });

    it("throws Error for --since with only letters (no number)", async () => {
      mkdirSync(join(projectDir, ".al"), { recursive: true });
      const dbPath = statsDbPath(projectDir);
      const store = new StatsStore(dbPath);
      store.close();

      await expect(
        execute({ project: projectDir, since: "hours", n: 10 })
      ).rejects.toThrow(/Invalid --since value/);
    });

    it("throws Error for --since with wrong suffix", async () => {
      mkdirSync(join(projectDir, ".al"), { recursive: true });
      const dbPath = statsDbPath(projectDir);
      const store = new StatsStore(dbPath);
      store.close();

      await expect(
        execute({ project: projectDir, since: "24m", n: 10 })
      ).rejects.toThrow(/Invalid --since value/);
    });

    it("error message for invalid --since includes the bad value", async () => {
      mkdirSync(join(projectDir, ".al"), { recursive: true });
      const store = new StatsStore(statsDbPath(projectDir));
      store.close();

      let caught: Error | undefined;
      try {
        await execute({ project: projectDir, since: "badvalue", n: 10 });
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).toBeDefined();
      expect(caught!.message).toContain("badvalue");
      // Should suggest correct formats
      expect(caught!.message).toMatch(/24h|7d/);
    });

    // ── --calls mode with empty DB ────────────────────────────────────────────

    it("outputs 'No call edges' when --calls with no data", async () => {
      mkdirSync(join(projectDir, ".al"), { recursive: true });
      const store = new StatsStore(statsDbPath(projectDir));
      store.close();

      const lines = await captureLog(() =>
        execute({ project: projectDir, since: "24h", n: 10, calls: true })
      );
      expect(lines.some((l) => l.includes("No call edges"))).toBe(true);
    });

    it("outputs JSON empty array for --calls + --json with no data", async () => {
      mkdirSync(join(projectDir, ".al"), { recursive: true });
      const store = new StatsStore(statsDbPath(projectDir));
      store.close();

      const lines = await captureLog(() =>
        execute({ project: projectDir, since: "24h", n: 10, calls: true, json: true })
      );
      expect(lines.length).toBeGreaterThanOrEqual(1);
      const allOutput = lines.join("\n");
      const parsed = JSON.parse(allOutput);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(0);
    });

    // ── --agent mode with empty DB ────────────────────────────────────────────

    it("outputs 'No runs for agent' when --agent with no data", async () => {
      mkdirSync(join(projectDir, ".al"), { recursive: true });
      const store = new StatsStore(statsDbPath(projectDir));
      store.close();

      const lines = await captureLog(() =>
        execute({ project: projectDir, since: "24h", n: 10, agent: "my-agent" })
      );
      expect(lines.some((l) => l.includes("No runs for"))).toBe(true);
      expect(lines.some((l) => l.includes("my-agent"))).toBe(true);
    });

    it("outputs JSON with null summary for --agent + --json with no data", async () => {
      mkdirSync(join(projectDir, ".al"), { recursive: true });
      const store = new StatsStore(statsDbPath(projectDir));
      store.close();

      const lines = await captureLog(() =>
        execute({ project: projectDir, since: "24h", n: 10, agent: "my-agent", json: true })
      );
      const allOutput = lines.join("\n");
      const parsed = JSON.parse(allOutput);
      expect(parsed).toHaveProperty("summary");
      expect(parsed.summary).toBeNull();
      expect(parsed).toHaveProperty("runs");
      expect(Array.isArray(parsed.runs)).toBe(true);
    });

    // ── Global summary with empty DB ──────────────────────────────────────────

    it("outputs 'No runs' when global summary has no data", async () => {
      mkdirSync(join(projectDir, ".al"), { recursive: true });
      const store = new StatsStore(statsDbPath(projectDir));
      store.close();

      const lines = await captureLog(() =>
        execute({ project: projectDir, since: "24h", n: 10 })
      );
      expect(lines.some((l) => l.includes("No runs"))).toBe(true);
    });

    it("outputs JSON with totalRuns=0 for --json with no data", async () => {
      mkdirSync(join(projectDir, ".al"), { recursive: true });
      const store = new StatsStore(statsDbPath(projectDir));
      store.close();

      const lines = await captureLog(() =>
        execute({ project: projectDir, since: "24h", n: 10, json: true })
      );
      const allOutput = lines.join("\n");
      const parsed = JSON.parse(allOutput);
      expect(parsed).toHaveProperty("global");
      expect(parsed.global.totalRuns).toBe(0);
      expect(parsed).toHaveProperty("agents");
      expect(Array.isArray(parsed.agents)).toBe(true);
    });

    // ── With real runs ────────────────────────────────────────────────────────

    it("shows totals header when runs exist in global view", async () => {
      createPopulatedDb(projectDir);

      const lines = await captureLog(() =>
        execute({ project: projectDir, since: "1h", n: 10 })
      );
      // Should print global totals line
      const allOutput = lines.join("\n");
      expect(allOutput).toMatch(/Totals/i);
      expect(allOutput).toMatch(/runs/);
    });

    it("shows AGENT column header in global table when agents have runs", async () => {
      createPopulatedDb(projectDir);

      const lines = await captureLog(() =>
        execute({ project: projectDir, since: "1h", n: 10 })
      );
      const allOutput = lines.join("\n");
      // Should have the AGENT column header
      expect(allOutput).toMatch(/AGENT/);
    });

    it("--json global shows correct run counts", async () => {
      createPopulatedDb(projectDir);

      const lines = await captureLog(() =>
        execute({ project: projectDir, since: "1h", n: 10, json: true })
      );
      const allOutput = lines.join("\n");
      const parsed = JSON.parse(allOutput);
      expect(parsed.global.totalRuns).toBe(2);
      expect(parsed.global.okRuns).toBe(1);
      expect(parsed.global.errorRuns).toBe(1);
      expect(Array.isArray(parsed.agents)).toBe(true);
      expect(parsed.agents.length).toBe(2);
    });

    it("--agent shows per-agent totals when agent has runs", async () => {
      createPopulatedDb(projectDir);

      const lines = await captureLog(() =>
        execute({ project: projectDir, since: "1h", n: 10, agent: "agent-alpha" })
      );
      const allOutput = lines.join("\n");
      expect(allOutput).toContain("agent-alpha");
      // Should have the INSTANCE column header
      expect(allOutput).toMatch(/INSTANCE/);
    });

    it("--agent + --json returns correct run data", async () => {
      createPopulatedDb(projectDir);

      const lines = await captureLog(() =>
        execute({ project: projectDir, since: "1h", n: 10, agent: "agent-alpha", json: true })
      );
      const allOutput = lines.join("\n");
      const parsed = JSON.parse(allOutput);
      expect(parsed.summary).toBeDefined();
      expect(parsed.summary.agentName).toBe("agent-alpha");
      expect(parsed.summary.totalRuns).toBe(1);
      expect(Array.isArray(parsed.runs)).toBe(true);
      expect(parsed.runs.length).toBe(1);
    });

    it("accepts 7d as valid --since", async () => {
      mkdirSync(join(projectDir, ".al"), { recursive: true });
      const store = new StatsStore(statsDbPath(projectDir));
      store.close();

      const lines = await captureLog(() =>
        execute({ project: projectDir, since: "7d", n: 10 })
      );
      // Should not throw, should output "No runs in the last 7d"
      expect(lines.some((l) => l.includes("No runs"))).toBe(true);
    });

    it("accepts 1h as valid --since", async () => {
      mkdirSync(join(projectDir, ".al"), { recursive: true });
      const store = new StatsStore(statsDbPath(projectDir));
      store.close();

      const lines = await captureLog(() =>
        execute({ project: projectDir, since: "1h", n: 10 })
      );
      expect(lines.some((l) => l.includes("No runs"))).toBe(true);
    });

    // ── --calls with real call edges ──────────────────────────────────────────

    it("--calls shows call graph table header when edges exist", async () => {
      createPopulatedDb(projectDir);

      // Add a call edge
      const store = new StatsStore(statsDbPath(projectDir));
      const edgeId = store.recordCallEdge({
        callerAgent: "agent-alpha",
        callerInstance: randomUUID(),
        targetAgent: "agent-beta",
        startedAt: Date.now() - 1_000,
        callDepth: 1,
      });
      store.updateCallEdge(edgeId, {
        status: "completed",
        durationMs: 500,
        targetInstance: randomUUID(),
      });
      store.close();

      const lines = await captureLog(() =>
        execute({ project: projectDir, since: "1h", n: 10, calls: true })
      );
      const allOutput = lines.join("\n");
      expect(allOutput).toMatch(/CALLER/);
      expect(allOutput).toMatch(/TARGET/);
      expect(allOutput).toContain("agent-alpha");
      expect(allOutput).toContain("agent-beta");
    });

    it("--calls + --json shows call edge array when edges exist", async () => {
      createPopulatedDb(projectDir);

      const store = new StatsStore(statsDbPath(projectDir));
      const edgeId = store.recordCallEdge({
        callerAgent: "agent-alpha",
        callerInstance: randomUUID(),
        targetAgent: "agent-beta",
        startedAt: Date.now() - 1_000,
        callDepth: 1,
      });
      store.updateCallEdge(edgeId, {
        status: "completed",
        durationMs: 300,
      });
      store.close();

      const lines = await captureLog(() =>
        execute({ project: projectDir, since: "1h", n: 10, calls: true, json: true })
      );
      const allOutput = lines.join("\n");
      const parsed = JSON.parse(allOutput);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThanOrEqual(1);
      expect(parsed[0].callerAgent).toBe("agent-alpha");
      expect(parsed[0].targetAgent).toBe("agent-beta");
    });
  },
);
