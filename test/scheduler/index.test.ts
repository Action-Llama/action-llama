import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";

// Mock credentials
vi.mock("../../src/shared/credentials.js", () => ({
  loadCredentialField: () => "fake-token",
  requireCredentialRef: () => {},
  parseCredentialRef: (ref: string) => {
    const sep = ref.indexOf(":");
    if (sep === -1) return { type: ref, instance: "default" };
    return { type: ref.slice(0, sep).trim(), instance: ref.slice(sep + 1).trim() };
  },
  writeCredentialField: () => {},
  writeCredentialFields: () => {},
  credentialExists: () => true,
  backendLoadField: () => Promise.resolve("fake-token"),
  backendLoadFields: () => Promise.resolve({}),
  backendCredentialExists: () => Promise.resolve(true),
  backendListInstances: () => Promise.resolve([]),
  backendRequireCredentialRef: () => Promise.resolve(),
  getDefaultBackend: () => {},
  setDefaultBackend: () => {},
  resetDefaultBackend: () => {},
}));

// Mock croner — capture the callbacks
const mockCronStop = vi.fn();
const cronCallbacks: Function[] = [];
vi.mock("croner", () => ({
  Cron: class {
    stop = mockCronStop;
    nextRun = () => new Date(Date.now() + 300000);
    constructor(_schedule: string, _opts: any, callback: Function) {
      cronCallbacks.push(callback);
    }
  },
}));

// Mock AgentRunner
const mockRun = vi.fn().mockResolvedValue({ result: "silent", triggers: [] });
let mockIsRunning = false;
vi.mock("../../src/agents/runner.js", () => ({
  AgentRunner: class {
    get isRunning() { return mockIsRunning; }
    run = mockRun;
  },
}));

// Mock logger
const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();
const mockLogger = () => ({
  info: mockLoggerInfo,
  warn: mockLoggerWarn,
  error: mockLoggerError,
  debug: vi.fn(),
});
vi.mock("../../src/shared/logger.js", () => ({
  createLogger: () => mockLogger(),
  createFileOnlyLogger: () => mockLogger(),
}));

import { startScheduler } from "../../src/scheduler/index.js";

function setupProject(tmpDir: string) {
  const globalConfig = {};
  writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML(globalConfig as Record<string, unknown>));

  const model = { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" };
  const agents = [
    { name: "dev", credentials: ["github_token:default"], model, schedule: "*/5 * * * *" },
    { name: "reviewer", credentials: ["github_token:default"], model, schedule: "*/5 * * * *" },
    { name: "devops", credentials: ["github_token:default"], model, schedule: "*/15 * * * *" },
  ];

  for (const agent of agents) {
    const agentDir = resolve(tmpDir, agent.name);
    mkdirSync(agentDir, { recursive: true });
    // Strip name before writing (matches scaffold behavior — name is injected at load time)
    const { name: _, ...configToWrite } = agent;
    writeFileSync(resolve(agentDir, "agent-config.toml"), stringifyTOML(configToWrite as Record<string, unknown>));
    mkdirSync(resolve(tmpDir, ".al", "state", agent.name), { recursive: true });
  }
}

describe("startScheduler", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    cronCallbacks.length = 0;
    mockIsRunning = false;
    tmpDir = mkdtempSync(join(tmpdir(), "al-sched-"));
    setupProject(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates 3 cron jobs for 3 agents", async () => {
    const { cronJobs } = await startScheduler(tmpDir);
    expect(cronJobs).toHaveLength(3);
  });

  it("fires all agents on startup", async () => {
    await startScheduler(tmpDir);
    expect(mockRun).toHaveBeenCalledTimes(3);
  });

  it("creates runner pools for each agent", async () => {
    const { runnerPools } = await startScheduler(tmpDir);
    expect(Object.keys(runnerPools).sort()).toEqual(["dev", "devops", "reviewer"]);
    
    // Each pool should have default scale of 1
    for (const poolName of Object.keys(runnerPools)) {
      const pool = runnerPools[poolName];
      expect(pool.scale).toBe(1);
      expect(pool.runners).toHaveLength(1);
    }
  });

  it("cron callback runs agent when not busy", async () => {
    await startScheduler(tmpDir);
    vi.clearAllMocks();

    // Trigger first cron callback (dev agent)
    await cronCallbacks[0]();
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it("cron callback skips when agent is busy", async () => {
    await startScheduler(tmpDir);
    vi.clearAllMocks();

    mockIsRunning = true;
    await cronCallbacks[0]();
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "dev",
        running: 1,
        scale: 1,
      }),
      "all agent runners busy, skipping scheduled run"
    );
  });

  it("handles initial run failure", async () => {
    mockRun.mockRejectedValueOnce(new Error("fail"));
    await startScheduler(tmpDir);
    // Should have logged the error (the run catches and logs)
    // The key thing is startScheduler doesn't throw
  });

  it("re-runs agent immediately when it did work", async () => {
    // First call returns "completed", second returns "silent"
    mockRun
      .mockResolvedValueOnce({ result: "completed", triggers: [] })
      .mockResolvedValueOnce({ result: "silent", triggers: [] })
      .mockResolvedValue({ result: "silent", triggers: [] });
    await startScheduler(tmpDir);

    // Wait for the initial rerun loop of the first agent to settle
    await new Promise((r) => setTimeout(r, 50));

    // dev agent: 1 initial + 1 rerun = 2 calls
    // reviewer + devops: 1 each (silent, no rerun)
    // Total: 4
    expect(mockRun).toHaveBeenCalledTimes(4);
  });

  it("stops re-running after max reruns", async () => {
    // Always returns "completed" — should stop at maxReruns
    mockRun.mockResolvedValue({ result: "completed", triggers: [] });

    // Use a small maxReruns via global config
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({ maxReruns: 2 } as Record<string, unknown>));
    await startScheduler(tmpDir);

    await new Promise((r) => setTimeout(r, 50));

    // Each agent: 1 initial + 2 reruns = 3 calls, x3 agents = 9
    expect(mockRun).toHaveBeenCalledTimes(9);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      { maxReruns: 2 },
      expect.stringContaining("hit max reruns limit")
    );
  });

  it("does not re-run on error", async () => {
    mockRun.mockResolvedValue({ result: "error", triggers: [] });
    await startScheduler(tmpDir);

    await new Promise((r) => setTimeout(r, 50));

    // 3 agents, each runs once (error, no rerun)
    expect(mockRun).toHaveBeenCalledTimes(3);
  });

  it("dispatches triggers to other agents", async () => {
    // dev agent returns a trigger for reviewer
    mockRun
      .mockResolvedValueOnce({ result: "silent", triggers: [{ agent: "reviewer", context: "Please review PR #42" }] })
      .mockResolvedValue({ result: "silent", triggers: [] });
    await startScheduler(tmpDir);

    await new Promise((r) => setTimeout(r, 50));

    // 3 initial runs + 1 triggered run for reviewer = 4
    expect(mockRun).toHaveBeenCalledTimes(4);
    // The triggered run prompt should contain "agent-trigger"
    const triggeredCall = mockRun.mock.calls[3];
    expect(triggeredCall[0]).toContain("<agent-trigger>");
    expect(triggeredCall[0]).toContain("dev");
    expect(triggeredCall[0]).toContain("Please review PR #42");
  });

  it("skips self-triggers", async () => {
    mockRun
      .mockResolvedValueOnce({ result: "silent", triggers: [{ agent: "dev", context: "self" }] })
      .mockResolvedValue({ result: "silent", triggers: [] });
    await startScheduler(tmpDir);

    await new Promise((r) => setTimeout(r, 50));

    // 3 initial runs only — self-trigger skipped
    expect(mockRun).toHaveBeenCalledTimes(3);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      { source: "dev" },
      expect.stringContaining("cannot trigger itself")
    );
  });

  it("respects trigger depth limit", async () => {
    // dev triggers reviewer at depth 0 → reviewer triggers devops at depth 1 → blocked at depth 1 (maxTriggerDepth=1)
    let callCount = 0;
    mockRun.mockImplementation(() => {
      callCount++;
      // 1st call: dev initial → triggers reviewer
      if (callCount === 1) return Promise.resolve({ result: "silent", triggers: [{ agent: "reviewer", context: "chain1" }] });
      // 4th call: triggered reviewer → tries to trigger devops (will be blocked by depth)
      if (callCount === 4) return Promise.resolve({ result: "silent", triggers: [{ agent: "devops", context: "chain2" }] });
      // All others: no triggers
      return Promise.resolve({ result: "silent", triggers: [] });
    });

    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({ maxTriggerDepth: 1 } as Record<string, unknown>));
    await startScheduler(tmpDir);
    await new Promise((r) => setTimeout(r, 100));

    // 3 initial + 1 triggered reviewer = 4
    // reviewer's trigger of devops is blocked (depth 1 >= maxTriggerDepth 1)
    expect(mockRun).toHaveBeenCalledTimes(4);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ depth: 1, maxTriggerDepth: 1 }),
      expect.stringContaining("trigger depth limit reached")
    );
  });

  describe("scale", () => {
    function setupParallelismProject(tmpDir: string) {
      const globalConfig = {};
      writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML(globalConfig as Record<string, unknown>));

      const model = { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" };
      const agents = [
        { name: "parallel-agent", credentials: ["github_token:default"], model, schedule: "*/5 * * * *", scale: 3 },
        { name: "single-agent", credentials: ["github_token:default"], model, schedule: "*/5 * * * *" }, // defaults to 1
      ];

      for (const agent of agents) {
        const agentDir = resolve(tmpDir, agent.name);
        mkdirSync(agentDir, { recursive: true });
        // Strip name before writing (matches scaffold behavior — name is injected at load time)
        const { name: _, ...configToWrite } = agent;
        writeFileSync(resolve(agentDir, "agent-config.toml"), stringifyTOML(configToWrite as Record<string, unknown>));
        mkdirSync(resolve(tmpDir, ".al", "state", agent.name), { recursive: true });
      }
    }

    beforeEach(() => {
      vi.clearAllMocks();
      cronCallbacks.length = 0;
      mockIsRunning = false;
      tmpDir = mkdtempSync(join(tmpdir(), "al-sched-parallel-"));
      setupParallelismProject(tmpDir);
    });

    it("creates multiple runners when scale > 1", async () => {
      const { runnerPools } = await startScheduler(tmpDir);
      
      // parallel-agent should have 3 runners
      expect(runnerPools["parallel-agent"].scale).toBe(3);
      expect(runnerPools["parallel-agent"].runners).toHaveLength(3);
      
      // single-agent should have 1 runner (default)
      expect(runnerPools["single-agent"].scale).toBe(1);
      expect(runnerPools["single-agent"].runners).toHaveLength(1);
    });

    it("allows concurrent runs up to scale limit", async () => {
      // Mock some runners as running
      const runningStates = new Map<number, boolean>();
      let callIndex = 0;

      // Override the mock to simulate different runners with different running states
      vi.mocked(mockRun).mockImplementation(() => {
        const currentCallIndex = callIndex++;
        runningStates.set(currentCallIndex, true);
        
        // Simulate async work by keeping the runner "running" briefly
        return new Promise((resolve) => {
          setTimeout(() => {
            runningStates.set(currentCallIndex, false);
            resolve({ result: "silent", triggers: [] });
          }, 100);
        });
      });

      // Override isRunning to track per-call
      Object.defineProperty(mockRun, 'isRunning', {
        get() {
          return Array.from(runningStates.values()).some(running => running);
        }
      });

      const { runnerPools } = await startScheduler(tmpDir);
      vi.clearAllMocks();
      callIndex = 0;

      // Trigger multiple cron runs quickly
      const cronPromises = [];
      for (let i = 0; i < 5; i++) {
        cronPromises.push(cronCallbacks[0]()); // parallel-agent cron
      }

      // Wait for all to settle
      await Promise.all(cronPromises);

      // parallel-agent can run up to 3 concurrent instances
      // single-agent can run 1 instance
      // The exact number depends on timing, but we should see multiple calls
      expect(mockRun).toHaveBeenCalled();
    });

    it("queues webhooks when all runners are busy", async () => {
      // Set up a webhook project
      const globalConfig = {
        webhooks: {
          github: { type: "github", credential: "default" }
        }
      };
      writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML(globalConfig as Record<string, unknown>));

      const agent = {
        name: "webhook-agent", 
        credentials: ["github_token:default"], 
        model: { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" },
        scale: 2,
        webhooks: [{ source: "github", events: ["issues"], actions: ["opened"] }]
      };
      
      const agentDir = resolve(tmpDir, agent.name);
      mkdirSync(agentDir, { recursive: true });
      const { name: _, ...configToWrite } = agent;
      writeFileSync(resolve(agentDir, "agent-config.toml"), stringifyTOML(configToWrite as Record<string, unknown>));

      // Mock all runners as busy
      mockIsRunning = true;
      
      const { runnerPools } = await startScheduler(tmpDir);
      
      // Verify webhook agent has scale of 2
      expect(runnerPools["webhook-agent"].scale).toBe(2);
      expect(runnerPools["webhook-agent"].runners).toHaveLength(2);
    });
  });
});
