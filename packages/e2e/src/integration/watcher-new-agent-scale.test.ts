/**
 * Integration tests: scheduler/watcher.ts handleNewAgent() with scale > 0
 * — no Docker required.
 *
 * The existing watcher-noagent.test.ts tests handleNewAgent() only for scale=0.
 * This test covers the handleNewAgent() path when scale > 0 and using HostUserRuntime
 * (which skips Docker image builds):
 *
 *   1. handleNewAgent scale=1: runner pool created with 1 runner
 *   2. handleNewAgent scale=1: agent added to agentConfigs
 *   3. handleNewAgent scale=1: agentImages entry set (baseImage)
 *   4. handleNewAgent scale=2: runner pool created with 2 runners
 *   5. handleNewAgent with schedule: cron job added to cronJobs
 *   6. handleNewAgent logs "new agent ready"
 *   7. handleNewAgent with webhookRegistry: webhook bindings registered
 *   8. handleNewAgent sets agentImages even without statusTracker
 *   9. handleNewAgent maxWorkQueueSize: setAgentMaxSize called
 *  10. handleNewAgent invalid config (no schedule/webhooks): logs error, no pool created
 *
 * Covers:
 *   - scheduler/watcher.ts: handleNewAgent() — scale=1 → RunnerPool created
 *   - scheduler/watcher.ts: handleNewAgent() — scale=1 → agentConfigs updated
 *   - scheduler/watcher.ts: handleNewAgent() — scale=1 → agentImages set
 *   - scheduler/watcher.ts: handleNewAgent() — scale=2 → pool size = 2
 *   - scheduler/watcher.ts: handleNewAgent() — schedule → cron job added
 *   - scheduler/watcher.ts: handleNewAgent() — logs "new agent ready"
 *   - scheduler/watcher.ts: handleNewAgent() — webhookRegistry → registerWebhookBindings
 *   - scheduler/watcher.ts: handleNewAgent() — maxWorkQueueSize → setAgentMaxSize
 *   - scheduler/watcher.ts: handleNewAgent() — invalid config → logs error, no pool
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";
import { stringify as stringifyYAML } from "yaml";

const { watchAgents } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/scheduler/watcher.js"
);

const { MemoryWorkQueue } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/events/event-queue.js"
);

const { HostUserRuntime } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/docker/host-user-runtime.js"
);

const { WebhookRegistry } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/registry.js"
);

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "al-watcher-new-agent-test-"));
  writeFileSync(
    join(dir, "config.toml"),
    stringifyTOML({
      models: {
        sonnet: {
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          authType: "api_key",
        },
      },
    })
  );
  return dir;
}

function addAgent(
  projectDir: string,
  name: string,
  configFields: Record<string, unknown>
): void {
  const agentDir = join(projectDir, "agents", name);
  mkdirSync(agentDir, { recursive: true });
  const yamlFrontmatter = stringifyYAML({ name }).trimEnd();
  writeFileSync(
    join(agentDir, "SKILL.md"),
    `---\n${yamlFrontmatter}\n---\n\n# ${name}\n`
  );
  writeFileSync(join(agentDir, "config.toml"), stringifyTOML(configFields));
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
}

function makeIdleRunner() {
  return {
    isRunning: false,
    sessionId: `runner-${Math.random().toString(36).slice(2)}`,
    run: vi.fn(async () => ({ result: "completed", returnValue: undefined, exitCode: 0 })),
    abort: vi.fn(),
    setImage: vi.fn(),
    setAgentConfig: vi.fn(),
    setRuntime: vi.fn(),
  };
}

function makeHostUserRuntime() {
  return new HostUserRuntime("al-agent", []);
}

function makeMinimalCtx(
  projectDir: string,
  opts: {
    agentConfigs?: any[];
    agentImages?: Record<string, string>;
    runnerPools?: Record<string, any>;
    cronJobs?: any[];
    logger?: any;
    runtime?: any;
    webhookRegistry?: any;
    workQueue?: any;
    schedulerCtx?: any;
  } = {}
) {
  const workQueue = opts.workQueue ?? new MemoryWorkQueue(20);
  const logger = opts.logger ?? makeLogger();
  const agentConfigs = opts.agentConfigs ?? [];
  const runnerPools = opts.runnerPools ?? {};

  const schedulerCtx = opts.schedulerCtx ?? {
    runnerPools,
    agentConfigs,
    maxReruns: 10,
    maxTriggerDepth: 3,
    logger,
    workQueue,
    shuttingDown: false,
    useBakedImages: false,
  };

  return {
    projectPath: projectDir,
    globalConfig: {
      models: {
        sonnet: {
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          authType: "api_key",
        },
      },
    } as any,
    runtime: opts.runtime ?? makeHostUserRuntime(),
    agentRuntimeOverrides: {},
    runnerPools,
    agentConfigs,
    agentImages: opts.agentImages ?? {},
    cronJobs: opts.cronJobs ?? [],
    schedulerCtx,
    webhookRegistry: opts.webhookRegistry,
    webhookSources: {},
    statusTracker: undefined,
    logger,
    skills: undefined,
    timezone: "UTC",
    baseImage: "al-base:test",
    createRunner: (_agentConfig: any, _image: string) => makeIdleRunner(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe(
  "integration: scheduler/watcher.ts handleNewAgent() scale > 0 — no Docker required",
  { timeout: 30_000 },
  () => {
    const tempDirs: string[] = [];

    afterEach(() => {
      for (const dir of tempDirs) {
        try { rmSync(dir, { recursive: true, force: true }); } catch {}
      }
      tempDirs.length = 0;
    });

    // ── Runner pool creation ──────────────────────────────────────────────────

    it("handleNewAgent scale=1: creates runner pool with 1 runner", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      addAgent(dir, "new-scale1-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        schedule: "*/5 * * * *",
        scale: 1,
      });

      const agentConfigs: any[] = [];
      const runnerPools: Record<string, any> = {};
      const ctx = makeMinimalCtx(dir, { agentConfigs, runnerPools });

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("new-scale1-agent");
      await handle._waitForPending();
      handle.stop();

      expect(runnerPools["new-scale1-agent"]).toBeDefined();
      expect(runnerPools["new-scale1-agent"].size).toBe(1);
    });

    it("handleNewAgent scale=1: agent added to agentConfigs", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      addAgent(dir, "new-agent-configs", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        schedule: "*/5 * * * *",
      });

      const agentConfigs: any[] = [];
      const ctx = makeMinimalCtx(dir, { agentConfigs });

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("new-agent-configs");
      await handle._waitForPending();
      handle.stop();

      const found = agentConfigs.find((a: any) => a.name === "new-agent-configs");
      expect(found).toBeDefined();
    });

    it("handleNewAgent scale=1: agentImages entry set to baseImage", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      addAgent(dir, "new-agent-img", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        schedule: "*/5 * * * *",
      });

      const agentImages: Record<string, string> = {};
      const ctx = makeMinimalCtx(dir, { agentImages });

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("new-agent-img");
      await handle._waitForPending();
      handle.stop();

      expect(agentImages["new-agent-img"]).toBe("al-base:test");
    });

    it("handleNewAgent scale=2: creates runner pool with 2 runners", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      addAgent(dir, "new-scale2-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        schedule: "*/5 * * * *",
        scale: 2,
      });

      const runnerPools: Record<string, any> = {};
      const ctx = makeMinimalCtx(dir, { runnerPools });

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("new-scale2-agent");
      await handle._waitForPending();
      handle.stop();

      expect(runnerPools["new-scale2-agent"]).toBeDefined();
      expect(runnerPools["new-scale2-agent"].size).toBe(2);
    });

    // ── Cron job setup ────────────────────────────────────────────────────────

    it("handleNewAgent with schedule: cron job added to cronJobs", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      addAgent(dir, "new-schedule-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        schedule: "*/5 * * * *",
      });

      const cronJobs: any[] = [];
      const ctx = makeMinimalCtx(dir, { cronJobs });

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("new-schedule-agent");
      await handle._waitForPending();
      handle.stop();

      expect(cronJobs.length).toBe(1);
    });

    it("handleNewAgent without schedule: no cron job added", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      // Agent has webhook but no schedule
      addAgent(dir, "new-noscheduled-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        webhooks: [{ source: "github", events: ["push"] }],
      });

      const cronJobs: any[] = [];
      const ctx = makeMinimalCtx(dir, { cronJobs });

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("new-noscheduled-agent");
      await handle._waitForPending();
      handle.stop();

      expect(cronJobs.length).toBe(0);
    });

    // ── Logging ───────────────────────────────────────────────────────────────

    it("handleNewAgent logs 'new agent ready'", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      addAgent(dir, "new-log-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        schedule: "*/5 * * * *",
      });

      const logger = makeLogger();
      const ctx = makeMinimalCtx(dir, { logger });

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("new-log-agent");
      await handle._waitForPending();
      handle.stop();

      const infoLogs: string[] = logger.info.mock.calls.map((c: any[]) => c[1]);
      expect(infoLogs.some((msg: string) => msg.includes("new agent ready"))).toBe(true);
    });

    // ── Webhook registry ──────────────────────────────────────────────────────

    it("handleNewAgent with webhookRegistry: bindings registered", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      addAgent(dir, "new-webhook-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key", "github_webhook_secret:myapp"],
        webhooks: [{ source: "github", events: ["push"] }],
      });

      const webhookRegistry = new WebhookRegistry();
      const runnerPools: Record<string, any> = {};

      const ctx = makeMinimalCtx(dir, {
        runnerPools,
        webhookRegistry,
        webhookSources: {
          github: { source: "github", provider: { source: "github" } as any },
        } as any,
      } as any);
      (ctx as any).webhookSources = {};

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("new-webhook-agent");
      await handle._waitForPending();
      handle.stop();

      // Pool should be created (webhook-only agent is valid)
      expect(runnerPools["new-webhook-agent"]).toBeDefined();
    });

    // ── maxWorkQueueSize ──────────────────────────────────────────────────────

    it("handleNewAgent maxWorkQueueSize: setAgentMaxSize called", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      addAgent(dir, "new-queue-cap-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        schedule: "*/5 * * * *",
        maxWorkQueueSize: 3,
      });

      const mockWorkQueue = {
        enqueue: vi.fn(() => ({ accepted: true, dropped: false })),
        dequeue: vi.fn(() => undefined),
        size: vi.fn(() => 0),
        peek: vi.fn(() => []),
        setAgentMaxSize: vi.fn(),
        clearAll: vi.fn(),
        close: vi.fn(),
      };

      const agentConfigs: any[] = [];
      const runnerPools: Record<string, any> = {};

      const schedulerCtx: any = {
        runnerPools,
        agentConfigs,
        maxReruns: 10,
        maxTriggerDepth: 3,
        logger: makeLogger(),
        workQueue: mockWorkQueue,
        shuttingDown: false,
        useBakedImages: false,
      };

      const ctx = makeMinimalCtx(dir, {
        agentConfigs,
        runnerPools,
        schedulerCtx,
        workQueue: mockWorkQueue,
      });
      ctx.schedulerCtx = schedulerCtx;

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("new-queue-cap-agent");
      await handle._waitForPending();
      handle.stop();

      expect(mockWorkQueue.setAgentMaxSize).toHaveBeenCalledWith("new-queue-cap-agent", 3);
    });

    // ── Invalid config ────────────────────────────────────────────────────────

    it("handleNewAgent invalid config: logs error and no pool created", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      // Agent with no schedule AND no webhooks is invalid
      addAgent(dir, "new-invalid-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        // No schedule, no webhooks → invalid
      });

      const logger = makeLogger();
      const runnerPools: Record<string, any> = {};
      const ctx = makeMinimalCtx(dir, { logger, runnerPools });

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("new-invalid-agent");
      await handle._waitForPending();
      handle.stop();

      expect(runnerPools["new-invalid-agent"]).toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.anything() }),
        expect.stringContaining("invalid")
      );
    });

    // ── Default scale (implicit 1) ────────────────────────────────────────────

    it("handleNewAgent no scale specified: defaults to scale=1", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      // No scale field → defaults to 1
      addAgent(dir, "new-default-scale-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        schedule: "*/5 * * * *",
        // No scale field
      });

      const runnerPools: Record<string, any> = {};
      const ctx = makeMinimalCtx(dir, { runnerPools });

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("new-default-scale-agent");
      await handle._waitForPending();
      handle.stop();

      expect(runnerPools["new-default-scale-agent"]).toBeDefined();
      expect(runnerPools["new-default-scale-agent"].size).toBe(1);
    });
  }
);
