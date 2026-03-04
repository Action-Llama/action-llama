import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

// Mock credentials
vi.mock("../../src/shared/credentials.js", () => ({
  loadCredential: () => "fake-token",
  requireCredential: () => "fake-token",
  writeCredential: () => {},
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
const mockRun = vi.fn().mockResolvedValue(undefined);
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
  writeFileSync(resolve(tmpDir, "config.json"), JSON.stringify(globalConfig));

  const model = { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" };
  const agents = [
    { name: "dev", credentials: ["github-token"], model, schedule: "*/5 * * * *", repos: ["acme/app"] },
    { name: "reviewer", credentials: ["github-token"], model, schedule: "*/5 * * * *", repos: ["acme/app"] },
    { name: "devops", credentials: ["github-token"], model, schedule: "*/15 * * * *", repos: ["acme/app"] },
  ];

  for (const agent of agents) {
    const agentDir = resolve(tmpDir, agent.name);
    mkdirSync(agentDir, { recursive: true });
    // Strip name before writing (matches scaffold behavior — name is injected at load time)
    const { name: _, ...configToWrite } = agent;
    writeFileSync(resolve(agentDir, "config.json"), JSON.stringify(configToWrite));
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
});
