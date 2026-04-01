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
vi.mock("../../src/execution/image-builder.js", () => ({
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
    needsGateway = true;
    async isAgentRunning() { return false; }
    async listRunningAgents() { return []; }
    async launch() { return "mock-container"; }
    streamLogs() { return { stop: () => {} }; }
    async waitForExit() { return 0; }
    async kill() {}
    async remove() {}
    async prepareCredentials() { return { strategy: "volume" as const, stagingDir: "/tmp/mock", bundle: {} }; }
    cleanupCredentials() {}
    async fetchLogs() { return []; }
    followLogs() { return { stop: () => {} }; }
    getTaskUrl() { return null; }
    async buildImage() { return "mock-image"; }
    async pushImage(img: string) { return img; }
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
vi.mock("../../src/control/api-key.js", () => ({
  ensureGatewayApiKey: vi.fn().mockResolvedValue({ key: "test-api-key", generated: false }),
  loadGatewayApiKey: vi.fn().mockResolvedValue("test-api-key"),
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

// Mock extensions loader — using vi.fn() named with "mock" prefix so vitest allows it in factories
const mockLoadBuiltinExtensions = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/extensions/loader.js", () => ({
  loadBuiltinExtensions: (...args: any[]) => mockLoadBuiltinExtensions(...args),
  isExtension: (obj: any) => obj !== null && typeof obj === "object" && "metadata" in obj,
  getGlobalRegistry: () => ({}),
}));

// Mock execution/runtime-factory.js to avoid needing extensions registered in global registry
vi.mock("../../src/execution/runtime-factory.js", () => ({
  createContainerRuntime: vi.fn().mockResolvedValue({
    runtime: {
      needsGateway: true,
      isAgentRunning: async () => false,
      listRunningAgents: async () => [],
      launch: async () => "mock-container",
      kill: async () => {},
      remove: async () => {},
      fetchLogs: async () => [],
      followLogs: () => ({ stop: () => {} }),
      getTaskUrl: () => null,
      buildImage: async () => "mock-image",
      pushImage: async (img: string) => img,
      streamLogs: () => ({ stop: () => {} }),
      waitForExit: async () => 0,
      prepareCredentials: async () => ({ strategy: "volume", stagingDir: "/tmp/mock", bundle: {} }),
      cleanupCredentials: () => {},
    },
    agentRuntimeOverrides: {},
  }),
  buildAgentImages: vi.fn().mockResolvedValue({
    baseImage: "test-base-image",
    agentImages: {},
  }),
}));

// Mock telemetry
const mockTelemetryInit = vi.fn().mockResolvedValue(undefined);
const mockTelemetryShutdown = vi.fn().mockResolvedValue(undefined);
const mockInitTelemetry = vi.fn().mockReturnValue({
  init: mockTelemetryInit,
  shutdown: mockTelemetryShutdown,
});
vi.mock("../../src/telemetry/index.js", () => ({
  initTelemetry: (...args: any[]) => mockInitTelemetry(...args),
}));

// Mock webhook-setup (track call order for early binding test)
const mockRegisterWebhookBindings = vi.fn();
const mockSetupWebhookRegistry = vi.fn().mockResolvedValue({ registry: undefined, secrets: {} });
vi.mock("../../src/events/webhook-setup.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    setupWebhookRegistry: (...args: any[]) => mockSetupWebhookRegistry(...args),
    registerWebhookBindings: (...args: any[]) => mockRegisterWebhookBindings(...args),
  };
});

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

function writeAgentConfig(dir: string, config: Record<string, unknown>) {
  const { name, description, license, compatibility, ...runtimeFields } = config;
  // Write portable SKILL.md
  const frontmatter: Record<string, unknown> = {};
  if (name) frontmatter.name = name;
  if (description) frontmatter.description = description;
  if (license) frontmatter.license = license;
  if (compatibility) frontmatter.compatibility = compatibility;
  const yamlStr = stringifyYAML(frontmatter).trimEnd();
  writeFileSync(resolve(dir, "SKILL.md"), `---\n${yamlStr}\n---\n\n# Agent\n`);
  // Write runtime config.toml
  if (Object.keys(runtimeFields).length > 0) {
    writeFileSync(resolve(dir, "config.toml"), stringifyTOML(runtimeFields as Record<string, unknown>));
  }
}

function setupProject(tmpDir: string) {
  const globalConfig = {
    models: {
      sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" },
    },
  };
  writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML(globalConfig as Record<string, unknown>));

  const agents = [
    { name: "dev", credentials: ["github_token"], models: ["sonnet"], schedule: "*/5 * * * *" },
    { name: "reviewer", credentials: ["github_token"], models: ["sonnet"], schedule: "*/5 * * * *" },
    { name: "devops", credentials: ["github_token"], models: ["sonnet"], schedule: "*/15 * * * *" },
  ];

  for (const agent of agents) {
    const agentDir = resolve(tmpDir, "agents", agent.name);
    mkdirSync(agentDir, { recursive: true });
    writeAgentConfig(agentDir, agent);
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

  it("applies per-agent maxWorkQueueSize and logs the configuration", async () => {
    // Add maxWorkQueueSize to the dev agent's config
    const devDir = resolve(tmpDir, "agents", "dev");
    writeAgentConfig(devDir, {
      name: "dev",
      credentials: ["github_token"],
      models: ["sonnet"],
      schedule: "*/5 * * * *",
      maxWorkQueueSize: 10,
    });

    await startScheduler(tmpDir);

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "dev",
        maxWorkQueueSize: 10,
      }),
      "per-agent work queue size configured",
    );
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
      "all runners busy, work queued"
    );
  });

  it("handles manual run failure", async () => {
    mockRun.mockRejectedValueOnce(new Error("fail"));
    await startScheduler(tmpDir);
    vi.clearAllMocks();

    // The cron callback should catch the error internally, not propagate
    await expect(cronCallbacks[0]()).resolves.not.toThrow();
  });

  it("re-runs agent immediately when it requests rerun", async () => {
    // First call returns "rerun", second returns "completed" (no more work)
    mockRun
      .mockResolvedValueOnce({ result: "rerun", triggers: [] })
      .mockResolvedValue({ result: "completed", triggers: [] });
    await startScheduler(tmpDir);
    vi.clearAllMocks();

    // Manually trigger dev agent (first cron callback)
    await cronCallbacks[0]();

    // Wait for the rerun loop to settle
    await new Promise((r) => setTimeout(r, 200));

    // dev: 1 manual run + 1 rerun = 2 total
    expect(mockRun).toHaveBeenCalledTimes(2);
  });

  it("stops re-running after max reruns", async () => {
    // Always returns "rerun" — should stop at maxReruns
    mockRun.mockResolvedValue({ result: "rerun", triggers: [] });

    // Use a small maxReruns via global config
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      maxReruns: 2,
      models: {
        sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" },
      },
    } as Record<string, unknown>));
    await startScheduler(tmpDir);
    vi.clearAllMocks();

    // Manually trigger all 3 agents (dev, reviewer, devops)
    await cronCallbacks[0](); // dev
    await cronCallbacks[1](); // reviewer  
    await cronCallbacks[2](); // devops

    await new Promise((r) => setTimeout(r, 50));

    // 3 agents × (1 manual + 2 reruns) = 9 calls total
    expect(mockRun).toHaveBeenCalledTimes(9);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      { maxReruns: 2 },
      "dev hit max reruns limit"
    );
  });

  it("does not re-run on error", async () => {
    mockRun.mockResolvedValue({ result: "error" });
    await startScheduler(tmpDir);
    vi.clearAllMocks();

    // Manually trigger one agent
    await cronCallbacks[0]();

    await new Promise((r) => setTimeout(r, 50));

    // 1 agent runs once (error, no rerun)
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it("returns returnValue in run outcome", async () => {
    mockRun.mockResolvedValueOnce({ result: "completed", returnValue: "some result" })
      .mockResolvedValue({ result: "completed" });
    await startScheduler(tmpDir);
    vi.clearAllMocks();

    // Manually trigger one agent
    await cronCallbacks[0]();

    await new Promise((r) => setTimeout(r, 50));

    // 1 agent should run
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  describe("scale", () => {
    function setupScaleProject(tmpDir: string) {
      const globalConfig = {
        models: {
          sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" },
        },
      };
      writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML(globalConfig as Record<string, unknown>));

      const agents = [
        { name: "scaled-agent", credentials: ["github_token"], models: ["sonnet"], schedule: "*/5 * * * *", scale: 3 },
        { name: "single-agent", credentials: ["github_token"], models: ["sonnet"], schedule: "*/5 * * * *" },
      ];

      for (const agent of agents) {
        const agentDir = resolve(tmpDir, "agents", agent.name);
        mkdirSync(agentDir, { recursive: true });
        writeAgentConfig(agentDir, agent);
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
      const globalConfig = {
        models: {
          sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" },
        },
      };
      writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML(globalConfig as Record<string, unknown>));

      const agents = [
        { name: "active-agent", credentials: ["github_token"], models: ["sonnet"], schedule: "*/5 * * * *" },
        { name: "disabled-agent", credentials: ["github_token"], models: ["sonnet"], schedule: "*/5 * * * *", scale: 0 },
      ];

      for (const agent of agents) {
        const agentDir = resolve(tmpDir, "agents", agent.name);
        mkdirSync(agentDir, { recursive: true });
        writeAgentConfig(agentDir, agent);
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
      // Overwrite disabled-agent config to have no schedule but keep scale=0
      const agentDir = resolve(tmpDir, "agents", "disabled-agent");
      writeAgentConfig(agentDir, { name: "disabled-agent", credentials: ["github_token"], models: ["sonnet"], scale: 0 });

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
        setAgentTriggers: vi.fn(),
        setPaused: vi.fn(),
        setNextRunAt: vi.fn(),
        on: vi.fn(),
        enableAgent: vi.fn(),
        disableAgent: vi.fn(),
        getAgentScale: vi.fn().mockReturnValue(1),
        updateAgentScale: vi.fn(),
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
        "all runners busy, work queued"
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
      const globalConfig = {
        models: {
          sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" },
        },
      };
      writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML(globalConfig as Record<string, unknown>));

      const agents = [
        { name: "fast-agent", credentials: ["github_token"], models: ["sonnet"], schedule: "*/5 * * * *", timeout: 300 },
        { name: "slow-agent", credentials: ["github_token"], models: ["sonnet"], schedule: "*/5 * * * *", timeout: 1800 },
        { name: "default-agent", credentials: ["github_token"], models: ["sonnet"], schedule: "*/5 * * * *" },
      ];

      for (const agent of agents) {
        const agentDir = resolve(tmpDir, "agents", agent.name);
        mkdirSync(agentDir, { recursive: true });
        writeAgentConfig(agentDir, agent);
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

  describe("telemetry initialization", () => {
    function setupTelemetryProject(dir: string) {
      const globalConfig = {
        telemetry: {
          enabled: true,
          provider: "otel",
          endpoint: "http://localhost:4317",
          serviceName: "action-llama-test",
        },
        models: {
          sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" },
        },
      };
      writeFileSync(resolve(dir, "config.toml"), stringifyTOML(globalConfig as Record<string, unknown>));

      const agentDir = resolve(dir, "agents", "dev");
      mkdirSync(agentDir, { recursive: true });
      writeAgentConfig(agentDir, {
        name: "dev",
        credentials: ["github_token"],
        models: ["sonnet"],
        schedule: "*/5 * * * *",
      });
      mkdirSync(resolve(dir, ".al", "state", "dev"), { recursive: true });
    }

    beforeEach(() => {
      vi.clearAllMocks();
      cronCallbacks.length = 0;
      mockIsRunning = false;
      tmpDir = mkdtempSync(join(tmpdir(), "al-sched-telemetry-"));
      setupTelemetryProject(tmpDir);
    });

    it("initializes telemetry when telemetry.enabled is true in config", async () => {
      await startScheduler(tmpDir);

      // initTelemetry should have been called with the telemetry config
      expect(mockInitTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true, provider: "otel" })
      );
      // telemetry.init() should have been called
      expect(mockTelemetryInit).toHaveBeenCalledTimes(1);
      // Telemetry initialized log
      expect(mockLoggerInfo).toHaveBeenCalledWith("Telemetry initialized successfully");
    });

    it("logs warning when telemetry init fails", async () => {
      mockTelemetryInit.mockRejectedValueOnce(new Error("otel init failed"));

      await startScheduler(tmpDir);

      // Should warn about telemetry failure
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "otel init failed" }),
        "Failed to initialize telemetry"
      );
    });
  });

  describe("extension loading", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      cronCallbacks.length = 0;
      mockIsRunning = false;
      tmpDir = mkdtempSync(join(tmpdir(), "al-sched-ext-"));
      setupProject(tmpDir);
    });

    it("logs warning when loadBuiltinExtensions throws", async () => {
      mockLoadBuiltinExtensions.mockRejectedValueOnce(new Error("ext load failed"));

      await startScheduler(tmpDir);

      // Should warn about extension load failure
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "ext load failed" }),
        "Failed to load extensions"
      );
    });

    it("logs success when loadBuiltinExtensions resolves", async () => {
      // Default mock already resolves — just verify the success log is emitted
      await startScheduler(tmpDir);

      expect(mockLoggerInfo).toHaveBeenCalledWith("Extensions loaded successfully");
    });
  });

  describe("status tracker scale sync", () => {
    function setupScaleProject2(dir: string) {
      const globalConfig = {
        models: {
          sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" },
        },
      };
      writeFileSync(resolve(dir, "config.toml"), stringifyTOML(globalConfig as Record<string, unknown>));

      const agents = [
        { name: "scaled-up-agent", credentials: ["github_token"], models: ["sonnet"], schedule: "*/5 * * * *", scale: 3 },
      ];

      for (const agent of agents) {
        const agentDir = resolve(dir, "agents", agent.name);
        mkdirSync(agentDir, { recursive: true });
        writeAgentConfig(agentDir, agent);
        mkdirSync(resolve(dir, ".al", "state", agent.name), { recursive: true });
      }
    }

    beforeEach(() => {
      vi.clearAllMocks();
      cronCallbacks.length = 0;
      mockIsRunning = false;
      tmpDir = mkdtempSync(join(tmpdir(), "al-sched-scale-sync-"));
      setupScaleProject2(tmpDir);
    });

    it("syncs status tracker scale when actual scale differs from registered scale", async () => {
      // statusTracker.getAgentScale returns 1 (registered), but actual scale is 3
      const tracker = {
        isPaused: vi.fn().mockReturnValue(false),
        isAgentEnabled: vi.fn().mockReturnValue(true),
        registerAgent: vi.fn(),
        setAgentTriggers: vi.fn(),
        setPaused: vi.fn(),
        setNextRunAt: vi.fn(),
        on: vi.fn(),
        enableAgent: vi.fn(),
        disableAgent: vi.fn(),
        getAgentScale: vi.fn().mockReturnValue(1), // returns 1, but actual is 3
        updateAgentScale: vi.fn(),
      } as any;

      await startScheduler(tmpDir, undefined, tracker);

      // updateAgentScale should be called to sync the scale from 1 → 3
      expect(tracker.updateAgentScale).toHaveBeenCalledWith("scaled-up-agent", 3);
      // And a log should be emitted
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.objectContaining({ agent: "scaled-up-agent", registeredScale: 1, actualScale: 3 }),
        "synced status tracker scale with actual pool size"
      );
    });
  });

  describe("early webhook binding (before image builds)", () => {
    function setupWebhookProject(dir: string) {
      const globalConfig = {
        models: {
          sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" },
        },
        webhooks: {
          github: { provider: "github", secret: "test-secret" },
        },
      };
      writeFileSync(resolve(dir, "config.toml"), stringifyTOML(globalConfig as Record<string, unknown>));

      const agentDir = resolve(dir, "agents", "dev");
      mkdirSync(agentDir, { recursive: true });
      writeAgentConfig(agentDir, {
        name: "dev",
        credentials: ["github_token"],
        models: ["sonnet"],
        webhooks: [{ source: "github", events: ["push"] }],
      });
      mkdirSync(resolve(dir, ".al", "state", "dev"), { recursive: true });
    }

    beforeEach(() => {
      vi.clearAllMocks();
      cronCallbacks.length = 0;
      mockIsRunning = false;
      tmpDir = mkdtempSync(join(tmpdir(), "al-sched-webhooks-"));
      setupWebhookProject(tmpDir);
    });

    it("registers webhook bindings before buildAgentImages", async () => {
      // Track call order by recording invocation indices
      const callOrder: string[] = [];
      const { buildAgentImages } = await import("../../src/execution/runtime-factory.js");
      (buildAgentImages as any).mockImplementation(async (...args: any[]) => {
        callOrder.push("buildAgentImages");
        return { baseImage: "test-base-image", agentImages: { dev: "test-dev-image" } };
      });
      mockSetupWebhookRegistry.mockResolvedValue({
        registry: { bind: vi.fn(), unbind: vi.fn() },
        secrets: {},
      });
      mockRegisterWebhookBindings.mockImplementation(() => {
        callOrder.push("registerWebhookBindings");
      });

      await startScheduler(tmpDir);

      expect(mockRegisterWebhookBindings).toHaveBeenCalled();
      expect(callOrder).toContain("registerWebhookBindings");
      expect(callOrder).toContain("buildAgentImages");
      const bindIdx = callOrder.indexOf("registerWebhookBindings");
      const buildIdx = callOrder.indexOf("buildAgentImages");
      expect(bindIdx).toBeLessThan(buildIdx);
    });

    it("skips registerWebhookBindings for agents without webhooks configured", async () => {
      // Add a second agent WITHOUT webhooks to the project
      const agentDir2 = resolve(tmpDir, "agents", "reviewer");
      mkdirSync(agentDir2, { recursive: true });
      writeAgentConfig(agentDir2, {
        name: "reviewer",
        credentials: ["github_token"],
        models: ["sonnet"],
        schedule: "*/5 * * * *",
        // No webhooks field
      });
      mkdirSync(resolve(tmpDir, ".al", "state", "reviewer"), { recursive: true });

      mockSetupWebhookRegistry.mockResolvedValue({
        registry: { bind: vi.fn(), unbind: vi.fn() },
        secrets: {},
      });

      await startScheduler(tmpDir);

      // registerWebhookBindings should only be called for "dev" (the agent with webhooks)
      // NOT for "reviewer" (no webhooks configured)
      expect(mockRegisterWebhookBindings).toHaveBeenCalledTimes(1);
      const calledWith = mockRegisterWebhookBindings.mock.calls[0][0];
      expect(calledWith.agentConfig.name).toBe("dev");
    });

    it("queues webhook directly when onTrigger fires before schedulerCtx is ready", async () => {
      const fakeWebhookContext = {
        event: "push",
        action: "created",
        receiptId: "test-receipt-123",
        payload: { ref: "refs/heads/main" },
      };

      mockSetupWebhookRegistry.mockResolvedValue({
        registry: { bind: vi.fn(), unbind: vi.fn() },
        secrets: {},
      });

      // Make registerWebhookBindings call onTrigger immediately (before schedulerCtx is set)
      mockRegisterWebhookBindings.mockImplementation((args: any) => {
        // state.schedulerCtx is null at this point (set later in startScheduler)
        args.onTrigger(args.agentConfig, fakeWebhookContext);
      });

      await startScheduler(tmpDir);

      // The "webhook queued (agents building)" log should have been emitted
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: "dev",
          event: "push",
        }),
        "webhook queued (agents building)"
      );
    });

    it("queues webhook when dispatched after build but all runners are busy", async () => {
      let capturedOnTrigger: ((config: any, context: any) => any) | undefined;
      let capturedAgentConfig: any;

      const fakeWebhookContext = {
        event: "push",
        action: "created",
        receiptId: "test-receipt-456",
        payload: { ref: "refs/heads/main" },
      };

      mockSetupWebhookRegistry.mockResolvedValue({
        registry: { bind: vi.fn(), unbind: vi.fn() },
        secrets: {},
      });

      // Capture the onTrigger callback without calling it immediately
      mockRegisterWebhookBindings.mockImplementation((args: any) => {
        capturedOnTrigger = args.onTrigger;
        capturedAgentConfig = args.agentConfig;
      });

      // All runners busy
      mockIsRunning = true;
      await startScheduler(tmpDir);
      vi.clearAllMocks();

      // Now call the captured onTrigger — schedulerCtx is set, but runners are busy
      // dispatchOrQueue returns { action: "queued" }
      expect(capturedOnTrigger).toBeDefined();
      const result = capturedOnTrigger!(capturedAgentConfig, fakeWebhookContext);

      expect(result).toBe(true);
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: "dev",
          event: "push",
        }),
        "webhook queued"
      );
    });

    it("dispatches webhook to an available runner and logs 'webhook triggering agent'", async () => {
      let capturedOnTrigger: ((config: any, context: any) => any) | undefined;
      let capturedAgentConfig: any;

      const fakeWebhookContext = {
        event: "push",
        action: "created",
        source: "github",
        receiptId: "test-receipt-dispatch",
        payload: { ref: "refs/heads/main" },
      };

      mockSetupWebhookRegistry.mockResolvedValue({
        registry: { bind: vi.fn(), unbind: vi.fn() },
        secrets: {},
      });

      // Capture the onTrigger callback
      mockRegisterWebhookBindings.mockImplementation((args: any) => {
        capturedOnTrigger = args.onTrigger;
        capturedAgentConfig = args.agentConfig;
      });

      // Runners are available (not busy)
      mockIsRunning = false;
      await startScheduler(tmpDir);
      vi.clearAllMocks();

      // Call the trigger — schedulerCtx is set and a runner is free
      // dispatchOrQueue returns { action: "dispatched" }
      expect(capturedOnTrigger).toBeDefined();
      const result = capturedOnTrigger!(capturedAgentConfig, fakeWebhookContext);

      expect(result).toBe(true);
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: "dev",
          event: "push",
          action: "created",
        }),
        "webhook triggering agent",
      );

      // Flush the fire-and-forget executeRun promise
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockRun).toHaveBeenCalledTimes(1);
    });

  });

  describe("cron queued with dropped event (line 211)", () => {
    function setupSmallQueueProject(dir: string) {
      const globalConfig = {
        workQueueSize: 1, // tiny queue so the second enqueue drops the oldest
        models: {
          sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" },
        },
      };
      writeFileSync(resolve(dir, "config.toml"), stringifyTOML(globalConfig as Record<string, unknown>));

      const agentDir = resolve(dir, "agents", "dev");
      mkdirSync(agentDir, { recursive: true });
      writeAgentConfig(agentDir, {
        name: "dev",
        credentials: ["github_token"],
        models: ["sonnet"],
        schedule: "*/5 * * * *",
      });
      mkdirSync(resolve(dir, ".al", "state", "dev"), { recursive: true });
    }

    beforeEach(() => {
      vi.clearAllMocks();
      cronCallbacks.length = 0;
      mockIsRunning = false;
      tmpDir = mkdtempSync(join(tmpdir(), "al-sched-smallq-"));
      setupSmallQueueProject(tmpDir);
    });

    it("logs a warning when the work queue drops the oldest event on overflow", async () => {
      await startScheduler(tmpDir);
      vi.clearAllMocks();

      // All runners busy — work will be queued
      mockIsRunning = true;

      // First trigger — queue goes from 0 → 1 (at capacity), no drop
      await cronCallbacks[0]();

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.objectContaining({ agent: "dev" }),
        "all runners busy, work queued"
      );
      expect(mockLoggerWarn).not.toHaveBeenCalledWith(
        expect.objectContaining({ agent: "dev" }),
        "queue full, oldest event dropped"
      );

      vi.clearAllMocks();

      // Second trigger — queue is already at capacity (1), new item drops the oldest
      await cronCallbacks[0]();

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ agent: "dev" }),
        "queue full, oldest event dropped"
      );
    });
  });
});
