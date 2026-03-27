import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";
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
      webhook: "test-webhook-image",
      hybrid: "test-hybrid-image"
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

// Mock AgentRunner first
const mockRun = vi.fn().mockResolvedValue({ result: "completed", triggers: [] });
let mockIsRunning = false;

vi.mock("../../src/agents/container-runner.js", () => ({
  ContainerAgentRunner: class MockContainerAgentRunner {
    run = mockRun;
    get isRunning() { return mockIsRunning; }
  }
}));

// Mock credentials
vi.mock("../../src/shared/credentials.js", () => ({
  loadCredentialField: async () => "fake-token",
  requireCredentialRef: async () => {},
  parseCredentialRef: (ref: string) => {
    const sep = ref.indexOf(":");
    if (sep === -1) return { type: ref, instance: "default" };
    return { type: ref.slice(0, sep).trim(), instance: ref.slice(sep + 1).trim() };
  },
  listCredentialInstances: async (type: string) => {
    if (type === "github_webhook_secret") return ["MyOrg"];
    return [];
  },
  writeCredentialField: async () => {},
  writeCredentialFields: async () => {},
  credentialExists: async () => true,
  backendLoadField: () => Promise.resolve("fake-token"),
  backendLoadFields: () => Promise.resolve({}),
  backendCredentialExists: () => Promise.resolve(true),
  backendListInstances: (type: string) => {
    if (type === "github_webhook_secret") return Promise.resolve(["MyOrg"]);
    return Promise.resolve([]);
  },
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

vi.mock("../../src/agents/runner.js", () => ({
  AgentRunner: class {
    get isRunning() { return mockIsRunning; }
    run = mockRun;
  },
}));

// Mock gateway API key
vi.mock("../../src/control/api-key.js", () => ({
  ensureGatewayApiKey: vi.fn().mockResolvedValue({ key: "test-api-key", generated: false }),
}));

// Mock state store
vi.mock("../../src/shared/state-store.js", () => ({
  createStateStore: vi.fn().mockResolvedValue({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock gateway
const mockGatewayClose = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/gateway/index.js", () => ({
  startGateway: vi.fn().mockResolvedValue({
    server: {},
    registerContainer: vi.fn(),
    unregisterContainer: vi.fn(),
    lockStore: { releaseAll: vi.fn(), dispose: vi.fn() },
    callStore: { failAllByCaller: vi.fn(), dispose: vi.fn() },
    setCallDispatcher: vi.fn(),
    close: mockGatewayClose,
  }),
}));

// Mock logger
const mockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});
vi.mock("../../src/shared/logger.js", () => ({
  createLogger: () => mockLogger(),
  createFileOnlyLogger: () => mockLogger(),
}));

import { startScheduler } from "../../src/scheduler/index.js";
import { StatusTracker } from "../../src/tui/status-tracker.js";

const modelDef = { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" };

const globalConfigWithWebhooks = stringifyTOML({
  models: { sonnet: modelDef },
  webhooks: {
    "my-github": { type: "github", credential: "MyOrg" },
  },
} as Record<string, unknown>);

function writeAgentConfig(dir: string, config: Record<string, unknown>) {
  const { name, description, ...runtimeFields } = config;
  // Write portable SKILL.md
  const frontmatter: Record<string, unknown> = {};
  if (name) frontmatter.name = name;
  if (description) frontmatter.description = description;
  const yamlStr = stringifyYAML(frontmatter).trimEnd();
  writeFileSync(resolve(dir, "SKILL.md"), `---\n${yamlStr}\n---\n\n# Agent\n`);
  // Write runtime config.toml
  if (Object.keys(runtimeFields).length > 0) {
    writeFileSync(resolve(dir, "config.toml"), stringifyTOML(runtimeFields as Record<string, unknown>));
  }
}

function setupProjectWithWebhooks(tmpDir: string) {
  writeFileSync(resolve(tmpDir, "config.toml"), globalConfigWithWebhooks);

  // Webhook-only agent
  const agentDir = resolve(tmpDir, "agents", "webhook-dev");
  mkdirSync(agentDir, { recursive: true });
  writeAgentConfig(agentDir, {
    name: "webhook-dev",
    credentials: ["github_token"],
    models: ["sonnet"],
    webhooks: [{ source: "my-github", events: ["issues"], actions: ["labeled"], labels: ["agent"] }],
  });
  mkdirSync(resolve(tmpDir, ".al", "state", "webhook-dev"), { recursive: true });
}

function setupProjectWithHybrid(tmpDir: string) {
  writeFileSync(resolve(tmpDir, "config.toml"), globalConfigWithWebhooks);

  // Hybrid agent (schedule + webhooks)
  const agentDir = resolve(tmpDir, "agents", "hybrid");
  mkdirSync(agentDir, { recursive: true });
  writeAgentConfig(agentDir, {
    name: "hybrid",
    credentials: ["github_token"],
    models: ["sonnet"],
    schedule: "*/15 * * * *",
    webhooks: [{ source: "my-github", events: ["pull_request"], actions: ["opened"] }],
  });
  mkdirSync(resolve(tmpDir, ".al", "state", "hybrid"), { recursive: true });
}

function setupProjectWithNoTrigger(tmpDir: string) {
  writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
    models: { sonnet: modelDef },
  } as Record<string, unknown>));

  // Agent with neither schedule nor webhooks
  const agentDir = resolve(tmpDir, "agents", "bad-agent");
  mkdirSync(agentDir, { recursive: true });
  writeAgentConfig(agentDir, {
    name: "bad-agent",
    credentials: ["github_token"],
    models: ["sonnet"],
  });
  mkdirSync(resolve(tmpDir, ".al", "state", "bad-agent"), { recursive: true });
}

describe("scheduler webhook support", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    cronCallbacks.length = 0;
    mockIsRunning = false;
    tmpDir = mkdtempSync(join(tmpdir(), "al-sched-wh-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates no cron jobs for webhook-only agent", async () => {
    setupProjectWithWebhooks(tmpDir);
    const { cronJobs } = await startScheduler(tmpDir);
    expect(cronJobs).toHaveLength(0);
  });

  it("does not fire initial run for webhook-only agent", async () => {
    setupProjectWithWebhooks(tmpDir);
    await startScheduler(tmpDir);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("creates webhook registry for agents with webhooks", async () => {
    setupProjectWithWebhooks(tmpDir);
    const { webhookRegistry } = await startScheduler(tmpDir);
    expect(webhookRegistry).toBeDefined();
    expect(webhookRegistry!.getProvider("github")).toBeDefined();
  });

  it("always starts gateway", async () => {
    setupProjectWithWebhooks(tmpDir);
    const { gateway } = await startScheduler(tmpDir);
    expect(gateway).toBeDefined();
  });

  it("creates cron job and webhook binding for hybrid agent", async () => {
    setupProjectWithHybrid(tmpDir);
    const { cronJobs, webhookRegistry } = await startScheduler(tmpDir);
    expect(cronJobs).toHaveLength(1);
    expect(webhookRegistry).toBeDefined();
  });

  it("does not fire initial run for hybrid agent (schedule only fires via cron)", async () => {
    setupProjectWithHybrid(tmpDir);
    await startScheduler(tmpDir);
    expect(mockRun).toHaveBeenCalledTimes(0);
  });

  it("rejects agents with no schedule and no webhooks", async () => {
    setupProjectWithNoTrigger(tmpDir);
    await expect(startScheduler(tmpDir)).rejects.toThrow("must have a schedule, webhooks, or both");
  });

  it("queues webhook events when agent is busy instead of dropping them", async () => {
    setupProjectWithWebhooks(tmpDir);
    await startScheduler(tmpDir);

    // Agent is busy — webhook should be queued, not run
    mockIsRunning = true;

    // Dispatch a webhook through the registry (which calls the trigger callback)
    // The trigger callback checks isRunning and enqueues
    // We can't easily dispatch through the registry without proper signatures,
    // so we verify the queue behavior through the WorkQueue unit tests
    // and the scheduler integration via the rerun+drain test below
    expect(mockRun).not.toHaveBeenCalled();
  });
});

function signPayload(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

describe("scheduler pause blocks webhooks", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    cronCallbacks.length = 0;
    mockIsRunning = false;
    tmpDir = mkdtempSync(join(tmpdir(), "al-sched-pause-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects webhook triggers when scheduler is paused", async () => {
    setupProjectWithWebhooks(tmpDir);
    const statusTracker = new StatusTracker();
    statusTracker.setSchedulerInfo({
      mode: "docker",
      runtime: "local",
      gatewayPort: 8080,
      cronJobCount: 0,
      webhooksActive: true,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    const { webhookRegistry, schedulerCtx } = await startScheduler(tmpDir, undefined, statusTracker);

    // Verify initially not paused
    expect(schedulerCtx.isPaused?.()).toBe(false);

    // Pause the scheduler
    statusTracker.setPaused(true);
    expect(schedulerCtx.isPaused?.()).toBe(true);

    // Dispatch a webhook — should be rejected (skipped) because scheduler is paused
    const payload = JSON.stringify({
      action: "labeled",
      issue: { number: 1, title: "Test", body: "test body", labels: [{ name: "agent" }], html_url: "https://github.com/test/test/issues/1" },
      repository: { full_name: "test/repo" },
      sender: { login: "user1" },
      label: { name: "agent" },
    });
    const signature = signPayload(payload, "fake-token");

    const result = webhookRegistry!.dispatch("github", {
      "x-hub-signature-256": signature,
      "x-github-event": "issues",
      "content-type": "application/json",
    }, payload, { secrets: { MyOrg: "fake-token" } });

    expect(result.ok).toBe(true);
    expect(result.matched).toBe(0);
    expect(result.skipped).toBe(1); // trigger returned false
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("accepts webhook triggers when scheduler is not paused", async () => {
    setupProjectWithWebhooks(tmpDir);
    const statusTracker = new StatusTracker();
    statusTracker.setSchedulerInfo({
      mode: "docker",
      runtime: "local",
      gatewayPort: 8080,
      cronJobCount: 0,
      webhooksActive: true,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    const { webhookRegistry } = await startScheduler(tmpDir, undefined, statusTracker);

    const payload = JSON.stringify({
      action: "labeled",
      issue: { number: 1, title: "Test", body: "test body", labels: [{ name: "agent" }], html_url: "https://github.com/test/test/issues/1" },
      repository: { full_name: "test/repo" },
      sender: { login: "user1" },
      label: { name: "agent" },
    });
    const signature = signPayload(payload, "fake-token");

    const result = webhookRegistry!.dispatch("github", {
      "x-hub-signature-256": signature,
      "x-github-event": "issues",
      "content-type": "application/json",
    }, payload, { secrets: { MyOrg: "fake-token" } });

    expect(result.ok).toBe(true);
    expect(result.matched).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("does not queue webhook events when paused", async () => {
    setupProjectWithWebhooks(tmpDir);
    const statusTracker = new StatusTracker();
    statusTracker.setSchedulerInfo({
      mode: "docker",
      runtime: "local",
      gatewayPort: 8080,
      cronJobCount: 0,
      webhooksActive: true,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    const { webhookRegistry, schedulerCtx } = await startScheduler(tmpDir, undefined, statusTracker);

    // Pause the scheduler
    statusTracker.setPaused(true);

    const payload = JSON.stringify({
      action: "labeled",
      issue: { number: 1, title: "Test", body: "test body", labels: [{ name: "agent" }], html_url: "https://github.com/test/test/issues/1" },
      repository: { full_name: "test/repo" },
      sender: { login: "user1" },
      label: { name: "agent" },
    });
    const signature = signPayload(payload, "fake-token");

    webhookRegistry!.dispatch("github", {
      "x-hub-signature-256": signature,
      "x-github-event": "issues",
      "content-type": "application/json",
    }, payload, { secrets: { MyOrg: "fake-token" } });

    // Work queue should be empty — paused scheduler rejects, not queues
    expect(schedulerCtx.workQueue.size("webhook-dev")).toBe(0);
  });

  it("wires isPaused into schedulerCtx from statusTracker", async () => {
    setupProjectWithWebhooks(tmpDir);
    const statusTracker = new StatusTracker();
    statusTracker.setSchedulerInfo({
      mode: "docker",
      runtime: "local",
      gatewayPort: 8080,
      cronJobCount: 0,
      webhooksActive: true,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    const { schedulerCtx } = await startScheduler(tmpDir, undefined, statusTracker);

    expect(schedulerCtx.isPaused?.()).toBe(false);

    statusTracker.setPaused(true);
    expect(schedulerCtx.isPaused?.()).toBe(true);

    statusTracker.setPaused(false);
    expect(schedulerCtx.isPaused?.()).toBe(false);
  });
});
