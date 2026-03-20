import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";
import { stringify as stringifyYAML } from "yaml";

// Mock child_process for Docker check
vi.mock("child_process", () => ({
  execFileSync: vi.fn((_cmd: string, _args: string[]) => ""),
}));

// Mock Docker/container related modules
vi.mock("../../src/scheduler/image-builder.js", () => ({
  buildAllImages: vi.fn().mockResolvedValue({
    baseImage: "test-base-image",
    agentImages: {
      dev: "test-dev-image",
      reviewer: "test-reviewer-image", 
      devops: "test-devops-image"
    }
  })
}));

vi.mock("../../src/docker/local-runtime.js", () => ({
  LocalDockerRuntime: class MockLocalDockerRuntime {
    constructor() {
      // Mock runtime methods if needed
    }
  }
}));

vi.mock("../../src/docker/network.js", () => ({
  ensureNetwork: vi.fn()
}));

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

// Mock AgentRunner
const mockRun = vi.fn().mockResolvedValue({ result: "completed", triggers: [] });
let mockIsRunning = false;
vi.mock("../../src/agents/runner.js", () => ({
  AgentRunner: class {
    get isRunning() { return mockIsRunning; }
    run = mockRun;
  },
}));

vi.mock("../../src/agents/container-runner.js", () => ({
  ContainerAgentRunner: class MockContainerAgentRunner {
    run = mockRun;
    get isRunning() { return mockIsRunning; }
  }
}));

// Mock croner — capture the callbacks
const mockCronStop = vi.fn();
const mockCronPause = vi.fn();
const mockCronResume = vi.fn();
const cronCallbacks: Function[] = [];
vi.mock("croner", () => ({
  Cron: class {
    stop = mockCronStop;
    pause = mockCronPause;
    resume = mockCronResume;
    nextRun = () => new Date(Date.now() + 300000);
    constructor(_schedule: string, _opts: any, callback: Function) {
      cronCallbacks.push(callback);
    }
  },
}));

// Mock gateway
vi.mock("../../src/gateway/index.js", () => ({
  startGateway: vi.fn().mockResolvedValue({
    server: {},
    registerContainer: vi.fn(),
    unregisterContainer: vi.fn(),
    lockStore: { releaseAll: vi.fn(), dispose: vi.fn() },
    callStore: { failAllByCaller: vi.fn(), dispose: vi.fn() },
    setCallDispatcher: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock gateway API key
vi.mock("../../src/gateway/api-key.js", () => ({
  ensureGatewayApiKey: vi.fn().mockResolvedValue({ key: "test-api-key", generated: false }),
}));

// Mock state store
vi.mock("../../src/shared/state-store.js", () => ({
  createStateStore: vi.fn().mockResolvedValue({
    get: vi.fn(),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock logger
const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();
const mockLogger = (): Record<string, any> => {
  const logger: Record<string, any> = {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    debug: vi.fn(),
    child: () => mockLogger(),
  };
  return logger;
};
vi.mock("../../src/shared/logger.js", () => ({
  createLogger: () => mockLogger(),
  createFileOnlyLogger: () => mockLogger(),
}));

import { startScheduler } from "../../src/scheduler/index.js";

function writeSkillMd(dir: string, config: Record<string, unknown>) {
  const { name: _, ...configToWrite } = config;
  const yamlStr = stringifyYAML(configToWrite).trimEnd();
  writeFileSync(resolve(dir, "SKILL.md"), `---\n${yamlStr}\n---\n\n# Agent\n`);
}

function setupProject(tmpDir: string) {
  const globalConfig = {};
  writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML(globalConfig as Record<string, unknown>));

  const model = { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" };
  const agents = [
    { name: "dev", credentials: ["github_token"], model, schedule: "*/5 * * * *" },
    { name: "reviewer", credentials: ["github_token"], model, schedule: "*/5 * * * *" },
    { name: "devops", credentials: ["github_token"], model, schedule: "*/15 * * * *" },
  ];

  for (const agent of agents) {
    const agentDir = resolve(tmpDir, "agents", agent.name);
    mkdirSync(agentDir, { recursive: true });
    writeSkillMd(agentDir, agent);
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
      expect(pool.size).toBe(1);
    }
  });

  it("cron callback runs agent when not busy", async () => {
    await startScheduler(tmpDir);
    vi.clearAllMocks();

    // Trigger first cron callback (dev agent)
    await cronCallbacks[0]();
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it("cron callback queues when agent is busy", async () => {
    await startScheduler(tmpDir);
    vi.clearAllMocks();

    mockIsRunning = true;
    await cronCallbacks[0]();
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "dev",
        running: 1,
        scale: 1,
      }),
      "all runners busy, scheduled run queued"
    );
  });

  it("handles initial run failure", async () => {
    mockRun.mockRejectedValueOnce(new Error("fail"));
    await startScheduler(tmpDir);
    // Should have logged the error (the run catches and logs)
    // The key thing is startScheduler doesn't throw
  });

  it("re-runs agent immediately when it requests rerun", async () => {
    // First call returns "rerun", second returns "completed" (no more work)
    mockRun
      .mockResolvedValueOnce({ result: "rerun", triggers: [] })
      .mockResolvedValueOnce({ result: "completed", triggers: [] })
      .mockResolvedValueOnce({ result: "completed", triggers: [] })
      .mockResolvedValue({ result: "completed", triggers: [] });
    await startScheduler(tmpDir);

    // Wait for the initial rerun loop to settle
    await new Promise((r) => setTimeout(r, 200));

    // dev: 1 initial + 1 rerun = 2, reviewer: 1, devops: 1 = 4 total
    expect(mockRun).toHaveBeenCalledTimes(4);
  });

  it("stops re-running after max reruns", async () => {
    // Always returns "rerun" — should stop at maxReruns
    mockRun.mockResolvedValue({ result: "rerun", triggers: [] });

    // Use a small maxReruns via global config
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({ maxReruns: 2 } as Record<string, unknown>));
    await startScheduler(tmpDir);

    await new Promise((r) => setTimeout(r, 50));

    // 3 agents × (1 initial + 2 reruns) = 9 calls total
    expect(mockRun).toHaveBeenCalledTimes(9);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      { maxReruns: 2 },
      "dev hit max reruns limit"
    );
  });

  it("does not re-run on error", async () => {
    mockRun.mockResolvedValue({ result: "error" });
    await startScheduler(tmpDir);

    await new Promise((r) => setTimeout(r, 50));

    // 3 agents, each runs once (error, no rerun)
    expect(mockRun).toHaveBeenCalledTimes(3);
  });

  it("returns returnValue in run outcome", async () => {
    mockRun.mockResolvedValueOnce({ result: "completed", returnValue: "some result" })
      .mockResolvedValue({ result: "completed" });
    await startScheduler(tmpDir);

    await new Promise((r) => setTimeout(r, 50));

    // All 3 agents should run
    expect(mockRun).toHaveBeenCalledTimes(3);
  });

  describe("scale", () => {
    function setupScaleProject(tmpDir: string) {
      const globalConfig = {};
      writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML(globalConfig as Record<string, unknown>));

      const model = { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" };
      const agents = [
        { name: "scaled-agent", credentials: ["github_token"], model, schedule: "*/5 * * * *", scale: 3 },
        { name: "single-agent", credentials: ["github_token"], model, schedule: "*/5 * * * *" }, // defaults to 1
      ];

      for (const agent of agents) {
        const agentDir = resolve(tmpDir, "agents", agent.name);
        mkdirSync(agentDir, { recursive: true });
        writeSkillMd(agentDir, agent);
        mkdirSync(resolve(tmpDir, ".al", "state", agent.name), { recursive: true });
      }
    }

    beforeEach(() => {
      vi.clearAllMocks();
      cronCallbacks.length = 0;
      mockIsRunning = false;
      tmpDir = mkdtempSync(join(tmpdir(), "al-sched-scale-"));
      setupScaleProject(tmpDir);
    });

    it("creates multiple runners when scale > 1", async () => {
      const { runnerPools } = await startScheduler(tmpDir);

      // scaled-agent should have 3 runners
      expect(runnerPools["scaled-agent"].size).toBe(3);

      // single-agent should have 1 runner (default)
      expect(runnerPools["single-agent"].size).toBe(1);
    });

    it("handles busy runners with scale", async () => {
      const { runnerPools } = await startScheduler(tmpDir);

      expect(runnerPools["scaled-agent"].size).toBe(3);
      expect(runnerPools["scaled-agent"].hasRunningJobs).toBe(false);
      expect(runnerPools["scaled-agent"].runningJobCount).toBe(0);
    });

    it("logs scale configuration", async () => {
      await startScheduler(tmpDir);

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        { agent: "scaled-agent", scale: 3 },
        "Created runner pool"
      );
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        { agent: "single-agent", scale: 1 },
        "Created runner pool"
      );
    });
  });

  describe("scale = 0 (disabled agent)", () => {
    function setupDisabledProject(tmpDir: string) {
      const globalConfig = {};
      writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML(globalConfig as Record<string, unknown>));

      const model = { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" };
      const agents = [
        { name: "active-agent", credentials: ["github_token"], model, schedule: "*/5 * * * *" },
        { name: "disabled-agent", credentials: ["github_token"], model, schedule: "*/5 * * * *", scale: 0 },
      ];

      for (const agent of agents) {
        const agentDir = resolve(tmpDir, "agents", agent.name);
        mkdirSync(agentDir, { recursive: true });
        writeSkillMd(agentDir, agent);
        mkdirSync(resolve(tmpDir, ".al", "state", agent.name), { recursive: true });
      }
    }

    beforeEach(() => {
      vi.clearAllMocks();
      cronCallbacks.length = 0;
      mockIsRunning = false;
      tmpDir = mkdtempSync(join(tmpdir(), "al-sched-disabled-"));
      setupDisabledProject(tmpDir);
    });

    it("creates an empty runner pool for scale = 0 agents", async () => {
      const { runnerPools } = await startScheduler(tmpDir);

      expect(runnerPools["disabled-agent"].size).toBe(0);
      expect(runnerPools["active-agent"].size).toBe(1);
    });

    it("does not create cron jobs for scale = 0 agents", async () => {
      await startScheduler(tmpDir);

      // Only the active agent should have a cron job
      expect(cronCallbacks).toHaveLength(1);
    });

    it("allows scale = 0 agent without schedule or webhooks", async () => {
      // Overwrite disabled-agent config to have no schedule
      const model = { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" };
      const agentDir = resolve(tmpDir, "agents", "disabled-agent");
      writeSkillMd(agentDir, { name: "disabled-agent", credentials: ["github_token"], model, scale: 0 });

      // Should not throw — scale=0 skips schedule/webhook validation
      const { runnerPools } = await startScheduler(tmpDir);
      expect(runnerPools["disabled-agent"].size).toBe(0);
    });
  });

  describe("scheduler pause", () => {
    function makeStatusTracker(paused: boolean) {
      return {
        isPaused: vi.fn().mockReturnValue(paused),
        isAgentEnabled: vi.fn().mockReturnValue(true),
        registerAgent: vi.fn(),
        setPaused: vi.fn(),
        setNextRunAt: vi.fn(),
        on: vi.fn(),
        enableAgent: vi.fn(),
        disableAgent: vi.fn(),
      } as any;
    }

    it("cron callback does not run agent when paused", async () => {
      const tracker = makeStatusTracker(true);
      await startScheduler(tmpDir, undefined, tracker);
      vi.clearAllMocks();

      await cronCallbacks[0]();

      expect(mockRun).not.toHaveBeenCalled();
    });

    it("cron callback does not queue work when paused", async () => {
      const tracker = makeStatusTracker(true);
      mockIsRunning = true;
      await startScheduler(tmpDir, undefined, tracker);
      vi.clearAllMocks();

      await cronCallbacks[0]();

      // No run, no "queued" log — work is rejected
      expect(mockRun).not.toHaveBeenCalled();
      expect(mockLoggerInfo).not.toHaveBeenCalledWith(
        expect.objectContaining({ agent: "dev" }),
        "all runners busy, scheduled run queued"
      );
    });

    it("cron callback runs agent when not paused", async () => {
      const tracker = makeStatusTracker(false);
      await startScheduler(tmpDir, undefined, tracker);
      vi.clearAllMocks();

      await cronCallbacks[0]();

      expect(mockRun).toHaveBeenCalledTimes(1);
    });
  });

  describe("per-agent timeout", () => {
    function setupTimeoutProject(tmpDir: string) {
      const globalConfig = {};
      writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML(globalConfig as Record<string, unknown>));

      const model = { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" };
      const agents = [
        { name: "fast-agent", credentials: ["github_token"], model, schedule: "*/5 * * * *", timeout: 300 },
        { name: "slow-agent", credentials: ["github_token"], model, schedule: "*/5 * * * *", timeout: 1800 },
        { name: "default-agent", credentials: ["github_token"], model, schedule: "*/5 * * * *" },
      ];

      for (const agent of agents) {
        const agentDir = resolve(tmpDir, "agents", agent.name);
        mkdirSync(agentDir, { recursive: true });
        writeSkillMd(agentDir, agent);
        mkdirSync(resolve(tmpDir, ".al", "state", agent.name), { recursive: true });
      }
    }

    beforeEach(() => {
      vi.clearAllMocks();
      cronCallbacks.length = 0;
      mockIsRunning = false;
      tmpDir = mkdtempSync(join(tmpdir(), "al-sched-timeout-"));
      setupTimeoutProject(tmpDir);
    });

    it("loads agents with per-agent timeout", async () => {
      const { runnerPools } = await startScheduler(tmpDir);
      expect(Object.keys(runnerPools).sort()).toEqual(["default-agent", "fast-agent", "slow-agent"]);
    });

    it("per-agent timeout is present in loaded agent config", async () => {
      const { loadAgentConfig } = await import("../../src/shared/config.js");
      const fast = loadAgentConfig(tmpDir, "fast-agent");
      const slow = loadAgentConfig(tmpDir, "slow-agent");
      const dflt = loadAgentConfig(tmpDir, "default-agent");

      expect(fast.timeout).toBe(300);
      expect(slow.timeout).toBe(1800);
      expect(dflt.timeout).toBeUndefined();
    });
  });
});
