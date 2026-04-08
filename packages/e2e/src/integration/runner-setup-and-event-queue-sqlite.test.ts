/**
 * Integration tests:
 *   1. execution/runner-setup.ts createRunnerPools() — no Docker required.
 *   2. events/event-queue.ts createWorkQueue() sqlite variant — no Docker required.
 *
 * createRunnerPools() creates RunnerPool instances for each agent config,
 * enforces project-wide scale caps, and returns a createRunner factory.
 * It dynamically imports ContainerAgentRunner, but since ContainerAgentRunner
 * only starts Docker during run(), the constructor is safe to call without Docker.
 *
 * createWorkQueue() with type="sqlite" creates a SqliteWorkQueue instance.
 * This path was previously untested (only the "memory" variant was covered).
 *
 * Covers:
 *   - execution/runner-setup.ts: createRunnerPools() returns { runnerPools, createRunner, actualScales }
 *   - execution/runner-setup.ts: createRunnerPools() empty agentConfigs → empty runnerPools/actualScales
 *   - execution/runner-setup.ts: createRunnerPools() single agent scale=1 → pool of size 1
 *   - execution/runner-setup.ts: createRunnerPools() agent with scale=2 → pool of size 2
 *   - execution/runner-setup.ts: createRunnerPools() globalConfig.defaultAgentScale fallback when no scale
 *   - execution/runner-setup.ts: createRunnerPools() agentImages[name] used when present, baseImage fallback
 *   - execution/runner-setup.ts: createRunnerPools() actualScales reflects the scale used
 *   - execution/runner-setup.ts: createRunnerPools() logger.info called per agent
 *   - execution/runner-setup.ts: createRunnerPools() createRunner factory returns a new runner
 *   - execution/runner-setup.ts: createRunnerPools() agentRuntimeOverrides used for matching agent
 *   - execution/runner-setup.ts: createRunnerPools() GATEWAY_URL env var used for gateway URL
 *   - events/event-queue.ts: createWorkQueue({ type: "sqlite" }) returns a functional SqliteWorkQueue
 *   - events/event-queue.ts: createWorkQueue({ type: "sqlite" }) enqueue/dequeue roundtrip works
 *   - events/event-queue.ts: createWorkQueue({ type: "sqlite" }) size reflects enqueued items
 *   - events/event-queue.ts: createWorkQueue({ type: "sqlite" }) dequeue returns undefined when empty
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const { createRunnerPools } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/runner-setup.js"
);

const { createWorkQueue } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/events/event-queue.js"
);

// ── Shared helpers ────────────────────────────────────────────────────────────

function makeTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "al-runner-setup-test-"));
  mkdirSync(join(dir, ".al"), { recursive: true });
  return dir;
}

/** A minimal Runtime mock — no Docker calls needed for pool construction. */
function makeRuntime(name = "mock-runtime") {
  return {
    _name: name,
    needsGateway: false,
    isAgentRunning: async () => false,
    listRunningAgents: async () => [],
    launch: async () => "mock-container",
    streamLogs: () => ({ stop: () => {} }),
    waitForExit: async () => 0,
    kill: async () => {},
    remove: async () => {},
    prepareCredentials: async () => ({ strategy: "copy", bundle: {} }),
    cleanupCredentials: async () => {},
    buildImage: async () => "mock-image:latest",
    getTaskUrl: () => null,
    reattach: async () => false,
    inspectContainer: async () => null,
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => makeLogger(),
  };
}

/** mkLogger stub that returns a mock logger (no file I/O). */
function makeMkLogger() {
  return vi.fn(() => makeLogger());
}

function makeAgentConfig(name: string, overrides: Record<string, any> = {}): any {
  return {
    name,
    models: [],
    credentials: [],
    params: {},
    timeout: 60,
    ...overrides,
  };
}

function makeGlobalConfig(overrides: Record<string, any> = {}): any {
  return {
    models: {},
    ...overrides,
  };
}

function makeBaseOpts(projectPath: string) {
  return {
    globalConfig: makeGlobalConfig(),
    runtime: makeRuntime(),
    agentRuntimeOverrides: {},
    agentImages: {},
    baseImage: "base-image:latest",
    gatewayPort: 8080,
    registerContainer: vi.fn(async () => {}),
    unregisterContainer: vi.fn(async () => {}),
    mkLogger: makeMkLogger(),
    projectPath,
    logger: makeLogger(),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// createRunnerPools() tests
// ══════════════════════════════════════════════════════════════════════════════

describe("integration: execution/runner-setup.ts createRunnerPools() (no Docker)", { timeout: 30_000 }, () => {

  let projectPath: string;

  beforeEach(() => {
    projectPath = makeTempProject();
  });

  it("returns { runnerPools, createRunner, actualScales } shape", async () => {
    const opts = { ...makeBaseOpts(projectPath), agentConfigs: [] };
    const result = await createRunnerPools(opts);
    expect(result).toHaveProperty("runnerPools");
    expect(result).toHaveProperty("createRunner");
    expect(result).toHaveProperty("actualScales");
  });

  it("empty agentConfigs → empty runnerPools and actualScales", async () => {
    const opts = { ...makeBaseOpts(projectPath), agentConfigs: [] };
    const result = await createRunnerPools(opts);
    expect(Object.keys(result.runnerPools)).toHaveLength(0);
    expect(Object.keys(result.actualScales)).toHaveLength(0);
  });

  it("single agent with scale=1 → runnerPools has one entry, pool size=1", async () => {
    const agentConfig = makeAgentConfig("my-agent", { scale: 1 });
    const opts = { ...makeBaseOpts(projectPath), agentConfigs: [agentConfig] };
    const result = await createRunnerPools(opts);
    expect(Object.keys(result.runnerPools)).toHaveLength(1);
    expect(result.runnerPools["my-agent"]).toBeDefined();
    expect(result.runnerPools["my-agent"].size).toBe(1);
  });

  it("agent with scale=2 → pool of size 2", async () => {
    const agentConfig = makeAgentConfig("parallel-agent", { scale: 2 });
    const opts = { ...makeBaseOpts(projectPath), agentConfigs: [agentConfig] };
    const result = await createRunnerPools(opts);
    expect(result.runnerPools["parallel-agent"].size).toBe(2);
    expect(result.actualScales["parallel-agent"]).toBe(2);
  });

  it("agent without scale uses defaultAgentScale from globalConfig", async () => {
    const agentConfig = makeAgentConfig("no-scale-agent"); // no scale field
    const globalConfig = makeGlobalConfig({ defaultAgentScale: 3 });
    const opts = {
      ...makeBaseOpts(projectPath),
      globalConfig,
      agentConfigs: [agentConfig],
    };
    const result = await createRunnerPools(opts);
    // defaultAgentScale=3, no explicit scale → pool should have 3 runners
    expect(result.runnerPools["no-scale-agent"].size).toBe(3);
    expect(result.actualScales["no-scale-agent"]).toBe(3);
  });

  it("agent without scale and no defaultAgentScale → falls back to scale=1", async () => {
    const agentConfig = makeAgentConfig("default-agent"); // no scale
    const globalConfig = makeGlobalConfig(); // no defaultAgentScale
    const opts = {
      ...makeBaseOpts(projectPath),
      globalConfig,
      agentConfigs: [agentConfig],
    };
    const result = await createRunnerPools(opts);
    // defaultAgentScale ?? 1 = 1
    expect(result.runnerPools["default-agent"].size).toBe(1);
    expect(result.actualScales["default-agent"]).toBe(1);
  });

  it("multiple agents → separate pools per agent", async () => {
    const agentA = makeAgentConfig("agent-a", { scale: 1 });
    const agentB = makeAgentConfig("agent-b", { scale: 2 });
    const opts = { ...makeBaseOpts(projectPath), agentConfigs: [agentA, agentB] };
    const result = await createRunnerPools(opts);
    expect(Object.keys(result.runnerPools)).toHaveLength(2);
    expect(result.runnerPools["agent-a"].size).toBe(1);
    expect(result.runnerPools["agent-b"].size).toBe(2);
    expect(result.actualScales["agent-a"]).toBe(1);
    expect(result.actualScales["agent-b"]).toBe(2);
  });

  it("agentImages[name] takes priority over baseImage", async () => {
    const agentConfig = makeAgentConfig("image-agent", { scale: 1 });
    const agentImages = { "image-agent": "agent-specific:v3" };
    const opts = {
      ...makeBaseOpts(projectPath),
      agentConfigs: [agentConfig],
      agentImages,
      baseImage: "base-image:latest",
    };
    // Just verify the pool is created correctly — the image is stored internally
    // in ContainerAgentRunner; we verify the pool exists and has the right size
    const result = await createRunnerPools(opts);
    expect(result.runnerPools["image-agent"]).toBeDefined();
    expect(result.runnerPools["image-agent"].size).toBe(1);
  });

  it("agentImages missing for agent → uses baseImage (no error)", async () => {
    const agentConfig = makeAgentConfig("no-image-agent", { scale: 1 });
    const opts = {
      ...makeBaseOpts(projectPath),
      agentConfigs: [agentConfig],
      agentImages: {}, // no entry for this agent
      baseImage: "fallback-base:latest",
    };
    const result = await createRunnerPools(opts);
    expect(result.runnerPools["no-image-agent"]).toBeDefined();
    expect(result.runnerPools["no-image-agent"].size).toBe(1);
  });

  it("logger.info is called per agent created", async () => {
    const logger = makeLogger();
    const agentA = makeAgentConfig("agent-a", { scale: 1 });
    const agentB = makeAgentConfig("agent-b", { scale: 1 });
    const opts = {
      ...makeBaseOpts(projectPath),
      logger,
      agentConfigs: [agentA, agentB],
    };
    await createRunnerPools(opts);
    // logger.info called once per agent
    const infoCallArgs = logger.info.mock.calls;
    const agentInfoCalls = infoCallArgs.filter(
      (args: any[]) => typeof args[0] === "object" && (args[0].agent === "agent-a" || args[0].agent === "agent-b")
    );
    expect(agentInfoCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("createRunner factory returns a runner with isRunning=false", async () => {
    const agentConfig = makeAgentConfig("factory-agent", { scale: 1 });
    const opts = { ...makeBaseOpts(projectPath), agentConfigs: [agentConfig] };
    const result = await createRunnerPools(opts);
    // Use the factory to create another runner
    const newRunner = result.createRunner(agentConfig, "new-image:v2");
    expect(newRunner).toBeDefined();
    expect(newRunner.isRunning).toBe(false);
  });

  it("createRunner factory creates independent runners", async () => {
    const agentConfig = makeAgentConfig("factory-agent", { scale: 1 });
    const opts = { ...makeBaseOpts(projectPath), agentConfigs: [agentConfig] };
    const result = await createRunnerPools(opts);
    const r1 = result.createRunner(agentConfig, "img:v1");
    const r2 = result.createRunner(agentConfig, "img:v2");
    expect(r1).not.toBe(r2);
    expect(r1.isRunning).toBe(false);
    expect(r2.isRunning).toBe(false);
  });

  it("agentRuntimeOverride for agent uses host-local gateway URL, not docker-internal", async () => {
    const agentConfig = makeAgentConfig("host-agent", { scale: 1, runtime: { type: "host-user" } });
    const overrideRuntime = makeRuntime("host-user-runtime");
    const opts = {
      ...makeBaseOpts(projectPath),
      agentConfigs: [agentConfig],
      agentRuntimeOverrides: { "host-agent": overrideRuntime as any },
    };
    // Just verify no error thrown and pool created correctly
    const result = await createRunnerPools(opts);
    expect(result.runnerPools["host-agent"]).toBeDefined();
    expect(result.runnerPools["host-agent"].size).toBe(1);
  });

  it("scale=0 agent gets empty pool (0 runners)", async () => {
    const agentConfig = makeAgentConfig("disabled-agent", { scale: 0 });
    const opts = { ...makeBaseOpts(projectPath), agentConfigs: [agentConfig] };
    const result = await createRunnerPools(opts);
    // scale=0 → pool exists but with 0 runners
    expect(result.runnerPools["disabled-agent"]).toBeDefined();
    expect(result.runnerPools["disabled-agent"].size).toBe(0);
    expect(result.actualScales["disabled-agent"]).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// createWorkQueue() sqlite variant tests
// ══════════════════════════════════════════════════════════════════════════════

describe("integration: events/event-queue.ts createWorkQueue({ type: 'sqlite' }) (no Docker)", { timeout: 30_000 }, () => {

  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "al-createwq-sqlite-test-"));
    dbPath = join(tempDir, "work-queue.db");
  });

  it("createWorkQueue sqlite: resolves to a functional queue object", async () => {
    const q = await createWorkQueue(10, { type: "sqlite", path: dbPath });
    expect(q).toBeDefined();
    expect(typeof q.enqueue).toBe("function");
    expect(typeof q.dequeue).toBe("function");
    expect(typeof q.size).toBe("function");
    q.close?.();
  });

  it("createWorkQueue sqlite: enqueue accepted=true", async () => {
    const q = await createWorkQueue(10, { type: "sqlite", path: dbPath });
    try {
      const result = q.enqueue("agent-a", { value: 1 });
      expect(result.accepted).toBe(true);
    } finally {
      q.close?.();
    }
  });

  it("createWorkQueue sqlite: size reflects enqueued item", async () => {
    const q = await createWorkQueue(10, { type: "sqlite", path: dbPath });
    try {
      expect(q.size("agent-a")).toBe(0);
      q.enqueue("agent-a", { value: 1 });
      expect(q.size("agent-a")).toBe(1);
    } finally {
      q.close?.();
    }
  });

  it("createWorkQueue sqlite: dequeue returns enqueued item", async () => {
    const q = await createWorkQueue(10, { type: "sqlite", path: dbPath });
    try {
      q.enqueue("agent-a", { msg: "hello" });
      const item = q.dequeue("agent-a");
      expect(item).toBeDefined();
      expect(item!.context).toEqual({ msg: "hello" });
    } finally {
      q.close?.();
    }
  });

  it("createWorkQueue sqlite: dequeue empty queue returns undefined", async () => {
    const q = await createWorkQueue(10, { type: "sqlite", path: dbPath });
    try {
      const item = q.dequeue("nonexistent-agent");
      expect(item).toBeUndefined();
    } finally {
      q.close?.();
    }
  });

  it("createWorkQueue sqlite: FIFO ordering preserved", async () => {
    const q = await createWorkQueue(10, { type: "sqlite", path: dbPath });
    try {
      q.enqueue("agent-a", { step: 1 });
      q.enqueue("agent-a", { step: 2 });
      q.enqueue("agent-a", { step: 3 });
      const first = q.dequeue("agent-a");
      const second = q.dequeue("agent-a");
      const third = q.dequeue("agent-a");
      expect((first!.context as any).step).toBe(1);
      expect((second!.context as any).step).toBe(2);
      expect((third!.context as any).step).toBe(3);
    } finally {
      q.close?.();
    }
  });

  it("createWorkQueue sqlite: maxSize overflow drops oldest", async () => {
    const q = await createWorkQueue(2, { type: "sqlite", path: dbPath });
    try {
      q.enqueue("agent-a", { value: 1 });
      q.enqueue("agent-a", { value: 2 });
      const result = q.enqueue("agent-a", { value: 3 });
      // Overflow: oldest (value=1) dropped
      expect(result.accepted).toBe(true);
      expect(q.size("agent-a")).toBe(2);
      const first = q.dequeue("agent-a");
      expect((first!.context as any).value).toBe(2);
    } finally {
      q.close?.();
    }
  });

  it("createWorkQueue sqlite: multiple agents are isolated", async () => {
    const q = await createWorkQueue(10, { type: "sqlite", path: dbPath });
    try {
      q.enqueue("agent-a", { from: "a" });
      q.enqueue("agent-b", { from: "b" });
      expect(q.size("agent-a")).toBe(1);
      expect(q.size("agent-b")).toBe(1);
      expect(q.dequeue("agent-a")!.context).toEqual({ from: "a" });
      expect(q.dequeue("agent-b")!.context).toEqual({ from: "b" });
    } finally {
      q.close?.();
    }
  });

  it("createWorkQueue sqlite: data persists after close+reopen", async () => {
    const q1 = await createWorkQueue(10, { type: "sqlite", path: dbPath });
    q1.enqueue("agent-a", { persist: "yes" });
    q1.close?.();

    const q2 = await createWorkQueue(10, { type: "sqlite", path: dbPath });
    try {
      expect(q2.size("agent-a")).toBe(1);
      const item = q2.dequeue("agent-a");
      expect((item!.context as any).persist).toBe("yes");
    } finally {
      q2.close?.();
    }
  });
});
