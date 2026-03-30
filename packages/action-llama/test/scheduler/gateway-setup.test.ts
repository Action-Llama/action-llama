import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// Mock control/api-key
const { mockEnsureGatewayApiKey, mockLoadGatewayApiKey } = vi.hoisted(() => ({
  mockEnsureGatewayApiKey: vi.fn().mockResolvedValue({ key: "test-api-key", generated: false }),
  mockLoadGatewayApiKey: vi.fn().mockResolvedValue("test-api-key"),
}));

vi.mock("../../src/control/api-key.js", () => ({
  ensureGatewayApiKey: (...args: any[]) => mockEnsureGatewayApiKey(...args),
  loadGatewayApiKey: (...args: any[]) => mockLoadGatewayApiKey(...args),
}));

// Mock gateway
const mockStartGateway = vi.fn();

vi.mock("../../src/gateway/index.js", () => ({
  startGateway: (...args: any[]) => mockStartGateway(...args),
}));

// Mock logger
vi.mock("../../src/shared/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  }),
  createFileOnlyLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  }),
}));

// Mock chat container launcher
const { mockChatContainerLauncherCtor } = vi.hoisted(() => ({
  mockChatContainerLauncherCtor: vi.fn(),
}));

vi.mock("../../src/chat/container-launcher.js", () => ({
  ChatContainerLauncher: class MockChatContainerLauncher {
    launchChatContainer = vi.fn().mockResolvedValue(undefined);
    stopChatContainer = vi.fn().mockResolvedValue(undefined);
    constructor(...args: any[]) {
      mockChatContainerLauncherCtor(...args);
    }
  },
}));

// Mock execution
vi.mock("../../src/execution/execution.js", () => ({
  runWithReruns: vi.fn().mockResolvedValue(undefined),
}));

// Mock shared/config.js
const mockUpdateProjectScale = vi.fn();
const mockUpdateAgentRuntimeField = vi.fn();

vi.mock("../../src/shared/config.js", () => ({
  updateProjectScale: (...args: any[]) => mockUpdateProjectScale(...args),
  updateAgentRuntimeField: (...args: any[]) => mockUpdateAgentRuntimeField(...args),
}));

import { setupGateway } from "../../src/scheduler/gateway-setup.js";
import { createLogger } from "../../src/shared/logger.js";

// --- Helpers ---

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => makeLogger(),
  } as any;
}

function makeGatewayResult(overrides?: Record<string, any>) {
  const registerContainer = vi.fn().mockResolvedValue(undefined);
  const unregisterContainer = vi.fn().mockResolvedValue(undefined);
  return {
    server: {},
    registerContainer,
    unregisterContainer,
    lockStore: { releaseAll: vi.fn(), dispose: vi.fn() },
    callStore: { failAllByCaller: vi.fn(), dispose: vi.fn() },
    setCallDispatcher: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    chatSessionManager: undefined,
    chatWebSocketState: undefined,
    ...overrides,
  };
}

function makeSchedulerState(overrides?: Partial<any>) {
  return {
    runnerPools: {},
    cronJobs: [],
    schedulerCtx: null,
    workQueue: null,
    ...overrides,
  };
}

function makeEvents() {
  return new EventEmitter() as any;
}

function makeAgentConfig(name: string) {
  return {
    name,
    models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" }],
    credentials: [],
    schedule: "*/5 * * * *",
    params: {},
  };
}

function makeBaseOpts(state: any, gatewayResult: any) {
  mockStartGateway.mockResolvedValue(gatewayResult);
  return {
    projectPath: "/tmp/project",
    globalConfig: { models: {} },
    state,
    agentConfigs: [makeAgentConfig("dev"), makeAgentConfig("reviewer")],
    webhookSecrets: {},
    events: makeEvents(),
    mkLogger: createLogger as any,
    logger: makeLogger(),
  };
}

describe("setupGateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureGatewayApiKey.mockResolvedValue({ key: "test-api-key", generated: false });
    mockLoadGatewayApiKey.mockResolvedValue("test-api-key");
  });

  describe("basic setup", () => {
    it("returns gateway, gatewayPort, registerContainer, unregisterContainer, setChatRuntime", async () => {
      const gatewayResult = makeGatewayResult();
      const state = makeSchedulerState();
      const opts = makeBaseOpts(state, gatewayResult);

      const result = await setupGateway(opts);

      expect(result).toHaveProperty("gateway");
      expect(result).toHaveProperty("gatewayPort", 8080);
      expect(result).toHaveProperty("registerContainer");
      expect(result).toHaveProperty("unregisterContainer");
      expect(result).toHaveProperty("setChatRuntime");
      expect(typeof result.setChatRuntime).toBe("function");
    });

    it("uses globalConfig gateway port when set", async () => {
      const gatewayResult = makeGatewayResult();
      const state = makeSchedulerState();
      const opts = makeBaseOpts(state, gatewayResult);
      opts.globalConfig = { models: {}, gateway: { port: 9090 } } as any;

      const result = await setupGateway(opts);

      expect(result.gatewayPort).toBe(9090);
      expect(mockStartGateway).toHaveBeenCalledWith(
        expect.objectContaining({ port: 9090 }),
      );
    });

    it("uses hostname 127.0.0.1 when expose is false", async () => {
      const gatewayResult = makeGatewayResult();
      const state = makeSchedulerState();
      const opts = makeBaseOpts(state, gatewayResult);

      await setupGateway(opts);

      expect(mockStartGateway).toHaveBeenCalledWith(
        expect.objectContaining({ hostname: "127.0.0.1" }),
      );
    });

    it("uses hostname 0.0.0.0 when expose is true", async () => {
      const gatewayResult = makeGatewayResult();
      const state = makeSchedulerState();
      const opts = { ...makeBaseOpts(state, gatewayResult), expose: true };

      await setupGateway(opts);

      expect(mockStartGateway).toHaveBeenCalledWith(
        expect.objectContaining({ hostname: "0.0.0.0" }),
      );
    });

    it("logs a warning when API key is generated and webUI is enabled", async () => {
      mockEnsureGatewayApiKey.mockResolvedValue({ key: "new-key", generated: true });
      const gatewayResult = makeGatewayResult();
      const state = makeSchedulerState();
      const logger = makeLogger();
      const opts = { ...makeBaseOpts(state, gatewayResult), logger, webUI: true };

      await setupGateway(opts);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("API key"),
      );
    });

    it("does not warn when API key is not newly generated", async () => {
      mockEnsureGatewayApiKey.mockResolvedValue({ key: "existing-key", generated: false });
      const gatewayResult = makeGatewayResult();
      const state = makeSchedulerState();
      const logger = makeLogger();
      const opts = { ...makeBaseOpts(state, gatewayResult), logger };

      await setupGateway(opts);

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("wires stopContainer callback on chatWebSocketState when present", async () => {
      const chatWebSocketState = { stopContainer: undefined as any };
      const gatewayResult = makeGatewayResult({ chatWebSocketState });
      const state = makeSchedulerState();
      const opts = makeBaseOpts(state, gatewayResult);

      await setupGateway(opts);

      expect(chatWebSocketState.stopContainer).toBeDefined();
      expect(typeof chatWebSocketState.stopContainer).toBe("function");
    });
  });

  describe("controlDeps.killInstance", () => {
    it("returns false when no pools are registered", async () => {
      const gatewayResult = makeGatewayResult();
      const state = makeSchedulerState({ runnerPools: {} });
      const opts = makeBaseOpts(state, gatewayResult);

      await setupGateway(opts);

      const { controlDeps } = mockStartGateway.mock.calls[0][0];
      const result = await controlDeps.killInstance("instance-1");
      expect(result).toBe(false);
    });

    it("delegates to pools and returns true when one kills the instance", async () => {
      const gatewayResult = makeGatewayResult();
      const pool1 = { killInstance: vi.fn().mockReturnValue(false) };
      const pool2 = { killInstance: vi.fn().mockReturnValue(true) };
      const state = makeSchedulerState({ runnerPools: { dev: pool1, reviewer: pool2 } });
      const opts = makeBaseOpts(state, gatewayResult);

      await setupGateway(opts);

      const { controlDeps } = mockStartGateway.mock.calls[0][0];
      const result = await controlDeps.killInstance("instance-abc");
      expect(result).toBe(true);
      expect(pool1.killInstance).toHaveBeenCalledWith("instance-abc");
      expect(pool2.killInstance).toHaveBeenCalledWith("instance-abc");
    });
  });

  describe("controlDeps.killAgent", () => {
    it("returns null when agent pool is not found", async () => {
      const gatewayResult = makeGatewayResult();
      const state = makeSchedulerState({ runnerPools: {} });
      const opts = makeBaseOpts(state, gatewayResult);

      await setupGateway(opts);

      const { controlDeps } = mockStartGateway.mock.calls[0][0];
      const result = await controlDeps.killAgent("nonexistent");
      expect(result).toBeNull();
    });

    it("kills all instances and returns killed count", async () => {
      const gatewayResult = makeGatewayResult();
      const pool = { killAll: vi.fn().mockReturnValue(3) };
      const state = makeSchedulerState({ runnerPools: { dev: pool } });
      const opts = makeBaseOpts(state, gatewayResult);

      await setupGateway(opts);

      const { controlDeps } = mockStartGateway.mock.calls[0][0];
      const result = await controlDeps.killAgent("dev");
      expect(result).toEqual({ killed: 3 });
      expect(pool.killAll).toHaveBeenCalledOnce();
    });
  });

  describe("controlDeps.pauseScheduler / resumeScheduler", () => {
    it("pauses all cron jobs and updates statusTracker", async () => {
      const gatewayResult = makeGatewayResult();
      const job1 = { pause: vi.fn(), resume: vi.fn(), stop: vi.fn() };
      const job2 = { pause: vi.fn(), resume: vi.fn(), stop: vi.fn() };
      const statusTracker = { setPaused: vi.fn(), isPaused: vi.fn().mockReturnValue(false) };
      const state = makeSchedulerState({ cronJobs: [job1, job2] });
      const opts = { ...makeBaseOpts(state, gatewayResult), statusTracker: statusTracker as any };

      await setupGateway(opts);

      const { controlDeps } = mockStartGateway.mock.calls[0][0];
      await controlDeps.pauseScheduler();

      expect(job1.pause).toHaveBeenCalledOnce();
      expect(job2.pause).toHaveBeenCalledOnce();
      expect(statusTracker.setPaused).toHaveBeenCalledWith(true);
    });

    it("resumes all cron jobs and updates statusTracker", async () => {
      const gatewayResult = makeGatewayResult();
      const job1 = { pause: vi.fn(), resume: vi.fn(), stop: vi.fn() };
      const statusTracker = { setPaused: vi.fn(), isPaused: vi.fn().mockReturnValue(true) };
      const state = makeSchedulerState({ cronJobs: [job1] });
      const opts = { ...makeBaseOpts(state, gatewayResult), statusTracker: statusTracker as any };

      await setupGateway(opts);

      const { controlDeps } = mockStartGateway.mock.calls[0][0];
      await controlDeps.resumeScheduler();

      expect(job1.resume).toHaveBeenCalledOnce();
      expect(statusTracker.setPaused).toHaveBeenCalledWith(false);
    });
  });

  describe("controlDeps.triggerAgent", () => {
    it("returns error string when scheduler is paused", async () => {
      const gatewayResult = makeGatewayResult();
      const statusTracker = { isPaused: vi.fn().mockReturnValue(true), setPaused: vi.fn() };
      const state = makeSchedulerState({});
      const opts = { ...makeBaseOpts(state, gatewayResult), statusTracker: statusTracker as any };

      await setupGateway(opts);

      const { controlDeps } = mockStartGateway.mock.calls[0][0];
      const result = await controlDeps.triggerAgent("dev");
      expect(result).toBe("Scheduler is paused");
    });

    it("returns error string when agent config is not found", async () => {
      const gatewayResult = makeGatewayResult();
      const statusTracker = { isPaused: vi.fn().mockReturnValue(false) };
      const state = makeSchedulerState({ runnerPools: {} });
      const opts = { ...makeBaseOpts(state, gatewayResult), statusTracker: statusTracker as any };

      await setupGateway(opts);

      const { controlDeps } = mockStartGateway.mock.calls[0][0];
      // "unknown" is not in agentConfigs, so config check fails first
      const result = await controlDeps.triggerAgent("unknown");
      expect(result).toBe('Agent "unknown" not found');
    });

    it("queues manual trigger when pools are not ready (building)", async () => {
      const gatewayResult = makeGatewayResult();
      const statusTracker = { isPaused: vi.fn().mockReturnValue(false) };
      const mockWorkQueue = { enqueue: vi.fn().mockReturnValue({ accepted: true }), size: vi.fn().mockReturnValue(1) };
      // pool is missing (still building), but workQueue is available
      const state = makeSchedulerState({ runnerPools: {}, workQueue: mockWorkQueue });
      const opts = { ...makeBaseOpts(state, gatewayResult), statusTracker: statusTracker as any };

      await setupGateway(opts);

      const { controlDeps } = mockStartGateway.mock.calls[0][0];
      const result = await controlDeps.triggerAgent("dev");

      expect(result).toHaveProperty("instanceId");
      expect((result as any).instanceId).toMatch(/^dev-[0-9a-f]{8}$/);
      expect(mockWorkQueue.enqueue).toHaveBeenCalledWith("dev", { type: 'manual', prompt: undefined });
    });

    it("returns error string when no available runner", async () => {
      const gatewayResult = makeGatewayResult();
      const statusTracker = { isPaused: vi.fn().mockReturnValue(false) };
      const pool = { getAvailableRunner: vi.fn().mockReturnValue(null) };
      const schedulerCtx = { workQueue: { size: vi.fn().mockReturnValue(0) } } as any;
      const state = makeSchedulerState({ runnerPools: { dev: pool }, schedulerCtx });
      const opts = { ...makeBaseOpts(state, gatewayResult), statusTracker: statusTracker as any };

      await setupGateway(opts);

      const { controlDeps } = mockStartGateway.mock.calls[0][0];
      const result = await controlDeps.triggerAgent("dev");
      expect(result).toBe('Agent "dev" has no available runners (all busy)');
    });

    it("returns error string when scheduler context is not ready", async () => {
      const gatewayResult = makeGatewayResult();
      const statusTracker = { isPaused: vi.fn().mockReturnValue(false) };
      const mockRunner = { run: vi.fn() };
      const pool = { getAvailableRunner: vi.fn().mockReturnValue(mockRunner) };
      const state = makeSchedulerState({ runnerPools: { dev: pool }, schedulerCtx: null });
      const opts = { ...makeBaseOpts(state, gatewayResult), statusTracker: statusTracker as any };

      await setupGateway(opts);

      const { controlDeps } = mockStartGateway.mock.calls[0][0];
      const result = await controlDeps.triggerAgent("dev");
      expect(result).toBe("Scheduler is not ready");
    });

    it("triggers agent run and returns instanceId", async () => {
      const { runWithReruns } = await import("../../src/execution/execution.js");

      const gatewayResult = makeGatewayResult();
      const statusTracker = { isPaused: vi.fn().mockReturnValue(false) };
      const mockRunner = { run: vi.fn().mockResolvedValue({ result: "completed", triggers: [] }) };
      const pool = { getAvailableRunner: vi.fn().mockReturnValue(mockRunner) };
      const schedulerCtx = { workQueue: { size: vi.fn().mockReturnValue(0) } } as any;
      const state = makeSchedulerState({ runnerPools: { dev: pool }, schedulerCtx });
      const opts = { ...makeBaseOpts(state, gatewayResult), statusTracker: statusTracker as any };

      await setupGateway(opts);

      const { controlDeps } = mockStartGateway.mock.calls[0][0];
      const result = await controlDeps.triggerAgent("dev", "do something");

      expect(result).toHaveProperty("instanceId");
      expect((result as any).instanceId).toMatch(/^dev-[0-9a-f]{8}$/);
      expect(runWithReruns).toHaveBeenCalledWith(
        mockRunner,
        expect.objectContaining({ name: "dev" }),
        0,
        schedulerCtx,
        "do something",
        expect.stringMatching(/^dev-/),
      );
    });

    it("returns error string when agent config not found (pool exists but no config)", async () => {
      const gatewayResult = makeGatewayResult();
      const statusTracker = { isPaused: vi.fn().mockReturnValue(false) };
      const mockRunner = { run: vi.fn() };
      const pool = { getAvailableRunner: vi.fn().mockReturnValue(mockRunner) };
      const schedulerCtx = { workQueue: { size: vi.fn().mockReturnValue(0) } } as any;
      const state = makeSchedulerState({ runnerPools: { unknown: pool }, schedulerCtx });
      // agentConfigs does NOT include "unknown"
      const opts = makeBaseOpts(state, gatewayResult);
      opts.statusTracker = statusTracker as any;

      await setupGateway(opts);

      const { controlDeps } = mockStartGateway.mock.calls[0][0];
      const result = await controlDeps.triggerAgent("unknown");
      // Config check is now first — returns "not found" (not "config not found")
      expect(result).toBe('Agent "unknown" not found');
    });
  });

  describe("controlDeps.enableAgent / disableAgent", () => {
    it("returns false when statusTracker is not provided", async () => {
      const gatewayResult = makeGatewayResult();
      const state = makeSchedulerState();
      const opts = makeBaseOpts(state, gatewayResult);
      // no statusTracker

      await setupGateway(opts);

      const { controlDeps } = mockStartGateway.mock.calls[0][0];
      expect(await controlDeps.enableAgent("dev")).toBe(false);
      expect(await controlDeps.disableAgent("dev")).toBe(false);
    });

    it("returns false when agent config is not found", async () => {
      const gatewayResult = makeGatewayResult();
      const statusTracker = { enableAgent: vi.fn(), disableAgent: vi.fn() };
      const state = makeSchedulerState();
      const opts = { ...makeBaseOpts(state, gatewayResult), statusTracker: statusTracker as any };

      await setupGateway(opts);

      const { controlDeps } = mockStartGateway.mock.calls[0][0];
      expect(await controlDeps.enableAgent("nonexistent")).toBe(false);
      expect(await controlDeps.disableAgent("nonexistent")).toBe(false);
    });

    it("enables an agent via statusTracker and returns true", async () => {
      const gatewayResult = makeGatewayResult();
      const statusTracker = { enableAgent: vi.fn(), disableAgent: vi.fn() };
      const state = makeSchedulerState();
      const opts = { ...makeBaseOpts(state, gatewayResult), statusTracker: statusTracker as any };

      await setupGateway(opts);

      const { controlDeps } = mockStartGateway.mock.calls[0][0];
      const result = await controlDeps.enableAgent("dev");
      expect(result).toBe(true);
      expect(statusTracker.enableAgent).toHaveBeenCalledWith("dev");
    });

    it("disables an agent via statusTracker and returns true", async () => {
      const gatewayResult = makeGatewayResult();
      const statusTracker = { enableAgent: vi.fn(), disableAgent: vi.fn() };
      const state = makeSchedulerState();
      const opts = { ...makeBaseOpts(state, gatewayResult), statusTracker: statusTracker as any };

      await setupGateway(opts);

      const { controlDeps } = mockStartGateway.mock.calls[0][0];
      const result = await controlDeps.disableAgent("dev");
      expect(result).toBe(true);
      expect(statusTracker.disableAgent).toHaveBeenCalledWith("dev");
    });
  });

  describe("controlDeps.updateProjectScale", () => {
    it("calls updateProjectScale with the given scale", async () => {
      const gatewayResult = makeGatewayResult();
      const state = makeSchedulerState();
      const opts = makeBaseOpts(state, gatewayResult);

      await setupGateway(opts);

      const { controlDeps } = mockStartGateway.mock.calls[0][0];
      const result = await controlDeps.updateProjectScale(3);

      expect(result).toBe(true);
      expect(mockUpdateProjectScale).toHaveBeenCalledWith("/tmp/project", 3);
    });
  });

  describe("controlDeps.updateAgentScale", () => {
    it("returns false when agent config not found", async () => {
      const gatewayResult = makeGatewayResult();
      const state = makeSchedulerState();
      const opts = makeBaseOpts(state, gatewayResult);

      await setupGateway(opts);

      const { controlDeps } = mockStartGateway.mock.calls[0][0];
      const result = await controlDeps.updateAgentScale("nonexistent", 2);
      expect(result).toBe(false);
      expect(mockUpdateAgentRuntimeField).not.toHaveBeenCalled();
    });

    it("updates scale for existing agent and returns true", async () => {
      const gatewayResult = makeGatewayResult();
      const statusTracker = { updateAgentScale: vi.fn() };
      const state = makeSchedulerState();
      const opts = { ...makeBaseOpts(state, gatewayResult), statusTracker: statusTracker as any };

      await setupGateway(opts);

      const { controlDeps } = mockStartGateway.mock.calls[0][0];
      const result = await controlDeps.updateAgentScale("dev", 5);

      expect(result).toBe(true);
      expect(mockUpdateAgentRuntimeField).toHaveBeenCalledWith("/tmp/project", "dev", "scale", 5);
      expect(statusTracker.updateAgentScale).toHaveBeenCalledWith("dev", 5);
    });
  });

  describe("controlDeps.workQueue", () => {
    it("returns 0 when schedulerCtx is null", async () => {
      const gatewayResult = makeGatewayResult();
      const state = makeSchedulerState({ schedulerCtx: null });
      const opts = makeBaseOpts(state, gatewayResult);

      await setupGateway(opts);

      const { controlDeps } = mockStartGateway.mock.calls[0][0];
      expect(controlDeps.workQueue.size("dev")).toBe(0);
    });

    it("delegates to workQueue.size when schedulerCtx is available", async () => {
      const gatewayResult = makeGatewayResult();
      const mockWorkQueue = { size: vi.fn().mockReturnValue(7), clearAll: vi.fn(), close: vi.fn() };
      const schedulerCtx = { workQueue: mockWorkQueue } as any;
      const state = makeSchedulerState({ schedulerCtx });
      const opts = makeBaseOpts(state, gatewayResult);

      await setupGateway(opts);

      const { controlDeps } = mockStartGateway.mock.calls[0][0];
      const count = controlDeps.workQueue.size("dev");
      expect(count).toBe(7);
      expect(mockWorkQueue.size).toHaveBeenCalledWith("dev");
    });
  });

  describe("setChatRuntime", () => {
    it("does nothing when chatSessionManager is absent", async () => {
      const gatewayResult = makeGatewayResult({ chatSessionManager: undefined });
      const state = makeSchedulerState();
      const opts = makeBaseOpts(state, gatewayResult);

      const { setChatRuntime } = await setupGateway(opts);

      const runtime = {} as any;
      const agentImages = { dev: "dev-image:latest" };

      // Should not throw
      expect(() => setChatRuntime(runtime, agentImages)).not.toThrow();
      expect(mockChatContainerLauncherCtor).not.toHaveBeenCalled();
    });

    it("creates ChatContainerLauncher when chatSessionManager is present", async () => {
      const chatSessionManager = { getSessions: vi.fn() };
      const gatewayResult = makeGatewayResult({ chatSessionManager });
      const state = makeSchedulerState();
      const opts = makeBaseOpts(state, gatewayResult);

      const { setChatRuntime } = await setupGateway(opts);

      const runtime = { launch: vi.fn() } as any;
      const agentImages = { dev: "dev-image:latest" };
      setChatRuntime(runtime, agentImages);

      // Constructor was called with the right args
      expect(mockChatContainerLauncherCtor).toHaveBeenCalledOnce();
      const [ctorArg] = mockChatContainerLauncherCtor.mock.calls[0];
      expect(ctorArg).toMatchObject({
        runtime,
        agentConfigs: expect.any(Array),
        sessionManager: chatSessionManager,
      });
    });

    it("images map provides live access to agentImages values", async () => {
      const chatSessionManager = { getSessions: vi.fn() };
      const gatewayResult = makeGatewayResult({ chatSessionManager });
      const state = makeSchedulerState();
      const opts = makeBaseOpts(state, gatewayResult);

      const { setChatRuntime } = await setupGateway(opts);

      const runtime = {} as any;
      const agentImages: Record<string, string> = { dev: "dev-image:v1" };
      setChatRuntime(runtime, agentImages);

      const [ctorArg] = mockChatContainerLauncherCtor.mock.calls[0];
      const images = ctorArg.images as Map<string, string>;
      // Initial value
      expect(images.get("dev")).toBe("dev-image:v1");
      // Live — changes to agentImages are visible through the proxy
      agentImages["dev"] = "dev-image:v2";
      expect(images.get("dev")).toBe("dev-image:v2");
      expect(images.has("dev")).toBe(true);
      expect(images.has("nonexistent")).toBe(false);
    });
  });

  describe("controlDeps.stopScheduler", () => {
    it("closes gateway and calls process.exit(0)", async () => {
      const processExitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: any) => undefined as never);

      try {
        const gatewayClose = vi.fn().mockResolvedValue(undefined);
        const gatewayResult = makeGatewayResult({ close: gatewayClose });
        const state = makeSchedulerState();
        const opts = makeBaseOpts(state, gatewayResult);

        await setupGateway(opts);

        const { controlDeps } = mockStartGateway.mock.calls[0][0];
        await controlDeps.stopScheduler();

        expect(gatewayClose).toHaveBeenCalledOnce();
        expect(processExitSpy).toHaveBeenCalledWith(0);
      } finally {
        processExitSpy.mockRestore();
      }
    });

    it("clears work queue and marks shuttingDown when schedulerCtx exists", async () => {
      const processExitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: any) => undefined as never);

      try {
        const gatewayResult = makeGatewayResult();
        const workQueue = { clearAll: vi.fn(), close: vi.fn(), size: vi.fn().mockReturnValue(0) };
        const schedulerCtx = {
          shuttingDown: false,
          workQueue,
        } as any;
        const job1 = { stop: vi.fn() };
        const state = makeSchedulerState({ schedulerCtx, cronJobs: [job1] });
        const opts = makeBaseOpts(state, gatewayResult);

        await setupGateway(opts);

        const { controlDeps } = mockStartGateway.mock.calls[0][0];
        await controlDeps.stopScheduler();

        expect(schedulerCtx.shuttingDown).toBe(true);
        expect(workQueue.clearAll).not.toHaveBeenCalled();
        expect(workQueue.close).toHaveBeenCalledOnce();
        expect(job1.stop).toHaveBeenCalledOnce();
        expect(processExitSpy).toHaveBeenCalledWith(0);
      } finally {
        processExitSpy.mockRestore();
      }
    });

    it("calls stateStore.close and telemetry.shutdown when provided", async () => {
      const processExitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: any) => undefined as never);

      try {
        const gatewayResult = makeGatewayResult();
        const stateStore = { close: vi.fn().mockResolvedValue(undefined) };
        const telemetry = { shutdown: vi.fn().mockResolvedValue(undefined) };
        const state = makeSchedulerState();
        const opts = {
          ...makeBaseOpts(state, gatewayResult),
          stateStore: stateStore as any,
          telemetry,
        };

        await setupGateway(opts);

        const { controlDeps } = mockStartGateway.mock.calls[0][0];
        await controlDeps.stopScheduler();

        expect(stateStore.close).toHaveBeenCalledOnce();
        expect(telemetry.shutdown).toHaveBeenCalledOnce();
        expect(processExitSpy).toHaveBeenCalledWith(0);
      } finally {
        processExitSpy.mockRestore();
      }
    });
  });
});
