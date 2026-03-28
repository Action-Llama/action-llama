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
