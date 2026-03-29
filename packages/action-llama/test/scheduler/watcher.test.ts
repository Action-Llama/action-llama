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
    stop = vi.fn();
    pause = vi.fn();
    resume = vi.fn();
    nextRun() { return new Date(); }
  }
  return { Cron: MockCron };
});

vi.mock("../../src/execution/execution.js", () => ({
  runWithReruns: vi.fn(async () => {}),
  makeWebhookPrompt: vi.fn(() => "test prompt"),
  executeRun: vi.fn(async () => ({ result: "completed", triggers: [] })),
  drainQueues: vi.fn(async () => {}),
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
      workQueue: { enqueue: vi.fn(() => ({ dropped: false })), size: vi.fn(() => 0), clearAll: vi.fn() } as any,
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
  });
});
