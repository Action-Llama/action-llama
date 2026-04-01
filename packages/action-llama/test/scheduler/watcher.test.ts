import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { agentNameFromPath } from "../../src/scheduler/watcher.js";

// Mock fs.watch and dependencies before importing watchAgents
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    watch: vi.fn(),
  };
});

vi.mock("../../src/shared/config.js", () => ({
  discoverAgents: vi.fn(() => []),
  loadAgentConfig: vi.fn(),
  validateAgentConfig: vi.fn(),
}));

vi.mock("../../src/execution/image-builder.js", () => ({
  buildSingleAgentImage: vi.fn(async () => "test-image:latest"),
}));

vi.mock("../../src/events/webhook-setup.js", () => ({
  resolveWebhookSource: vi.fn(() => ({ type: "github", credential: "default" })),
  buildFilterFromTrigger: vi.fn(() => undefined),
  registerWebhookBindings: vi.fn(),
}));

vi.mock("croner", () => {
  class MockCron {
    _callback: (() => Promise<void>) | undefined;
    stop = vi.fn();
    pause = vi.fn();
    resume = vi.fn();
    constructor(_schedule: string, _opts: any, callback?: () => Promise<void>) {
      this._callback = callback;
    }
    nextRun() { return new Date(); }
    async fire() { return this._callback?.(); }
  }
  return { Cron: MockCron };
});

vi.mock("../../src/execution/execution.js", () => ({
  runWithReruns: vi.fn(async () => {}),
  makeWebhookPrompt: vi.fn(() => "test prompt"),
  executeRun: vi.fn(async () => ({ result: "completed", triggers: [] })),
  drainQueues: vi.fn(async () => {}),
}));

const { mockHostUserRuntime, mockCreateAgentRuntimeOverride } = vi.hoisted(() => {
  const inst = { type: "mock-host-user-runtime" } as any;
  const fn = vi.fn((_config: any) => inst);
  return { mockHostUserRuntime: inst, mockCreateAgentRuntimeOverride: fn };
});

vi.mock("../../src/execution/runtime-factory.js", () => ({
  createAgentRuntimeOverride: mockCreateAgentRuntimeOverride,
}));

import { watch } from "fs";
import { discoverAgents, loadAgentConfig, validateAgentConfig } from "../../src/shared/config.js";
import { buildSingleAgentImage } from "../../src/execution/image-builder.js";
import { registerWebhookBindings } from "../../src/events/webhook-setup.js";
import { executeRun, makeWebhookPrompt } from "../../src/execution/execution.js";
import { watchAgents, type HotReloadContext } from "../../src/scheduler/watcher.js";
import { RunnerPool } from "../../src/execution/runner-pool.js";

const mockedWatch = vi.mocked(watch);
const mockedDiscoverAgents = vi.mocked(discoverAgents);
const mockedLoadAgentConfig = vi.mocked(loadAgentConfig);
const mockedValidateAgentConfig = vi.mocked(validateAgentConfig);
const mockedBuildSingleAgentImage = vi.mocked(buildSingleAgentImage);
const mockedRegisterWebhookBindings = vi.mocked(registerWebhookBindings);
const mockedExecuteRun = vi.mocked(executeRun);

function makeAgentConfig(name: string, overrides: Record<string, any> = {}) {
  return {
    name,
    schedule: "0 * * * *",
    models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
    credentials: [],
    webhooks: [],
    scale: 1,
    ...overrides,
  } as any;
}

function makeMockRunner(instanceId: string) {
  return {
    isRunning: false,
    instanceId,
    run: vi.fn(async () => ({ result: "completed", triggers: [] })),
    abort: vi.fn(),
    setImage: vi.fn(),
    setAgentConfig: vi.fn(),
  };
}

function makeContext(overrides: Partial<HotReloadContext> = {}): HotReloadContext {
  const agentConfigs = overrides.agentConfigs ?? [makeAgentConfig("agent-a")];
  return {
    projectPath: "/test/project",
    globalConfig: { local: {} } as any,
    runtime: { buildImage: vi.fn(async () => "img:latest"), pushImage: vi.fn(async (img: string) => img) } as any,
    agentRuntimeOverrides: {},
    runnerPools: overrides.runnerPools ?? {
      "agent-a": new RunnerPool([makeMockRunner("agent-a")]),
    },
    agentConfigs,
    agentImages: { "agent-a": "agent-a:latest" },
    cronJobs: [],
    schedulerCtx: {
      runnerPools: overrides.runnerPools ?? {},
      agentConfigs,
      maxReruns: 3,
      maxTriggerDepth: 5,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      workQueue: { enqueue: vi.fn(() => ({ dropped: false })), size: vi.fn(() => 0), clearAll: vi.fn(), setAgentMaxSize: vi.fn() } as any,
      shuttingDown: false,
      skills: { locking: true },
      useBakedImages: true,
    },
    webhookRegistry: {
      addBinding: vi.fn(),
      removeBindingsForAgent: vi.fn(),
    } as any,
    webhookSources: {},
    statusTracker: {
      registerAgent: vi.fn(),
      unregisterAgent: vi.fn(),
      updateAgentScale: vi.fn(),
      setAgentState: vi.fn(),
      setAgentStatusText: vi.fn(),
      setAgentDescription: vi.fn(),
      setAgentTriggers: vi.fn(),
      setAgentError: vi.fn(),
      setNextRunAt: vi.fn(),
      addLogLine: vi.fn(),
      isAgentEnabled: vi.fn(() => true),
      getAllAgents: vi.fn(() => []),
    } as any,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    skills: { locking: true },
    timezone: "UTC",
    baseImage: "al-agent:latest",
    createRunner: vi.fn((_config, _image) => makeMockRunner(_config.name)),
    ...overrides,
  };
}

describe("agentNameFromPath", () => {
  it("extracts agent name from simple path", () => {
    expect(agentNameFromPath("my-agent/SKILL.md")).toBe("my-agent");
  });

  it("extracts agent name from nested path", () => {
    expect(agentNameFromPath("my-agent/src/main.ts")).toBe("my-agent");
  });

  it("extracts agent name from agent dir only", () => {
    expect(agentNameFromPath("my-agent")).toBe("my-agent");
  });

  it("returns null for empty string", () => {
    expect(agentNameFromPath("")).toBeNull();
  });

  it("returns null for dotfiles", () => {
    expect(agentNameFromPath(".hidden/file")).toBeNull();
  });

  it("handles Windows-style separators", () => {
    expect(agentNameFromPath("my-agent\\SKILL.md")).toBe("my-agent");
  });
});

describe("watchAgents", () => {
  let watchCallback: (event: string, filename: string | null) => void;
  let mockWatcher: { close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockWatcher = { close: vi.fn() };
    mockedWatch.mockImplementation((_path: any, _opts: any, cb: any) => {
      watchCallback = cb;
      return mockWatcher as any;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns handle with stop function that closes watcher", () => {
    const ctx = makeContext();
    const handle = watchAgents(ctx);
    handle.stop();
    expect(mockWatcher.close).toHaveBeenCalled();
  });

  it("debounces multiple events for the same agent", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const ctx = makeContext();
      mockedDiscoverAgents.mockReturnValue(["agent-a"]);
      mockedLoadAgentConfig.mockReturnValue(makeAgentConfig("agent-a"));

      watchAgents(ctx);

      // Fire three rapid events
      watchCallback("change", "agent-a/SKILL.md");
      watchCallback("change", "agent-a/SKILL.md");
      watchCallback("change", "agent-a/Dockerfile");

      // Only one timer should be pending (last one replaced the others)
      expect(vi.getTimerCount()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores null filename from watcher", () => {
    const ctx = makeContext();
    watchAgents(ctx);
    // Should not throw
    watchCallback("change", null as any);
    expect(mockedDiscoverAgents).not.toHaveBeenCalled();
  });

  it("ignores file change when agentName cannot be determined from path", () => {
    const ctx = makeContext();
    watchAgents(ctx);
    // A dotfile/top-level file that doesn't match any agent path — agentNameFromPath returns null
    watchCallback("change", ".gitignore");
    expect(mockedDiscoverAgents).not.toHaveBeenCalled();
  });

  it("returns noop handle when watch throws", () => {
    mockedWatch.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const ctx = makeContext();
    const handle = watchAgents(ctx);
    handle.stop(); // Should not throw
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  it("stop() clears pending debounce timers", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const ctx = makeContext();
      const handle = watchAgents(ctx);

      // Fire a filesystem event to create a debounce timer
      watchCallback("change", "agent-a/SKILL.md");
      expect(vi.getTimerCount()).toBe(1);

      // Stopping should clear the pending timer
      handle.stop();
      expect(vi.getTimerCount()).toBe(0);
      expect(mockWatcher.close).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("watchAgents handler (via _handleAgentChange)", () => {
  let mockWatcher: { close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.resetAllMocks();
    mockWatcher = { close: vi.fn() };
    mockedWatch.mockImplementation((_path: any, _opts: any, _cb: any) => {
      return mockWatcher as any;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handles changed agent: updates image and config on runners", async () => {
    const runner = makeMockRunner("agent-a");
    const pool = new RunnerPool([runner]);
    const ctx = makeContext({ runnerPools: { "agent-a": pool } });

    const updatedConfig = makeAgentConfig("agent-a", { schedule: "*/5 * * * *" });
    mockedDiscoverAgents.mockReturnValue(["agent-a"]);
    mockedLoadAgentConfig.mockReturnValue(updatedConfig);
    mockedBuildSingleAgentImage.mockResolvedValue("agent-a:v2");

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    expect(runner.setImage).toHaveBeenCalledWith("agent-a:v2");
    expect(runner.setAgentConfig).toHaveBeenCalledWith(updatedConfig);
    expect(ctx.statusTracker!.setAgentState).toHaveBeenCalledWith("agent-a", "building");
    expect(ctx.statusTracker!.setAgentState).toHaveBeenCalledWith("agent-a", "idle");
    expect(ctx.statusTracker!.addLogLine).toHaveBeenCalledWith("agent-a", "hot-reloaded");
  });

  it("handles changed agent: updates agentRuntimeOverrides and runner runtime when runtime config changes", async () => {
    const runner = {
      ...makeMockRunner("agent-a"),
      setRuntime: vi.fn(),
    };
    const pool = new RunnerPool([runner]);
    // Start with a host-user agent that has no docker group
    const oldConfig = makeAgentConfig("agent-a", {
      runtime: { type: "host-user", run_as: "al-agent", groups: [] },
    });
    const ctx = makeContext({
      agentConfigs: [oldConfig],
      runnerPools: { "agent-a": pool },
      agentRuntimeOverrides: { "agent-a": { type: "old-host-user-runtime" } as any },
    });

    // New config adds docker group
    const updatedConfig = makeAgentConfig("agent-a", {
      runtime: { type: "host-user", run_as: "al-agent", groups: ["docker"] },
    });
    mockedDiscoverAgents.mockReturnValue(["agent-a"]);
    mockedLoadAgentConfig.mockReturnValue(updatedConfig);

    // Make createAgentRuntimeOverride return the mock runtime for the new config
    mockCreateAgentRuntimeOverride.mockReturnValue(mockHostUserRuntime);

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    // createAgentRuntimeOverride should have been called with the new config
    expect(mockCreateAgentRuntimeOverride).toHaveBeenCalledWith(updatedConfig);
    // agentRuntimeOverrides should be updated with the new runtime
    expect(ctx.agentRuntimeOverrides["agent-a"]).toBe(mockHostUserRuntime);
    // Existing runner should have its runtime updated via setRuntime
    expect(runner.setRuntime).toHaveBeenCalledWith(mockHostUserRuntime);
  });

  it("handles new agent: creates runners and pool", async () => {
    const ctx = makeContext({ agentConfigs: [], runnerPools: {} });

    const newConfig = makeAgentConfig("agent-b");
    mockedDiscoverAgents.mockReturnValue(["agent-b"]);
    mockedLoadAgentConfig.mockReturnValue(newConfig);
    mockedBuildSingleAgentImage.mockResolvedValue("agent-b:v1");

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-b");

    expect(ctx.createRunner).toHaveBeenCalledWith(newConfig, "agent-b:v1");
    expect(ctx.runnerPools["agent-b"]).toBeInstanceOf(RunnerPool);
    expect(ctx.agentConfigs).toContain(newConfig);
    expect(ctx.statusTracker!.registerAgent).toHaveBeenCalledWith("agent-b", 1, undefined);
    expect(ctx.statusTracker!.addLogLine).toHaveBeenCalledWith("agent-b", "hot-reloaded (new)");
  });

  it("configures per-agent work queue size when new agent has maxWorkQueueSize set", async () => {
    const ctx = makeContext({ agentConfigs: [], runnerPools: {} });

    const newConfig = makeAgentConfig("agent-b", { maxWorkQueueSize: 50 });
    mockedDiscoverAgents.mockReturnValue(["agent-b"]);
    mockedLoadAgentConfig.mockReturnValue(newConfig);
    mockedBuildSingleAgentImage.mockResolvedValue("agent-b:v1");

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-b");

    expect(ctx.schedulerCtx.workQueue.setAgentMaxSize).toHaveBeenCalledWith("agent-b", 50);
  });

  it("handles removed agent: tears down pool, cron, webhooks", async () => {
    const runner = makeMockRunner("agent-a");
    runner.isRunning = true;
    const pool = new RunnerPool([runner]);
    const ctx = makeContext({ runnerPools: { "agent-a": pool } });

    mockedDiscoverAgents.mockReturnValue([]);

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    expect(runner.abort).toHaveBeenCalled();
    expect(ctx.runnerPools["agent-a"]).toBeUndefined();
    expect(ctx.webhookRegistry!.removeBindingsForAgent).toHaveBeenCalledWith("agent-a");
    expect(ctx.statusTracker!.unregisterAgent).toHaveBeenCalledWith("agent-a");
    expect(ctx.agentConfigs.find(a => a.name === "agent-a")).toBeUndefined();
  });

  it("handles invalid config on reload: sets error, does not crash", async () => {
    const ctx = makeContext();
    mockedDiscoverAgents.mockReturnValue(["agent-a"]);
    mockedLoadAgentConfig.mockReturnValue(makeAgentConfig("agent-a"));
    mockedValidateAgentConfig.mockImplementation(() => {
      throw new Error("schedule required");
    });

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    expect(ctx.statusTracker!.setAgentError).toHaveBeenCalledWith(
      "agent-a",
      expect.stringContaining("Invalid config"),
    );
    expect(mockedBuildSingleAgentImage).not.toHaveBeenCalled();
  });

  it("handles build failure on reload: sets error, does not crash", async () => {
    const ctx = makeContext();
    mockedDiscoverAgents.mockReturnValue(["agent-a"]);
    mockedLoadAgentConfig.mockReturnValue(makeAgentConfig("agent-a"));
    mockedBuildSingleAgentImage.mockRejectedValue(new Error("Docker build failed"));

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    expect(ctx.statusTracker!.setAgentError).toHaveBeenCalledWith(
      "agent-a",
      expect.stringContaining("Hot reload error"),
    );
  });

  it("handles scale change: adds runners when scale increases", async () => {
    const runner = makeMockRunner("agent-a");
    const pool = new RunnerPool([runner]);
    const ctx = makeContext({ runnerPools: { "agent-a": pool } });

    const scaledConfig = makeAgentConfig("agent-a", { scale: 3 });
    mockedDiscoverAgents.mockReturnValue(["agent-a"]);
    mockedLoadAgentConfig.mockReturnValue(scaledConfig);

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    // Original scale was 1, new scale is 3, so 2 new runners created
    expect(ctx.createRunner).toHaveBeenCalledTimes(2);
    expect(pool.size).toBe(3);
  });

  it("handles scale change: removes idle runners when scale decreases", async () => {
    const runner1 = makeMockRunner("agent-a-00000001");
    const runner2 = makeMockRunner("agent-a-00000002");
    const runner3 = makeMockRunner("agent-a-00000003");
    const pool = new RunnerPool([runner1, runner2, runner3]);
    const ctx = makeContext({
      agentConfigs: [makeAgentConfig("agent-a", { scale: 3 })],
      runnerPools: { "agent-a": pool },
    });

    const shrunkConfig = makeAgentConfig("agent-a", { scale: 1 });
    mockedDiscoverAgents.mockReturnValue(["agent-a"]);
    mockedLoadAgentConfig.mockReturnValue(shrunkConfig);

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    expect(pool.size).toBe(1);
  });

  it("handles schedule change: old cron stopped, new cron created", async () => {
    const ctx = makeContext();
    const rescheduledConfig = makeAgentConfig("agent-a", { schedule: "*/10 * * * *" });
    mockedDiscoverAgents.mockReturnValue(["agent-a"]);
    mockedLoadAgentConfig.mockReturnValue(rescheduledConfig);

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    // New cron job should have been created (schedule changed from "0 * * * *" to "*/10 * * * *")
    expect(ctx.cronJobs.length).toBeGreaterThan(0);
    expect(ctx.statusTracker!.setNextRunAt).toHaveBeenCalled();
  });

  it("updates per-agent work queue size when existing agent config changes to add maxWorkQueueSize", async () => {
    const ctx = makeContext();
    const updatedConfig = makeAgentConfig("agent-a", { maxWorkQueueSize: 25 });
    mockedDiscoverAgents.mockReturnValue(["agent-a"]);
    mockedLoadAgentConfig.mockReturnValue(updatedConfig);

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    expect(ctx.schedulerCtx.workQueue.setAgentMaxSize).toHaveBeenCalledWith("agent-a", 25);
  });

  it("hot reload scale change uses updateAgentScale (not registerAgent) to preserve running state", async () => {
    const runner = makeMockRunner("agent-a");
    const pool = new RunnerPool([runner]);
    const ctx = makeContext({ runnerPools: { "agent-a": pool } });

    // Scale increases from 1 to 2
    const scaledConfig = makeAgentConfig("agent-a", { scale: 2 });
    mockedDiscoverAgents.mockReturnValue(["agent-a"]);
    mockedLoadAgentConfig.mockReturnValue(scaledConfig);

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    // updateAgentScale should be called — NOT registerAgent — to preserve runningCount
    expect(ctx.statusTracker!.updateAgentScale).toHaveBeenCalledWith("agent-a", 2);
    expect(ctx.statusTracker!.registerAgent).not.toHaveBeenCalled();
  });

  it("hot reload scale decrease uses updateAgentScale (not registerAgent)", async () => {
    const runner1 = makeMockRunner("agent-a-00000001");
    const runner2 = makeMockRunner("agent-a-00000002");
    const runner3 = makeMockRunner("agent-a-00000003");
    const pool = new RunnerPool([runner1, runner2, runner3]);
    const ctx = makeContext({
      agentConfigs: [makeAgentConfig("agent-a", { scale: 3 })],
      runnerPools: { "agent-a": pool },
    });

    const shrunkConfig = makeAgentConfig("agent-a", { scale: 1 });
    mockedDiscoverAgents.mockReturnValue(["agent-a"]);
    mockedLoadAgentConfig.mockReturnValue(shrunkConfig);

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    expect(ctx.statusTracker!.updateAgentScale).toHaveBeenCalledWith("agent-a", 1);
    expect(ctx.statusTracker!.registerAgent).not.toHaveBeenCalled();
  });

  it("hot reload preserves running state when runners are active after rebuild", async () => {
    const runner = makeMockRunner("agent-a");
    const pool = new RunnerPool([runner]);

    // Simulate a running agent: getAllAgents reports runningCount = 1
    const statusTracker = {
      registerAgent: vi.fn(),
      unregisterAgent: vi.fn(),
      updateAgentScale: vi.fn(),
      setAgentState: vi.fn(),
      setAgentStatusText: vi.fn(),
      setAgentDescription: vi.fn(),
      setAgentTriggers: vi.fn(),
      setAgentError: vi.fn(),
      setNextRunAt: vi.fn(),
      addLogLine: vi.fn(),
      isAgentEnabled: vi.fn(() => true),
      getAllAgents: vi.fn(() => [{ name: "agent-a", runningCount: 1, state: "running" }]),
    };

    const ctx = makeContext({ runnerPools: { "agent-a": pool }, statusTracker: statusTracker as any });

    mockedDiscoverAgents.mockReturnValue(["agent-a"]);
    mockedLoadAgentConfig.mockReturnValue(makeAgentConfig("agent-a"));

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    // setAgentState("idle") should NOT have been called — a runner is still active
    const idleCalls = statusTracker.setAgentState.mock.calls.filter(
      ([_name, state]: [string, string]) => state === "idle"
    );
    expect(idleCalls).toHaveLength(0);

    // But building state should have been set
    expect(statusTracker.setAgentState).toHaveBeenCalledWith("agent-a", "building");
  });

  it("handles new agent with invalid config: logs error and registers with scale 0", async () => {
    const ctx = makeContext({ agentConfigs: [], runnerPools: {} });
    mockedDiscoverAgents.mockReturnValue(["agent-b"]);
    mockedLoadAgentConfig.mockImplementation(() => {
      throw new Error("missing required field: models");
    });

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-b");

    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "agent-b" }),
      "hot reload: invalid agent config"
    );
    expect(ctx.statusTracker!.registerAgent).toHaveBeenCalledWith("agent-b", 0);
    expect(ctx.statusTracker!.setAgentError).toHaveBeenCalledWith(
      "agent-b",
      expect.stringContaining("Invalid config")
    );
    expect(mockedBuildSingleAgentImage).not.toHaveBeenCalled();
  });

  it("handles new agent with scale=0: registers as disabled without creating runners", async () => {
    const ctx = makeContext({ agentConfigs: [], runnerPools: {} });
    const disabledConfig = makeAgentConfig("agent-b", { scale: 0 });
    mockedDiscoverAgents.mockReturnValue(["agent-b"]);
    mockedLoadAgentConfig.mockReturnValue(disabledConfig);

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-b");

    expect(ctx.agentConfigs).toContain(disabledConfig);
    expect(ctx.runnerPools["agent-b"]).toBeUndefined();
    expect(ctx.createRunner).not.toHaveBeenCalled();
    expect(mockedBuildSingleAgentImage).not.toHaveBeenCalled();
    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "agent-b" }),
      "hot reload: agent registered (scale=0, disabled)"
    );
  });

  it("handles changed agent: removes schedule when new config has no schedule", async () => {
    const runner = makeMockRunner("agent-a");
    const pool = new RunnerPool([runner]);
    // Original config has a schedule
    const ctx = makeContext({
      agentConfigs: [makeAgentConfig("agent-a", { schedule: "0 * * * *" })],
      runnerPools: { "agent-a": pool },
    });

    // New config has no schedule
    const updatedConfig = makeAgentConfig("agent-a", { schedule: undefined });
    mockedDiscoverAgents.mockReturnValue(["agent-a"]);
    mockedLoadAgentConfig.mockReturnValue(updatedConfig);

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    // Should clear the nextRunAt since schedule is removed
    expect(ctx.statusTracker!.setNextRunAt).toHaveBeenCalledWith("agent-a", null);
  });

  it("pendingRebuild: queues a second change while first is running", async () => {
    let resolveFirst: () => void;
    const firstBuildStarted = new Promise<void>((resolve) => {
      mockedBuildSingleAgentImage.mockImplementationOnce(async () => {
        resolveFirst?.();
        // Hang indefinitely until test resolves
        return new Promise<string>((r) => setTimeout(() => r("agent-a:v1"), 50));
      });
    });

    // Second build should be quick
    mockedBuildSingleAgentImage.mockResolvedValue("agent-a:v2");

    const ctx = makeContext();
    mockedDiscoverAgents.mockReturnValue(["agent-a"]);
    mockedLoadAgentConfig.mockReturnValue(makeAgentConfig("agent-a"));

    const handle = watchAgents(ctx);

    // Start first change (will hang in buildSingleAgentImage)
    const firstChange = handle._handleAgentChange("agent-a");

    // Wait for build to start, then immediately trigger second change
    // (it should be added to pendingRebuild since first is still running)
    const secondChange = handle._handleAgentChange("agent-a");

    // Both should complete
    await Promise.all([firstChange, secondChange]);

    // buildSingleAgentImage was called at least twice (once for each reload)
    expect(mockedBuildSingleAgentImage).toHaveBeenCalledTimes(2);
  });

  describe("buildWebhookTrigger", () => {
    beforeEach(() => {
      mockedRegisterWebhookBindings.mockClear();
      mockedExecuteRun.mockClear();
    });

    function makeTriggerTest() {
      let capturedOnTrigger: ((config: any, context: any) => boolean) | undefined;
      mockedRegisterWebhookBindings.mockImplementationOnce(({ onTrigger }: any) => {
        capturedOnTrigger = onTrigger;
      });
      return {
        getCaptured: () => capturedOnTrigger,
      };
    }

    it("returns true and queues executeRun when runner is available", async () => {
      const { getCaptured } = makeTriggerTest();

      const runner = makeMockRunner("agent-b");
      const pool = new RunnerPool([runner]);
      const ctx = makeContext({ agentConfigs: [], runnerPools: {} });

      const newConfig = makeAgentConfig("agent-b");
      mockedDiscoverAgents.mockReturnValue(["agent-b"]);
      mockedLoadAgentConfig.mockReturnValue(newConfig);
      mockedBuildSingleAgentImage.mockResolvedValue("agent-b:v1");

      // Override createRunner to use our pool
      ctx.createRunner = vi.fn(() => runner);

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("agent-b");

      const onTrigger = getCaptured();
      expect(onTrigger).toBeDefined();

      // Add runner to pool via runnerPools
      const agentPool = ctx.runnerPools["agent-b"];
      expect(agentPool).toBeInstanceOf(RunnerPool);

      const statusTrackerWithPaused = {
        ...ctx.statusTracker,
        isPaused: vi.fn(() => false),
        isAgentEnabled: vi.fn(() => true),
      };
      const ctxWithPaused = { ...ctx, statusTracker: statusTrackerWithPaused as any };

      // Rebuild the trigger with the pool that has an idle runner
      let capturedOnTrigger2: ((config: any, context: any) => boolean) | undefined;
      mockedRegisterWebhookBindings.mockImplementationOnce(({ onTrigger: ot }: any) => {
        capturedOnTrigger2 = ot;
      });

      // Re-setup with a context that has statusTracker.isPaused
      const ctx2 = makeContext({
        agentConfigs: [],
        runnerPools: {},
      });
      (ctx2.statusTracker as any).isPaused = vi.fn(() => false);

      mockedDiscoverAgents.mockReturnValue(["agent-b"]);
      mockedLoadAgentConfig.mockReturnValue(newConfig);
      mockedBuildSingleAgentImage.mockResolvedValue("agent-b:v1");

      const handle2 = watchAgents(ctx2);
      await handle2._handleAgentChange("agent-b");

      const onTrigger2 = capturedOnTrigger2;
      if (!onTrigger2) return; // skip if not captured

      const webhookContext = { event: "push", action: "opened", receiptId: "r1" };
      const result = onTrigger2(newConfig, webhookContext);
      expect(result).toBe(true);
    });

    it("returns false when agent is disabled", async () => {
      const { getCaptured } = makeTriggerTest();

      const ctx = makeContext({ agentConfigs: [], runnerPools: {} });
      (ctx.statusTracker as any).isPaused = vi.fn(() => false);
      (ctx.statusTracker as any).isAgentEnabled = vi.fn(() => false);

      const newConfig = makeAgentConfig("agent-b");
      mockedDiscoverAgents.mockReturnValue(["agent-b"]);
      mockedLoadAgentConfig.mockReturnValue(newConfig);
      mockedBuildSingleAgentImage.mockResolvedValue("agent-b:v1");

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("agent-b");

      const onTrigger = getCaptured();
      expect(onTrigger).toBeDefined();
      const result = onTrigger!(newConfig, { event: "push", action: "opened" });
      expect(result).toBe(false);
    });

    it("returns false when scheduler is paused", async () => {
      const { getCaptured } = makeTriggerTest();

      const ctx = makeContext({ agentConfigs: [], runnerPools: {} });
      (ctx.statusTracker as any).isPaused = vi.fn(() => true);
      (ctx.statusTracker as any).isAgentEnabled = vi.fn(() => true);

      const newConfig = makeAgentConfig("agent-b");
      mockedDiscoverAgents.mockReturnValue(["agent-b"]);
      mockedLoadAgentConfig.mockReturnValue(newConfig);
      mockedBuildSingleAgentImage.mockResolvedValue("agent-b:v1");

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("agent-b");

      const onTrigger = getCaptured();
      expect(onTrigger).toBeDefined();
      const result = onTrigger!(newConfig, { event: "push", action: "opened" });
      expect(result).toBe(false);
      expect(ctx.logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ agent: "agent-b" }),
        "scheduler paused, webhook rejected"
      );
    });

    it("queues webhook when no runner is available and returns true", async () => {
      const { getCaptured } = makeTriggerTest();

      const ctx = makeContext({ agentConfigs: [], runnerPools: {} });
      (ctx.statusTracker as any).isPaused = vi.fn(() => false);
      (ctx.statusTracker as any).isAgentEnabled = vi.fn(() => true);

      const newConfig = makeAgentConfig("agent-b");
      mockedDiscoverAgents.mockReturnValue(["agent-b"]);
      mockedLoadAgentConfig.mockReturnValue(newConfig);
      mockedBuildSingleAgentImage.mockResolvedValue("agent-b:v1");

      // Create runner already running so getAvailableRunner returns null
      const busyRunner = makeMockRunner("agent-b");
      busyRunner.isRunning = true;
      ctx.createRunner = vi.fn(() => busyRunner);

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("agent-b");

      const onTrigger = getCaptured();
      expect(onTrigger).toBeDefined();

      const webhookContext = { event: "pull_request", action: "opened" };
      const result = onTrigger!(newConfig, webhookContext);
      expect(result).toBe(true);
      expect(ctx.schedulerCtx.workQueue.enqueue).toHaveBeenCalledWith(
        "agent-b",
        expect.objectContaining({ type: "webhook" })
      );
    });

    it("warns when queue is full (dropped=true) on webhook enqueue", async () => {
      const { getCaptured } = makeTriggerTest();

      const ctx = makeContext({ agentConfigs: [], runnerPools: {} });
      (ctx.statusTracker as any).isPaused = vi.fn(() => false);
      (ctx.statusTracker as any).isAgentEnabled = vi.fn(() => true);
      // Make enqueue return dropped=true
      (ctx.schedulerCtx.workQueue.enqueue as any).mockReturnValue({ dropped: true });

      const newConfig = makeAgentConfig("agent-b");
      mockedDiscoverAgents.mockReturnValue(["agent-b"]);
      mockedLoadAgentConfig.mockReturnValue(newConfig);
      mockedBuildSingleAgentImage.mockResolvedValue("agent-b:v1");

      const busyRunner = makeMockRunner("agent-b");
      busyRunner.isRunning = true;
      ctx.createRunner = vi.fn(() => busyRunner);

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("agent-b");

      const onTrigger = getCaptured();
      expect(onTrigger).toBeDefined();

      onTrigger!(newConfig, { event: "push", action: "opened" });
      expect(ctx.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ agent: "agent-b" }),
        "queue full, oldest event dropped"
      );
    });

    it("logs error when executeRun rejects", async () => {
      const { getCaptured } = makeTriggerTest();
      const { executeRun: mockedExecuteRunImport, drainQueues: mockedDrainQueues } = await import("../../src/execution/execution.js");
      (mockedExecuteRunImport as any).mockRejectedValueOnce(new Error("run failed"));

      const ctx = makeContext({ agentConfigs: [], runnerPools: {} });
      (ctx.statusTracker as any).isPaused = vi.fn(() => false);
      (ctx.statusTracker as any).isAgentEnabled = vi.fn(() => true);

      const newConfig = makeAgentConfig("agent-b");
      mockedDiscoverAgents.mockReturnValue(["agent-b"]);
      mockedLoadAgentConfig.mockReturnValue(newConfig);
      mockedBuildSingleAgentImage.mockResolvedValue("agent-b:v1");

      const idleRunner = makeMockRunner("agent-b");
      ctx.createRunner = vi.fn(() => idleRunner);

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("agent-b");

      const onTrigger = getCaptured();
      expect(onTrigger).toBeDefined();

      onTrigger!(newConfig, { event: "push", action: "opened", receiptId: "r1" });
      // Wait for the promise chain to resolve
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(ctx.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ agent: "agent-b" }),
        "webhook run failed"
      );
    });
  });



  it("_waitForPending resolves after inflight handlers complete", async () => {
    const ctx = makeContext();
    const handle = watchAgents(ctx);
    // Should resolve immediately with no pending handlers
    await expect(handle._waitForPending()).resolves.toBeUndefined();
  });

  it("handles agent removal with remaining agents: rebuilds cron jobs", async () => {
    const runnerA = makeMockRunner("agent-a");
    const runnerB = makeMockRunner("agent-b");
    const poolA = new RunnerPool([runnerA]);
    const poolB = new RunnerPool([runnerB]);

    const configA = makeAgentConfig("agent-a", { schedule: "0 * * * *" });
    const configB = makeAgentConfig("agent-b", { schedule: "*/30 * * * *" });

    const ctx = makeContext({
      agentConfigs: [configA, configB],
      runnerPools: { "agent-a": poolA, "agent-b": poolB },
    });

    // Remove agent-a, keep agent-b
    mockedDiscoverAgents.mockReturnValue(["agent-b"]);

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    // agent-a should be gone, cron jobs rebuilt for agent-b
    expect(ctx.agentConfigs.find(a => a.name === "agent-a")).toBeUndefined();
    expect(ctx.cronJobs.length).toBeGreaterThan(0);
  });

  it("handles changed agent: re-registers webhook bindings when webhooks change", async () => {
    const oldConfig = makeAgentConfig("agent-a", { webhooks: [{ source: "github", trigger: { event: "push" } }] });
    const newConfig = makeAgentConfig("agent-a", { webhooks: [{ source: "github", trigger: { event: "pull_request" } }] });

    const ctx = makeContext({ agentConfigs: [oldConfig] });
    mockedDiscoverAgents.mockReturnValue(["agent-a"]);
    mockedLoadAgentConfig.mockReturnValue(newConfig);

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    expect(ctx.webhookRegistry!.removeBindingsForAgent).toHaveBeenCalledWith("agent-a");
    expect(mockedRegisterWebhookBindings).toHaveBeenCalled();
  });

  it("new agent cron callback queues work when all runners are busy", async () => {
    const ctx = makeContext({ agentConfigs: [], runnerPools: {} });

    const busyRunner = makeMockRunner("agent-b");
    busyRunner.isRunning = true;
    ctx.createRunner = vi.fn(() => busyRunner);

    const newConfig = makeAgentConfig("agent-b", { schedule: "0 * * * *" });
    mockedDiscoverAgents.mockReturnValue(["agent-b"]);
    mockedLoadAgentConfig.mockReturnValue(newConfig);
    mockedBuildSingleAgentImage.mockResolvedValue("agent-b:v1");

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-b");

    // Find the cron job for agent-b and fire it
    const cronJob = ctx.cronJobs.find((j: any) => j._callback) as any;
    expect(cronJob).toBeDefined();

    // Fire the callback — all runners are busy
    await cronJob.fire();

    expect(ctx.schedulerCtx.workQueue.enqueue).toHaveBeenCalledWith(
      "agent-b",
      expect.objectContaining({ type: "schedule" })
    );
    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "agent-b" }),
      "all runners busy, scheduled run queued"
    );
  });

  it("updated agent cron callback queues work when all runners are busy", async () => {
    const ctx = makeContext();

    const updatedConfig = makeAgentConfig("agent-a", { schedule: "*/15 * * * *" });
    mockedDiscoverAgents.mockReturnValue(["agent-a"]);
    mockedLoadAgentConfig.mockReturnValue(updatedConfig);

    // Mark the runner as busy
    const pool = ctx.runnerPools["agent-a"];
    const runner = pool.getAvailableRunner();
    if (runner) (runner as any).isRunning = true;

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    // Find newly added cron job for updated schedule and fire it
    const cronJob = ctx.cronJobs.find((j: any) => j._callback) as any;
    expect(cronJob).toBeDefined();

    await cronJob.fire();

    expect(ctx.schedulerCtx.workQueue.enqueue).toHaveBeenCalledWith(
      "agent-a",
      expect.objectContaining({ type: "schedule" })
    );
  });

  // ── handleNewAgent cron callback additional paths ──────────────────────────

  it("new agent cron callback returns early when agent is disabled (isAgentEnabled=false)", async () => {
    const ctx = makeContext({ agentConfigs: [], runnerPools: {} });

    // Make isAgentEnabled return false
    (ctx.statusTracker as any).isAgentEnabled = vi.fn(() => false);

    const idleRunner = makeMockRunner("agent-b");
    ctx.createRunner = vi.fn(() => idleRunner);

    const newConfig = makeAgentConfig("agent-b", { schedule: "0 * * * *" });
    mockedDiscoverAgents.mockReturnValue(["agent-b"]);
    mockedLoadAgentConfig.mockReturnValue(newConfig);
    mockedBuildSingleAgentImage.mockResolvedValue("agent-b:v1");

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-b");

    const cronJob = ctx.cronJobs.find((j: any) => j._callback) as any;
    expect(cronJob).toBeDefined();

    const { runWithReruns: mockedRunWithReruns } = await import("../../src/execution/execution.js");

    await cronJob.fire();

    // runWithReruns should NOT have been called — agent disabled causes early return
    expect(mockedRunWithReruns).not.toHaveBeenCalled();
    // workQueue should also NOT have been enqueued
    expect(ctx.schedulerCtx.workQueue.enqueue).not.toHaveBeenCalled();
  });

  it("new agent cron callback logs warn when work queue is full (dropped=true)", async () => {
    const ctx = makeContext({ agentConfigs: [], runnerPools: {} });

    // Queue returns dropped=true (queue full)
    (ctx.schedulerCtx.workQueue.enqueue as any).mockReturnValue({ dropped: true });

    const busyRunner = makeMockRunner("agent-b");
    busyRunner.isRunning = true;
    ctx.createRunner = vi.fn(() => busyRunner);

    const newConfig = makeAgentConfig("agent-b", { schedule: "0 * * * *" });
    mockedDiscoverAgents.mockReturnValue(["agent-b"]);
    mockedLoadAgentConfig.mockReturnValue(newConfig);
    mockedBuildSingleAgentImage.mockResolvedValue("agent-b:v1");

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-b");

    const cronJob = ctx.cronJobs.find((j: any) => j._callback) as any;
    expect(cronJob).toBeDefined();

    await cronJob.fire();

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "agent-b" }),
      "queue full, oldest event dropped"
    );
  });

  it("new agent cron callback calls runWithReruns when runner is available", async () => {
    const ctx = makeContext({ agentConfigs: [], runnerPools: {} });

    const idleRunner = makeMockRunner("agent-b");
    // isRunning is false by default — runner is available
    ctx.createRunner = vi.fn(() => idleRunner);

    const newConfig = makeAgentConfig("agent-b", { schedule: "0 * * * *" });
    mockedDiscoverAgents.mockReturnValue(["agent-b"]);
    mockedLoadAgentConfig.mockReturnValue(newConfig);
    mockedBuildSingleAgentImage.mockResolvedValue("agent-b:v1");

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-b");

    const cronJob = ctx.cronJobs.find((j: any) => j._callback) as any;
    expect(cronJob).toBeDefined();

    const { runWithReruns: mockedRunWithReruns } = await import("../../src/execution/execution.js");
    (mockedRunWithReruns as any).mockResolvedValueOnce(undefined);

    await cronJob.fire();

    expect(mockedRunWithReruns).toHaveBeenCalledWith(
      idleRunner,
      newConfig,
      0,
      ctx.schedulerCtx
    );
  });

  // ── handleUpdatedAgent cron callback additional paths ─────────────────────

  it("updated agent cron callback returns early when agent is disabled (isAgentEnabled=false)", async () => {
    const ctx = makeContext();
    (ctx.statusTracker as any).isAgentEnabled = vi.fn(() => false);

    const updatedConfig = makeAgentConfig("agent-a", { schedule: "*/15 * * * *" });
    mockedDiscoverAgents.mockReturnValue(["agent-a"]);
    mockedLoadAgentConfig.mockReturnValue(updatedConfig);

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    const cronJob = ctx.cronJobs.find((j: any) => j._callback) as any;
    expect(cronJob).toBeDefined();

    const { runWithReruns: mockedRunWithReruns } = await import("../../src/execution/execution.js");

    await cronJob.fire();

    expect(mockedRunWithReruns).not.toHaveBeenCalled();
    expect(ctx.schedulerCtx.workQueue.enqueue).not.toHaveBeenCalled();
  });

  it("updated agent cron callback logs warn when work queue is full (dropped=true)", async () => {
    const ctx = makeContext();
    (ctx.schedulerCtx.workQueue.enqueue as any).mockReturnValue({ dropped: true });

    const updatedConfig = makeAgentConfig("agent-a", { schedule: "*/15 * * * *" });
    mockedDiscoverAgents.mockReturnValue(["agent-a"]);
    mockedLoadAgentConfig.mockReturnValue(updatedConfig);

    // Mark the runner as busy
    const pool = ctx.runnerPools["agent-a"];
    const runner = pool.getAvailableRunner();
    if (runner) (runner as any).isRunning = true;

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    const cronJob = ctx.cronJobs.find((j: any) => j._callback) as any;
    expect(cronJob).toBeDefined();

    await cronJob.fire();

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "agent-a" }),
      "queue full, oldest event dropped"
    );
  });

  it("updated agent cron callback calls runWithReruns when runner is available", async () => {
    const ctx = makeContext();

    const updatedConfig = makeAgentConfig("agent-a", { schedule: "*/15 * * * *" });
    mockedDiscoverAgents.mockReturnValue(["agent-a"]);
    mockedLoadAgentConfig.mockReturnValue(updatedConfig);
    // runner is not busy (isRunning=false by default)

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    const cronJob = ctx.cronJobs.find((j: any) => j._callback) as any;
    expect(cronJob).toBeDefined();

    const { runWithReruns: mockedRunWithReruns } = await import("../../src/execution/execution.js");
    (mockedRunWithReruns as any).mockResolvedValueOnce(undefined);

    await cronJob.fire();

    expect(mockedRunWithReruns).toHaveBeenCalledWith(
      expect.anything(),
      updatedConfig,
      0,
      ctx.schedulerCtx
    );
  });

  // ── rebuildCronJobs cron callback paths (lines 452-466) ───────────────────

  it("rebuildCronJobs cron callback returns early when agent is disabled (isAgentEnabled=false)", async () => {
    const runnerA = makeMockRunner("agent-a");
    const runnerB = makeMockRunner("agent-b");
    const poolA = new RunnerPool([runnerA]);
    const poolB = new RunnerPool([runnerB]);

    const configA = makeAgentConfig("agent-a", { schedule: "0 * * * *" });
    const configB = makeAgentConfig("agent-b", { schedule: "*/30 * * * *" });

    const ctx = makeContext({
      agentConfigs: [configA, configB],
      runnerPools: { "agent-a": poolA, "agent-b": poolB },
    });
    (ctx.statusTracker as any).isAgentEnabled = vi.fn(() => false);

    // Remove agent-a — triggers rebuildCronJobs for remaining agents
    mockedDiscoverAgents.mockReturnValue(["agent-b"]);

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    const { runWithReruns: mockedRunWithReruns } = await import("../../src/execution/execution.js");

    // Fire the rebuilt cron job for agent-b
    const cronJob = ctx.cronJobs.find((j: any) => j._callback) as any;
    expect(cronJob).toBeDefined();

    await cronJob.fire();

    // Agent disabled → early return
    expect(mockedRunWithReruns).not.toHaveBeenCalled();
    expect(ctx.schedulerCtx.workQueue.enqueue).not.toHaveBeenCalled();
  });

  it("rebuildCronJobs cron callback queues work when runner is busy", async () => {
    const runnerA = makeMockRunner("agent-a");
    const runnerB = makeMockRunner("agent-b");
    const poolA = new RunnerPool([runnerA]);
    const poolB = new RunnerPool([runnerB]);

    const configA = makeAgentConfig("agent-a", { schedule: "0 * * * *" });
    const configB = makeAgentConfig("agent-b", { schedule: "*/30 * * * *" });

    const ctx = makeContext({
      agentConfigs: [configA, configB],
      runnerPools: { "agent-a": poolA, "agent-b": poolB },
    });

    // Remove agent-a → rebuildCronJobs creates new cron job for agent-b
    mockedDiscoverAgents.mockReturnValue(["agent-b"]);

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    // Mark agent-b runner as busy
    runnerB.isRunning = true;

    const cronJob = ctx.cronJobs.find((j: any) => j._callback) as any;
    expect(cronJob).toBeDefined();

    await cronJob.fire();

    expect(ctx.schedulerCtx.workQueue.enqueue).toHaveBeenCalledWith(
      "agent-b",
      expect.objectContaining({ type: "schedule" })
    );
    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "agent-b" }),
      "all runners busy, scheduled run queued"
    );
  });

  it("rebuildCronJobs cron callback logs warn when work queue is full (dropped=true)", async () => {
    const runnerA = makeMockRunner("agent-a");
    const runnerB = makeMockRunner("agent-b");
    const poolA = new RunnerPool([runnerA]);
    const poolB = new RunnerPool([runnerB]);

    const configA = makeAgentConfig("agent-a", { schedule: "0 * * * *" });
    const configB = makeAgentConfig("agent-b", { schedule: "*/30 * * * *" });

    const ctx = makeContext({
      agentConfigs: [configA, configB],
      runnerPools: { "agent-a": poolA, "agent-b": poolB },
    });

    // Queue full
    (ctx.schedulerCtx.workQueue.enqueue as any).mockReturnValue({ dropped: true });

    // Remove agent-a
    mockedDiscoverAgents.mockReturnValue(["agent-b"]);

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    // Mark runner busy
    runnerB.isRunning = true;

    const cronJob = ctx.cronJobs.find((j: any) => j._callback) as any;
    expect(cronJob).toBeDefined();

    await cronJob.fire();

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "agent-b" }),
      "queue full, oldest event dropped"
    );
  });

  it("rebuildCronJobs cron callback calls runWithReruns when runner is available", async () => {
    const runnerA = makeMockRunner("agent-a");
    const runnerB = makeMockRunner("agent-b");
    const poolA = new RunnerPool([runnerA]);
    const poolB = new RunnerPool([runnerB]);

    const configA = makeAgentConfig("agent-a", { schedule: "0 * * * *" });
    const configB = makeAgentConfig("agent-b", { schedule: "*/30 * * * *" });

    const ctx = makeContext({
      agentConfigs: [configA, configB],
      runnerPools: { "agent-a": poolA, "agent-b": poolB },
    });

    // Remove agent-a
    mockedDiscoverAgents.mockReturnValue(["agent-b"]);

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    // runner is idle (default isRunning=false)
    const cronJob = ctx.cronJobs.find((j: any) => j._callback) as any;
    expect(cronJob).toBeDefined();

    const { runWithReruns: mockedRunWithReruns } = await import("../../src/execution/execution.js");
    (mockedRunWithReruns as any).mockResolvedValueOnce(undefined);

    await cronJob.fire();

    expect(mockedRunWithReruns).toHaveBeenCalledWith(
      runnerB,
      configB,
      0,
      ctx.schedulerCtx
    );
  });

  // ── rebuildCronJobs: skip agents without schedule or without pool ──────────

  it("rebuildCronJobs skips agent without a schedule (covers !agentConfig.schedule continue)", async () => {
    const runnerA = makeMockRunner("agent-a");
    const poolA = new RunnerPool([runnerA]);

    // configA has NO schedule; configB will be removed
    const configA = makeAgentConfig("agent-a", { schedule: undefined }); // no schedule
    const configB = makeAgentConfig("agent-b", { schedule: "0 * * * *" });

    const ctx = makeContext({
      agentConfigs: [configA, configB],
      runnerPools: { "agent-a": poolA },
    });

    // Remove agent-b → rebuildCronJobs runs for remaining agents
    // agent-a has no schedule → skipped (continue)
    mockedDiscoverAgents.mockReturnValue(["agent-a"]);

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-b");

    // No cron jobs should be created for agent-a (no schedule)
    const cronJobForA = ctx.cronJobs.find((j: any) => j._callback);
    expect(cronJobForA).toBeUndefined();
  });

  it("rebuildCronJobs skips agent with schedule but no runner pool (covers !pool continue)", async () => {
    const runnerA = makeMockRunner("agent-a");
    const poolA = new RunnerPool([runnerA]);

    // configA has a schedule but NO pool entry; configB will be removed
    const configA = makeAgentConfig("agent-a", { schedule: "0 * * * *" });
    const configB = makeAgentConfig("agent-b", { schedule: "*/5 * * * *" });

    const ctx = makeContext({
      agentConfigs: [configA, configB],
      runnerPools: { "agent-b": poolA }, // no pool for agent-a
    });

    // Remove agent-b → rebuildCronJobs runs for remaining agents
    // agent-a has schedule but no pool → skipped (continue)
    mockedDiscoverAgents.mockReturnValue(["agent-a"]);

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-b");

    // No cron job for agent-a (pool missing)
    const cronJobForA = ctx.cronJobs.find((j: any) => j._callback);
    expect(cronJobForA).toBeUndefined();
  });

  // ── handleUpdatedAgent: revert to container runtime (lines 335-336) ────────

  it("updated agent: reverts agentRuntimeOverrides to container runtime when new config has no host-user runtime", async () => {
    const runner = {
      ...makeMockRunner("agent-a"),
      setRuntime: vi.fn(),
    };
    const pool = new RunnerPool([runner]);
    // Old config has host-user runtime
    const oldConfig = makeAgentConfig("agent-a", {
      runtime: { type: "host-user", run_as: "al-agent", groups: [] },
    });
    const ctx = makeContext({
      agentConfigs: [oldConfig],
      runnerPools: { "agent-a": pool },
      agentRuntimeOverrides: { "agent-a": { type: "host-user-runtime" } as any },
    });

    // New config has NO host-user runtime (reverted to container runtime)
    const updatedConfig = makeAgentConfig("agent-a", { schedule: "*/5 * * * *" });
    mockedDiscoverAgents.mockReturnValue(["agent-a"]);
    mockedLoadAgentConfig.mockReturnValue(updatedConfig);

    // createAgentRuntimeOverride returns null for the new config (no host-user runtime)
    mockCreateAgentRuntimeOverride.mockReturnValueOnce(null);

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    // agentRuntimeOverrides should have the key removed
    expect(ctx.agentRuntimeOverrides["agent-a"]).toBeUndefined();
    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "agent-a" }),
      "hot reload: reverted to container runtime"
    );
  });

  // ── handleChangedAgent: scale 0→N transition ─────────────────────────────

  it("handles changed agent: scale 0→N creates pool, runners, cron, and webhooks", async () => {
    // Start with an agent config at scale=0 with no pool
    const disabledConfig = makeAgentConfig("agent-a", { scale: 0, schedule: "0 * * * *" });
    const ctx = makeContext({
      agentConfigs: [disabledConfig],
      runnerPools: {}, // No pool for agent-a since scale=0
    });

    // Re-enable agent to scale=3
    const enabledConfig = makeAgentConfig("agent-a", { scale: 3, schedule: "0 * * * *" });
    mockedDiscoverAgents.mockReturnValue(["agent-a"]);
    mockedLoadAgentConfig.mockReturnValue(enabledConfig);
    mockedBuildSingleAgentImage.mockResolvedValue("agent-a:v1");

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    // Pool should now exist with 3 runners
    expect(ctx.runnerPools["agent-a"]).toBeInstanceOf(RunnerPool);
    expect(ctx.runnerPools["agent-a"]!.size).toBe(3);
    expect(ctx.createRunner).toHaveBeenCalledTimes(3);

    // Cron job should be created since schedule exists
    expect(ctx.cronJobs.length).toBeGreaterThan(0);
    expect(ctx.statusTracker!.setNextRunAt).toHaveBeenCalled();

    // Webhooks should be registered
    expect(mockedRegisterWebhookBindings).toHaveBeenCalled();

    // Status should be updated
    expect(ctx.statusTracker!.updateAgentScale).toHaveBeenCalledWith("agent-a", 3);
    expect(ctx.statusTracker!.setAgentState).toHaveBeenCalledWith("agent-a", "idle");
    expect(ctx.statusTracker!.addLogLine).toHaveBeenCalledWith(
      "agent-a",
      "hot-reloaded (activated from scale=0)"
    );
    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "agent-a", scale: 3 }),
      "hot reload: agent activated from scale=0"
    );
  });

  it("handles changed agent: scale 0→N without schedule (no cron)", async () => {
    const disabledConfig = makeAgentConfig("agent-a", { scale: 0, schedule: undefined });
    const ctx = makeContext({
      agentConfigs: [disabledConfig],
      runnerPools: {},
    });

    const enabledConfig = makeAgentConfig("agent-a", { scale: 2, schedule: undefined });
    mockedDiscoverAgents.mockReturnValue(["agent-a"]);
    mockedLoadAgentConfig.mockReturnValue(enabledConfig);
    mockedBuildSingleAgentImage.mockResolvedValue("agent-a:v1");

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    // Pool should exist with 2 runners
    expect(ctx.runnerPools["agent-a"]!.size).toBe(2);

    // No cron job should be created since schedule is undefined
    expect(ctx.statusTracker!.setNextRunAt).not.toHaveBeenCalled();

    // Webhooks should still be registered if webhookRegistry exists
    expect(mockedRegisterWebhookBindings).toHaveBeenCalled();
  });

  it("handles changed agent: scale 0→N with webhooks registers bindings", async () => {
    const disabledConfig = makeAgentConfig("agent-a", { scale: 0, webhooks: [{ source: "github", trigger: { event: "push" } }] });
    const ctx = makeContext({
      agentConfigs: [disabledConfig],
      runnerPools: {},
    });

    const enabledConfig = makeAgentConfig("agent-a", { scale: 1, webhooks: [{ source: "github", trigger: { event: "push" } }] });
    mockedDiscoverAgents.mockReturnValue(["agent-a"]);
    mockedLoadAgentConfig.mockReturnValue(enabledConfig);
    mockedBuildSingleAgentImage.mockResolvedValue("agent-a:v1");

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    // Pool should exist
    expect(ctx.runnerPools["agent-a"]).toBeInstanceOf(RunnerPool);

    // registerWebhookBindings should have been called with the enabled agent
    expect(mockedRegisterWebhookBindings).toHaveBeenCalled();
  });

  // ── handleChangedAgent: scale N→0 transition ─────────────────────────────

  it("handles changed agent: scale N→0 tears down pool, cron, and webhooks", async () => {
    // Start with an enabled agent at scale=2
    const enabledConfig = makeAgentConfig("agent-a", { scale: 2, schedule: "0 * * * *" });
    const runner1 = makeMockRunner("agent-a-1");
    const runner2 = makeMockRunner("agent-a-2");
    // Mark runners as running so killAll() will call abort()
    runner1.isRunning = true;
    runner2.isRunning = true;
    const pool = new RunnerPool([runner1, runner2]);

    const ctx = makeContext({
      agentConfigs: [enabledConfig],
      runnerPools: { "agent-a": pool },
    });

    // Add a cron job for this agent (simulate existing schedule)
    const mockCronJob: any = { stop: vi.fn() };
    ctx.cronJobs.push(mockCronJob);

    // Disable the agent (scale to 0)
    const disabledConfig = makeAgentConfig("agent-a", { scale: 0, schedule: "0 * * * *" });
    mockedDiscoverAgents.mockReturnValue(["agent-a"]);
    mockedLoadAgentConfig.mockReturnValue(disabledConfig);

    const handle = watchAgents(ctx);
    await handle._handleAgentChange("agent-a");

    // Pool should be killed and removed
    expect(runner1.abort).toHaveBeenCalled();
    expect(runner2.abort).toHaveBeenCalled();
    expect(ctx.runnerPools["agent-a"]).toBeUndefined();

    // Webhook bindings should be removed
    expect(ctx.webhookRegistry!.removeBindingsForAgent).toHaveBeenCalledWith("agent-a");

    // Cron job should be rebuilt (stopped)
    expect(mockCronJob.stop).toHaveBeenCalled();

    // Status should be updated
    expect(ctx.statusTracker!.updateAgentScale).toHaveBeenCalledWith("agent-a", 0);
    expect(ctx.statusTracker!.setAgentState).toHaveBeenCalledWith("agent-a", "idle");
    expect(ctx.statusTracker!.setNextRunAt).toHaveBeenCalledWith("agent-a", null);
    expect(ctx.statusTracker!.addLogLine).toHaveBeenCalledWith(
      "agent-a",
      "hot-reloaded (deactivated to scale=0)"
    );
    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "agent-a" }),
      "hot reload: agent deactivated (scale=0)"
    );
  });

  it("handles changed agent: scale N→0 without pool (gracefully ignores)", async () => {
    // Start with config that claims scale=2 but pool is missing (edge case)
    const enabledConfig = makeAgentConfig("agent-a", { scale: 2 });
    const ctx = makeContext({
      agentConfigs: [enabledConfig],
      runnerPools: {}, // Pool missing
    });

    const disabledConfig = makeAgentConfig("agent-a", { scale: 0 });
    mockedDiscoverAgents.mockReturnValue(["agent-a"]);
    mockedLoadAgentConfig.mockReturnValue(disabledConfig);

    const handle = watchAgents(ctx);
    // Should not throw
    await handle._handleAgentChange("agent-a");

    // Pool should still be missing (none to kill)
    expect(ctx.runnerPools["agent-a"]).toBeUndefined();

    // Status should still be updated
    expect(ctx.statusTracker!.updateAgentScale).toHaveBeenCalledWith("agent-a", 0);
    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "agent-a" }),
      "hot reload: agent deactivated (scale=0)"
    );
  });
});
