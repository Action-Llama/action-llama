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
const mockRun = vi.fn().mockResolvedValue("silent");
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

  it("creates runners for each agent", async () => {
    const { runners } = await startScheduler(tmpDir);
    expect(Object.keys(runners).sort()).toEqual(["dev", "devops", "reviewer"]);
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
    expect(mockLoggerWarn).toHaveBeenCalledWith(expect.stringContaining("busy"));
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
      .mockResolvedValueOnce("completed")
      .mockResolvedValueOnce("silent")
      .mockResolvedValue("silent");
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
    mockRun.mockResolvedValue("completed");

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
    mockRun.mockResolvedValue("error");
    await startScheduler(tmpDir);

    await new Promise((r) => setTimeout(r, 50));

    // 3 agents, each runs once (error, no rerun)
    expect(mockRun).toHaveBeenCalledTimes(3);
  });
});
