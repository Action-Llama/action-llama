import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { captureLog } from "../../helpers.js";

// Mock fs.existsSync so we can control whether the stats DB exists
const mockExistsSync = vi.fn();
vi.mock("fs", async () => {
  const actual = await vi.importActual("fs") as any;
  return {
    ...actual,
    existsSync: (...args: any[]) => mockExistsSync(...args),
  };
});

// Mock paths module to return a fixed db path
vi.mock("../../../src/shared/paths.js", async () => {
  const actual = await vi.importActual("../../../src/shared/paths.js") as any;
  return {
    ...actual,
    statsDbPath: vi.fn().mockReturnValue("/fake/stats.db"),
  };
});

// Mock StatsStore
const mockQueryCallGraph = vi.fn();
const mockQueryAgentSummary = vi.fn();
const mockQueryRuns = vi.fn();
const mockQueryGlobalSummary = vi.fn();
const mockClose = vi.fn();

vi.mock("../../../src/stats/index.js", () => {
  class StatsStore {
    queryCallGraph = mockQueryCallGraph;
    queryAgentSummary = mockQueryAgentSummary;
    queryRuns = mockQueryRuns;
    queryGlobalSummary = mockQueryGlobalSummary;
    close = mockClose;
  }
  return { StatsStore };
});

import { execute } from "../../../src/cli/commands/stats.js";

const BASE_OPTS = { project: "/fake/project", since: "24h", n: 10 };

describe("stats execute — no stats DB", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  it("prints message and returns when stats DB does not exist", async () => {
    const output = await captureLog(() => execute(BASE_OPTS));
    expect(output).toContain("No stats data yet");
  });
});

describe("stats execute — global summary view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    expect(mockClose).toHaveBeenCalledOnce();
  });

  it("prints no-runs message when global summary has zero runs", async () => {
    mockQueryGlobalSummary.mockReturnValue({ totalRuns: 0, okRuns: 0, errorRuns: 0, totalTokens: 0, totalCost: 0 });
    mockQueryAgentSummary.mockReturnValue([]);

    const output = await captureLog(() => execute(BASE_OPTS));
    expect(output).toContain("No runs in the last 24h");
  });

  it("prints global totals and agent table with runs", async () => {
    mockQueryGlobalSummary.mockReturnValue({ totalRuns: 5, okRuns: 4, errorRuns: 1, totalTokens: 2500, totalCost: 0.05 });
    mockQueryAgentSummary.mockReturnValue([
      {
        agentName: "dev",
        totalRuns: 5,
        okRuns: 4,
        errorRuns: 1,
        avgDurationMs: 30000,
        totalTokens: 2500,
        totalCost: 0.05,
        avgPreHookMs: null,
        avgPostHookMs: null,
      },
    ]);

    const output = await captureLog(() => execute(BASE_OPTS));
    expect(output).toContain("5 runs");
    expect(output).toContain("4 ok");
    expect(output).toContain("1 err");
    expect(output).toContain("dev");
    expect(output).toContain("AGENT");
    expect(output).toContain("TOKENS");
    expect(output).toContain("COST");
  });

  it("outputs JSON when --json flag is set", async () => {
    mockQueryGlobalSummary.mockReturnValue({ totalRuns: 2, okRuns: 2, errorRuns: 0, totalTokens: 100, totalCost: 0.01 });
    mockQueryAgentSummary.mockReturnValue([]);

    const output = await captureLog(() => execute({ ...BASE_OPTS, json: true }));
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("global");
    expect(parsed).toHaveProperty("agents");
    expect(parsed.global.totalRuns).toBe(2);
  });
});

describe("stats execute — per-agent detail view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    expect(mockClose).toHaveBeenCalledOnce();
  });

  it("prints no-runs message when agent has no data", async () => {
    mockQueryAgentSummary.mockReturnValue([]);
    mockQueryRuns.mockReturnValue([]);

    const output = await captureLog(() => execute({ ...BASE_OPTS, agent: "missing-agent" }));
    expect(output).toContain('No runs for "missing-agent"');
  });

  it("prints agent summary and run table", async () => {
    mockQueryAgentSummary.mockReturnValue([
      {
        agentName: "dev",
        totalRuns: 3,
        okRuns: 3,
        errorRuns: 0,
        avgDurationMs: 60000,
        totalTokens: 1500,
        totalCost: 0.03,
        avgPreHookMs: null,
        avgPostHookMs: null,
      },
    ]);
    mockQueryRuns.mockReturnValue([
      {
        instance_id: "inst-abc-12345",
        trigger_type: "cron",
        result: "ok",
        duration_ms: 60000,
        total_tokens: 500,
        cost_usd: 0.01,
        started_at: new Date("2025-06-01T12:00:00Z").getTime(),
      },
    ]);

    const output = await captureLog(() => execute({ ...BASE_OPTS, agent: "dev" }));
    expect(output).toContain("dev");
    expect(output).toContain("3 runs");
    expect(output).toContain("INSTANCE");
    expect(output).toContain("TRIGGER");
    expect(output).toContain("RESULT");
  });

  it("outputs JSON with summary and runs when --json flag set", async () => {
    mockQueryAgentSummary.mockReturnValue([{ agentName: "dev", totalRuns: 1 }]);
    mockQueryRuns.mockReturnValue([{ instance_id: "inst-1", trigger_type: "cron", result: "ok", duration_ms: 100, total_tokens: 50, cost_usd: 0.001, started_at: 1234567890 }]);

    const output = await captureLog(() => execute({ ...BASE_OPTS, agent: "dev", json: true }));
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("summary");
    expect(parsed).toHaveProperty("runs");
    expect(parsed.summary.agentName).toBe("dev");
  });
});

describe("stats execute — calls view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    expect(mockClose).toHaveBeenCalledOnce();
  });

  it("prints no-edges message when there are no call edges", async () => {
    mockQueryCallGraph.mockReturnValue([]);

    const output = await captureLog(() => execute({ ...BASE_OPTS, calls: true }));
    expect(output).toContain("No call edges in the last 24h");
  });

  it("prints call graph table with edges", async () => {
    mockQueryCallGraph.mockReturnValue([
      {
        callerAgent: "orchestrator",
        targetAgent: "dev",
        count: 5,
        avgDepth: 1.4,
        avgDurationMs: 45000,
      },
    ]);

    const output = await captureLog(() => execute({ ...BASE_OPTS, calls: true }));
    expect(output).toContain("orchestrator");
    expect(output).toContain("dev");
    expect(output).toContain("CALLER");
    expect(output).toContain("TARGET");
    expect(output).toContain("COUNT");
  });

  it("outputs call graph as JSON when --json flag is set", async () => {
    const edges = [{ callerAgent: "a", targetAgent: "b", count: 1, avgDepth: 1, avgDurationMs: 100 }];
    mockQueryCallGraph.mockReturnValue(edges);

    const output = await captureLog(() => execute({ ...BASE_OPTS, calls: true, json: true }));
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].callerAgent).toBe("a");
  });
});

describe("stats execute — parseSince validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockQueryGlobalSummary.mockReturnValue({ totalRuns: 0, okRuns: 0, errorRuns: 0, totalTokens: 0, totalCost: 0 });
    mockQueryAgentSummary.mockReturnValue([]);
  });

  it("throws for invalid --since format", async () => {
    await expect(execute({ ...BASE_OPTS, since: "invalid" })).rejects.toThrow(
      "Invalid --since value: invalid"
    );
  });

  it("accepts hours format e.g. '24h'", async () => {
    await expect(execute({ ...BASE_OPTS, since: "24h" })).resolves.not.toThrow();
  });

  it("accepts days format e.g. '7d'", async () => {
    await expect(execute({ ...BASE_OPTS, since: "7d" })).resolves.not.toThrow();
  });
});

describe("stats formatting — formatDuration", () => {
  // Test formatDuration indirectly via the table output
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  it("formats sub-second durations as ms", async () => {
    mockQueryGlobalSummary.mockReturnValue({ totalRuns: 1, okRuns: 1, errorRuns: 0, totalTokens: 100, totalCost: 0.01 });
    mockQueryAgentSummary.mockReturnValue([
      { agentName: "dev", totalRuns: 1, okRuns: 1, errorRuns: 0, avgDurationMs: 500, totalTokens: 100, totalCost: 0.01, avgPreHookMs: null, avgPostHookMs: null },
    ]);
    const output = await captureLog(() => execute(BASE_OPTS));
    expect(output).toContain("500ms");
  });

  it("formats durations >= 1000ms as seconds", async () => {
    mockQueryGlobalSummary.mockReturnValue({ totalRuns: 1, okRuns: 1, errorRuns: 0, totalTokens: 100, totalCost: 0.01 });
    mockQueryAgentSummary.mockReturnValue([
      { agentName: "dev", totalRuns: 1, okRuns: 1, errorRuns: 0, avgDurationMs: 30000, totalTokens: 100, totalCost: 0.01, avgPreHookMs: null, avgPostHookMs: null },
    ]);
    const output = await captureLog(() => execute(BASE_OPTS));
    expect(output).toContain("30s");
  });

  it("formats durations >= 60s as minutes", async () => {
    mockQueryGlobalSummary.mockReturnValue({ totalRuns: 1, okRuns: 1, errorRuns: 0, totalTokens: 100, totalCost: 0.01 });
    mockQueryAgentSummary.mockReturnValue([
      { agentName: "dev", totalRuns: 1, okRuns: 1, errorRuns: 0, avgDurationMs: 120000, totalTokens: 100, totalCost: 0.01, avgPreHookMs: null, avgPostHookMs: null },
    ]);
    const output = await captureLog(() => execute(BASE_OPTS));
    expect(output).toContain("2m");
  });

  it("formats durations with remainder seconds as m+s", async () => {
    mockQueryGlobalSummary.mockReturnValue({ totalRuns: 1, okRuns: 1, errorRuns: 0, totalTokens: 100, totalCost: 0.01 });
    mockQueryAgentSummary.mockReturnValue([
      { agentName: "dev", totalRuns: 1, okRuns: 1, errorRuns: 0, avgDurationMs: 90000, totalTokens: 100, totalCost: 0.01, avgPreHookMs: null, avgPostHookMs: null },
    ]);
    const output = await captureLog(() => execute(BASE_OPTS));
    expect(output).toContain("1m30s");
  });
});

describe("stats formatting — formatTokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  it("formats tokens < 1000 as plain number", async () => {
    mockQueryGlobalSummary.mockReturnValue({ totalRuns: 1, okRuns: 1, errorRuns: 0, totalTokens: 500, totalCost: 0.01 });
    mockQueryAgentSummary.mockReturnValue([
      { agentName: "dev", totalRuns: 1, okRuns: 1, errorRuns: 0, avgDurationMs: 1000, totalTokens: 500, totalCost: 0.01, avgPreHookMs: null, avgPostHookMs: null },
    ]);
    const output = await captureLog(() => execute(BASE_OPTS));
    expect(output).toContain("500");
  });

  it("formats tokens >= 1000 as K", async () => {
    mockQueryGlobalSummary.mockReturnValue({ totalRuns: 1, okRuns: 1, errorRuns: 0, totalTokens: 2500, totalCost: 0.01 });
    mockQueryAgentSummary.mockReturnValue([
      { agentName: "dev", totalRuns: 1, okRuns: 1, errorRuns: 0, avgDurationMs: 1000, totalTokens: 2500, totalCost: 0.01, avgPreHookMs: null, avgPostHookMs: null },
    ]);
    const output = await captureLog(() => execute(BASE_OPTS));
    expect(output).toContain("2.5K");
  });

  it("formats tokens >= 1_000_000 as M", async () => {
    mockQueryGlobalSummary.mockReturnValue({ totalRuns: 1, okRuns: 1, errorRuns: 0, totalTokens: 2_000_000, totalCost: 0.01 });
    mockQueryAgentSummary.mockReturnValue([
      { agentName: "dev", totalRuns: 1, okRuns: 1, errorRuns: 0, avgDurationMs: 1000, totalTokens: 2_000_000, totalCost: 0.01, avgPreHookMs: null, avgPostHookMs: null },
    ]);
    const output = await captureLog(() => execute(BASE_OPTS));
    expect(output).toContain("2.0M");
  });
});

describe("stats execute — edge cases for call graph and per-agent views", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    expect(mockClose).toHaveBeenCalledOnce();
  });

  it("shows em dash for avgDurationMs null in call graph table (em dash path)", async () => {
    mockQueryCallGraph.mockReturnValue([
      {
        callerAgent: "orchestrator",
        targetAgent: "dev",
        count: 3,
        avgDepth: null,       // null → avgDepth ?? 0 path
        avgDurationMs: null,  // null → em dash path
      },
    ]);

    const output = await captureLog(() => execute({ ...BASE_OPTS, calls: true }));
    expect(output).toContain("orchestrator");
    // avgDurationMs null → em dash
    expect(output).toContain("—");
    // avgDepth null → ?? 0 → shows "0"
    expect(output).toContain("0");
  });

  it("outputs null summary in JSON when per-agent summary not found (summaries[0] || null path)", async () => {
    // JSON mode with empty summaries → summaries[0] is undefined → || null path
    mockQueryAgentSummary.mockReturnValue([]);
    mockQueryRuns.mockReturnValue([{ instance_id: "inst-1", trigger_type: "cron", result: "ok", duration_ms: 100, total_tokens: 50, cost_usd: 0.001, started_at: 1234567890 }]);

    const output = await captureLog(() => execute({ ...BASE_OPTS, agent: "missing-agent", json: true }));
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("summary");
    expect(parsed.summary).toBeNull();
    expect(parsed).toHaveProperty("runs");
  });

  it("shows agent summary without run table when runs list is empty (runs.length === 0 path)", async () => {
    // Agent has summary but no runs returned for the time window
    mockQueryAgentSummary.mockReturnValue([
      {
        agentName: "dev",
        totalRuns: 1,
        okRuns: 1,
        errorRuns: 0,
        avgDurationMs: 5000,
        totalTokens: 100,
        totalCost: 0.001,
        avgPreHookMs: null,
        avgPostHookMs: null,
      },
    ]);
    mockQueryRuns.mockReturnValue([]);  // empty runs list

    const output = await captureLog(() => execute({ ...BASE_OPTS, agent: "dev" }));
    // Summary line should appear
    expect(output).toContain("dev");
    expect(output).toContain("1 runs");
    // Run table headers should NOT appear (runs.length === 0)
    expect(output).not.toContain("INSTANCE");
    expect(output).not.toContain("TRIGGER");
  });
});

describe("stats execute — per-agent run table instance_id truncation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    expect(mockClose).toHaveBeenCalledOnce();
  });

  it("truncates instance_id longer than 18 characters with ellipsis prefix", async () => {
    mockQueryAgentSummary.mockReturnValue([
      {
        agentName: "dev",
        totalRuns: 1,
        okRuns: 1,
        errorRuns: 0,
        avgDurationMs: 5000,
        totalTokens: 100,
        totalCost: 0.001,
        avgPreHookMs: null,
        avgPostHookMs: null,
      },
    ]);
    // instance_id that is exactly 19 chars — triggers the > 18 truncation branch
    const longInstanceId = "inst-very-long-12345"; // 20 chars
    mockQueryRuns.mockReturnValue([
      {
        instance_id: longInstanceId,
        trigger_type: "cron",
        result: "ok",
        duration_ms: 5000,
        total_tokens: 100,
        cost_usd: 0.001,
        started_at: new Date("2025-06-01T12:00:00Z").getTime(),
      },
    ]);

    const output = await captureLog(() => execute({ ...BASE_OPTS, agent: "dev" }));
    // Should show truncated form: "..." + last 15 chars
    expect(output).toContain("...");
    // The last 15 chars of "inst-very-long-12345" = "very-long-12345"
    expect(output).toContain("very-long-12345");
    // Full instance_id should NOT appear
    expect(output).not.toContain("inst-very-long-12345");
  });

  it("does not truncate instance_id of exactly 18 characters", async () => {
    mockQueryAgentSummary.mockReturnValue([
      {
        agentName: "dev",
        totalRuns: 1,
        okRuns: 1,
        errorRuns: 0,
        avgDurationMs: 5000,
        totalTokens: 100,
        totalCost: 0.001,
        avgPreHookMs: null,
        avgPostHookMs: null,
      },
    ]);
    const exactInstance = "inst-exactly-18chr"; // 18 chars exactly
    mockQueryRuns.mockReturnValue([
      {
        instance_id: exactInstance,
        trigger_type: "cron",
        result: "ok",
        duration_ms: 5000,
        total_tokens: 100,
        cost_usd: 0.001,
        started_at: new Date("2025-06-01T12:00:00Z").getTime(),
      },
    ]);

    const output = await captureLog(() => execute({ ...BASE_OPTS, agent: "dev" }));
    // Should show full instance_id without truncation
    expect(output).toContain("inst-exactly-18chr");
  });
});

describe("stats execute — global summary avgPreHookMs/avgPostHookMs non-null", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    expect(mockClose).toHaveBeenCalledOnce();
  });

  it("shows formatted duration for avgPreHookMs when non-null", async () => {
    mockQueryGlobalSummary.mockReturnValue({ totalRuns: 1, okRuns: 1, errorRuns: 0, totalTokens: 100, totalCost: 0.01 });
    mockQueryAgentSummary.mockReturnValue([
      {
        agentName: "dev",
        totalRuns: 1,
        okRuns: 1,
        errorRuns: 0,
        avgDurationMs: 30000,
        totalTokens: 100,
        totalCost: 0.01,
        avgPreHookMs: 2500,   // non-null → should show "2s" or "2500ms" formatted
        avgPostHookMs: null,
      },
    ]);

    const output = await captureLog(() => execute(BASE_OPTS));
    // avgPreHookMs=2500ms → formatDuration(2500) = "3s" (rounded)
    expect(output).toContain("AVG PRE");
    // em dash should not appear for pre (it's non-null)
    // The output line should contain a formatted duration for pre
    // and "—" for post (null)
    const lines = output.split("\n");
    const dataLine = lines.find(l => l.includes("dev"));
    expect(dataLine).toBeDefined();
    // The post hook should show em dash
    expect(dataLine).toContain("—");
  });

  it("shows formatted duration for avgPostHookMs when non-null", async () => {
    mockQueryGlobalSummary.mockReturnValue({ totalRuns: 1, okRuns: 1, errorRuns: 0, totalTokens: 100, totalCost: 0.01 });
    mockQueryAgentSummary.mockReturnValue([
      {
        agentName: "dev",
        totalRuns: 1,
        okRuns: 1,
        errorRuns: 0,
        avgDurationMs: 30000,
        totalTokens: 100,
        totalCost: 0.01,
        avgPreHookMs: null,
        avgPostHookMs: 5000,  // non-null → should show "5s" formatted
      },
    ]);

    const output = await captureLog(() => execute(BASE_OPTS));
    expect(output).toContain("AVG POST");
    const lines = output.split("\n");
    const dataLine = lines.find(l => l.includes("dev"));
    expect(dataLine).toBeDefined();
    // pre is null → em dash; post is non-null → formatted duration
    expect(dataLine).toContain("—");
  });

  it("shows formatted durations for both avgPreHookMs and avgPostHookMs when both non-null", async () => {
    mockQueryGlobalSummary.mockReturnValue({ totalRuns: 2, okRuns: 2, errorRuns: 0, totalTokens: 200, totalCost: 0.02 });
    mockQueryAgentSummary.mockReturnValue([
      {
        agentName: "dev",
        totalRuns: 2,
        okRuns: 2,
        errorRuns: 0,
        avgDurationMs: 60000,
        totalTokens: 200,
        totalCost: 0.02,
        avgPreHookMs: 1000,   // non-null → "1s"
        avgPostHookMs: 2000,  // non-null → "2s"
      },
    ]);

    const output = await captureLog(() => execute(BASE_OPTS));
    const lines = output.split("\n");
    const dataLine = lines.find(l => l.includes("dev"));
    expect(dataLine).toBeDefined();
    // Neither should show em dash (both are non-null)
    // Two formatted durations should appear (1s and 2s)
    expect(output).toContain("1s");
    expect(output).toContain("2s");
  });
});
