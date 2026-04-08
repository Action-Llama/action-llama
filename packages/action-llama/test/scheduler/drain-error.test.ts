/**
 * Focused tests for the scheduler's drainQueues error-handling paths.
 *
 * Covers two currently-uncovered statements in src/scheduler/index.ts:
 *   - Line 246: logger.error when initial drainQueues() call rejects at startup
 *   - Line 119: the .then(() => drainQueues()) callback body after webhook dispatch
 *
 * We mock execution.js to control drainQueues behaviour while keeping all
 * other scheduler phases intact.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";

// ─── Shared mutable state ──────────────────────────────────────────────────

const mockRun = vi.fn().mockResolvedValue({ result: "completed", triggers: [] });
let mockIsRunning = false;

// Controlled drainQueues spy — starts as a no-op that resolves
const mockDrainQueues = vi.fn().mockResolvedValue(undefined);

// ─── Module mocks ──────────────────────────────────────────────────────────

vi.mock("child_process", () => ({
  execFileSync: vi.fn(() => ""),
}));

vi.mock("../../src/execution/image-builder.js", () => ({
  buildAllImages: vi.fn().mockResolvedValue({
    baseImage: "test-base",
    agentImages: { dev: "test-dev-image" },
  }),
}));

vi.mock("../../src/docker/local-runtime.js", () => ({
  LocalDockerRuntime: class {
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
  },
}));

vi.mock("../../src/docker/network.js", () => ({
  ensureNetwork: vi.fn(),
}));

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

vi.mock("../../src/agents/runner.js", () => ({
  AgentRunner: class {
    instanceId = "mock-instance-id";
    get isRunning() { return mockIsRunning; }
    run = mockRun;
  },
}));

vi.mock("../../src/agents/container-runner.js", () => ({
  ContainerAgentRunner: class {
    instanceId = "mock-instance-id";
    get isRunning() { return mockIsRunning; }
    run = mockRun;
  },
}));

const mockCronStop = vi.fn();
vi.mock("croner", () => ({
  Cron: class {
    stop = mockCronStop;
    pause = vi.fn();
    resume = vi.fn();
    nextRun = () => new Date(Date.now() + 300000);
    constructor(_schedule: string, _opts: any, _callback: Function) {}
  },
}));

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

vi.mock("../../src/control/api-key.js", () => ({
  ensureGatewayApiKey: vi.fn().mockResolvedValue({ key: "test-api-key", generated: false }),
  loadGatewayApiKey: vi.fn().mockResolvedValue("test-api-key"),
}));

vi.mock("../../src/shared/state-store.js", () => ({
  createStateStore: vi.fn().mockResolvedValue({
    get: vi.fn(),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../../src/extensions/loader.js", () => ({
  loadBuiltinExtensions: vi.fn().mockResolvedValue(undefined),
  isExtension: (obj: any) => obj !== null && typeof obj === "object" && "metadata" in obj,
  getGlobalRegistry: () => ({}),
}));

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

vi.mock("../../src/telemetry/index.js", () => ({
  initTelemetry: vi.fn().mockReturnValue({
    init: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Webhook setup — capture onTrigger for webhook dispatch test
const mockSetupWebhookRegistry = vi.fn().mockResolvedValue({ registry: undefined, secrets: {} });
let capturedOnTrigger: ((config: any, context: any) => any) | undefined;
let capturedAgentConfig: any;
vi.mock("../../src/events/webhook-setup.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    setupWebhookRegistry: (...args: any[]) => mockSetupWebhookRegistry(...args),
    registerWebhookBindings: (args: any) => {
      capturedOnTrigger = args.onTrigger;
      capturedAgentConfig = args.agentConfig;
    },
  };
});

// Logger spy — used to verify error/warn calls
const mockLoggerError = vi.fn();
const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();
const makeLogger = (): Record<string, any> => ({
  info: mockLoggerInfo,
  warn: mockLoggerWarn,
  error: mockLoggerError,
  debug: vi.fn(),
  child: () => makeLogger(),
});
vi.mock("../../src/shared/logger.js", () => ({
  createLogger: () => makeLogger(),
  createFileOnlyLogger: () => makeLogger(),
}));

// ─── KEY MOCK: replace drainQueues in execution.js ─────────────────────────
// We keep all real implementations and only replace drainQueues so we can:
//   1. make it reject (to cover the .catch error-log path at startup)
//   2. spy on calls to it (to confirm the .then callback fires after webhook dispatch)
vi.mock("../../src/execution/execution.js", async (importOriginal) => {
  const real = await importOriginal() as Record<string, unknown>;
  return {
    ...real,
    drainQueues: (...args: any[]) => mockDrainQueues(...args),
  };
});

// ─── Import scheduler AFTER mocks ─────────────────────────────────────────
import { startScheduler } from "../../src/scheduler/index.js";

// ─── Helper: minimal single-agent project ─────────────────────────────────

function setupMinimalProject(dir: string) {
  const globalConfig = {
    models: {
      sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" },
    },
  };
  writeFileSync(resolve(dir, "config.toml"), stringifyTOML(globalConfig as Record<string, unknown>));

  const agentDir = resolve(dir, "agents", "dev");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "SKILL.md"), "---\n---\n\n# dev\n");
  writeFileSync(
    join(agentDir, "config.toml"),
    stringifyTOML({
      name: "dev",
      credentials: ["github_token"],
      models: ["sonnet"],
      schedule: "*/5 * * * *",
    } as Record<string, unknown>)
  );
  mkdirSync(resolve(dir, ".al", "state", "dev"), { recursive: true });
}

function setupWebhookProject(dir: string) {
  const globalConfig = {
    models: {
      sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" },
    },
    webhooks: { github: { type: "github" } },
  };
  writeFileSync(resolve(dir, "config.toml"), stringifyTOML(globalConfig as Record<string, unknown>));

  const agentDir = resolve(dir, "agents", "dev");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "SKILL.md"), "---\n---\n\n# dev\n");
  writeFileSync(
    join(agentDir, "config.toml"),
    stringifyTOML({
      name: "dev",
      credentials: ["github_token"],
      models: ["sonnet"],
      webhooks: [{ source: "github", events: ["push"] }],
    } as Record<string, unknown>)
  );
  mkdirSync(resolve(dir, ".al", "state", "dev"), { recursive: true });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("scheduler drainQueues error handling", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDrainQueues.mockResolvedValue(undefined); // default: resolve fine
    mockIsRunning = false;
    capturedOnTrigger = undefined;
    capturedAgentConfig = undefined;
    tmpDir = mkdtempSync(join(tmpdir(), "al-drain-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("initial drainQueues failure at scheduler startup", () => {
    it("logs an error when the initial drainQueues call rejects (covers scheduler/index.ts line 246)", async () => {
      setupMinimalProject(tmpDir);

      // Make the initial drainQueues call (during Phase 7 startup) reject
      mockDrainQueues.mockRejectedValueOnce(new Error("initial drain failed"));

      await startScheduler(tmpDir);

      // Flush the fire-and-forget .catch() callback
      await new Promise((r) => setTimeout(r, 100));

      // The .catch() handler should have called logger.error with the right message
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        "initial queue drain failed"
      );
    });

    it("scheduler still starts successfully even when initial drainQueues rejects", async () => {
      setupMinimalProject(tmpDir);

      mockDrainQueues.mockRejectedValueOnce(new Error("drain error"));

      // startScheduler should resolve (not throw) even if drainQueues rejects
      await expect(startScheduler(tmpDir)).resolves.not.toThrow();
    });
  });

  describe("drainQueues called after successful webhook dispatch", () => {
    it("invokes drainQueues after executeRun resolves (covers scheduler/index.ts line 119 .then callback)", async () => {
      setupWebhookProject(tmpDir);

      mockSetupWebhookRegistry.mockResolvedValue({
        registry: { bind: vi.fn(), unbind: vi.fn() },
        secrets: {},
      });

      mockIsRunning = false;
      await startScheduler(tmpDir);

      // Wait for all startup fire-and-forget promises to settle (initial drainQueues etc.)
      await new Promise((r) => setTimeout(r, 100));

      // Track drainQueues calls that happen after this point via an explicit promise
      let drainResolve: (() => void) | undefined;
      const drainCalledPromise = new Promise<void>((resolve) => {
        drainResolve = resolve;
      });
      let drainCallCount = 0;
      mockDrainQueues.mockImplementation(async () => {
        drainCallCount++;
        if (drainResolve) drainResolve();
      });

      // Reset mockRun call count
      mockRun.mockClear();

      expect(capturedOnTrigger).toBeDefined();

      const fakeWebhookContext = {
        event: "push",
        action: "created",
        source: "github",
        receiptId: "test-receipt-drain",
        payload: { ref: "refs/heads/main" },
      };

      // Trigger the webhook — this fires executeRun as fire-and-forget,
      // and the .then() callback calls drainQueues when executeRun resolves.
      capturedOnTrigger!(capturedAgentConfig, fakeWebhookContext);

      // Wait explicitly for drainQueues to be called, with a timeout
      await Promise.race([
        drainCalledPromise,
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error("drainQueues not called within 2s")), 2000)),
      ]);

      // mockRun should have been called (executeRun ran the agent)
      expect(mockRun).toHaveBeenCalledTimes(1);

      // drainQueues should have been called from the .then() callback
      expect(drainCallCount).toBeGreaterThan(0);
    });
  });
});
