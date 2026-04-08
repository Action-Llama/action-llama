/**
 * Integration tests: scheduler/watcher.ts handleChangedAgent() scale transition paths
 * — no Docker required.
 *
 * Two new code paths were added in commit 513c0fc3 to handle scale transitions
 * during hot-reload:
 *
 * 1. scale 0 → N transition (re-enable):
 *    When oldScale === 0 && newScale > 0, handleChangedAgent creates a new runner
 *    pool, sets up cron (if schedule), sets up webhooks (if webhookRegistry), and
 *    updates statusTracker.
 *
 * 2. scale N → 0 transition (deactivate):
 *    When oldScale > 0 && newScale === 0, handleChangedAgent kills the existing pool,
 *    rebuilds cron jobs (without the agent), removes webhook bindings, and updates
 *    statusTracker.
 *
 * Both paths use HostUserRuntime to skip Docker image building, making them
 * testable without Docker.
 *
 * Test scenarios:
 *   1. scale=0 → scale=1: runner pool created after transition
 *   2. scale=0 → scale=1: logger logs "agent activated from scale=0"
 *   3. scale=0 → scale=2: pool has 2 runners after transition
 *   4. scale=1 → scale=0: runner pool removed after transition
 *   5. scale=1 → scale=0: logger logs "agent deactivated (scale=0)"
 *   6. scale=1 → scale=0: pool.killAll() was called (runner pool removed from map)
 *   7. scale=0 → scale=1 with schedule: cron job added to cronJobs
 *
 * Covers:
 *   - scheduler/watcher.ts: handleChangedAgent() — oldScale=0 && newScale>0 → pool created
 *   - scheduler/watcher.ts: handleChangedAgent() — oldScale=0 && newScale>0 → cron added
 *   - scheduler/watcher.ts: handleChangedAgent() — oldScale>0 && newScale=0 → pool removed
 *   - scheduler/watcher.ts: handleChangedAgent() — oldScale>0 && newScale=0 → killAll called
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

const { RunnerPool } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/runner-pool.js"
);

const { HostUserRuntime } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/docker/host-user-runtime.js"
);

// ── Helpers ───────────────────────────────────────────────────────────────

function makeTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "al-watcher-scale-test-"));
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
    instanceId: `runner-${Math.random().toString(36).slice(2)}`,
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
  } = {}
) {
  const workQueue = new MemoryWorkQueue(20);
  const logger = opts.logger ?? makeLogger();
  const agentConfigs = opts.agentConfigs ?? [];
  const runnerPools = opts.runnerPools ?? {};

  const schedulerCtx: any = {
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
    webhookRegistry: undefined,
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
  "integration: scheduler/watcher.ts handleChangedAgent() scale transitions — no Docker required",
  { timeout: 30_000 },
  () => {
    const tempDirs: string[] = [];

    afterEach(() => {
      for (const dir of tempDirs) {
        try { rmSync(dir, { recursive: true, force: true }); } catch {}
      }
      tempDirs.length = 0;
    });

    // ── scale 0 → N transition ───────────────────────────────────────────

    it("scale=0 → scale=1: runner pool is created after transition", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      // Create agent with scale=0 on disk
      addAgent(dir, "reactive-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        schedule: "0 0 31 2 *",
        scale: 0,
      });

      const agentConfigs: any[] = [
        {
          name: "reactive-agent",
          credentials: ["anthropic_key"],
          models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
          schedule: "0 0 31 2 *",
          scale: 0, // previously disabled
        },
      ];
      const runnerPools: Record<string, any> = {}; // no pool for scale=0

      const ctx = makeMinimalCtx(dir, {
        agentConfigs,
        runnerPools,
        agentImages: { "reactive-agent": "al-base:test" },
        runtime: makeHostUserRuntime(),
      });

      const handle = watchAgents(ctx);

      // Update disk config to scale=1 to simulate re-enable
      const agentDir = join(dir, "agents", "reactive-agent");
      writeFileSync(
        join(agentDir, "config.toml"),
        stringifyTOML({
          models: ["sonnet"],
          credentials: ["anthropic_key"],
          schedule: "0 0 31 2 *",
          scale: 1,
        })
      );

      // Trigger handleChangedAgent
      await handle._handleAgentChange("reactive-agent");
      await handle._waitForPending();
      handle.stop();

      // scale 0→1: pool should now exist
      expect(runnerPools["reactive-agent"]).toBeDefined();
      expect(typeof runnerPools["reactive-agent"].size).toBe("number");
      expect(runnerPools["reactive-agent"].size).toBe(1);
    });

    it("scale=0 → scale=1: logger logs 'activated from scale=0'", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      addAgent(dir, "activate-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        schedule: "0 0 31 2 *",
        scale: 1,
      });

      const agentConfigs: any[] = [
        {
          name: "activate-agent",
          credentials: ["anthropic_key"],
          models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
          schedule: "0 0 31 2 *",
          scale: 0, // was disabled
        },
      ];
      const runnerPools: Record<string, any> = {};
      const logger = makeLogger();

      const ctx = makeMinimalCtx(dir, {
        agentConfigs,
        runnerPools,
        agentImages: { "activate-agent": "al-base:test" },
        runtime: makeHostUserRuntime(),
        logger,
      });

      const handle = watchAgents(ctx);

      await handle._handleAgentChange("activate-agent");
      await handle._waitForPending();
      handle.stop();

      // Should log activation
      const infoLogs: string[] = logger.info.mock.calls.map((c: any[]) => c[1]);
      expect(infoLogs.some((msg: string) => msg.includes("activated from scale=0"))).toBe(true);
    });

    it("scale=0 → scale=2: pool has 2 runners after transition", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      addAgent(dir, "scale2-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        schedule: "0 0 31 2 *",
        scale: 2,
      });

      const agentConfigs: any[] = [
        {
          name: "scale2-agent",
          credentials: ["anthropic_key"],
          models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
          schedule: "0 0 31 2 *",
          scale: 0, // was disabled
        },
      ];
      const runnerPools: Record<string, any> = {};

      const ctx = makeMinimalCtx(dir, {
        agentConfigs,
        runnerPools,
        agentImages: { "scale2-agent": "al-base:test" },
        runtime: makeHostUserRuntime(),
      });

      const handle = watchAgents(ctx);

      await handle._handleAgentChange("scale2-agent");
      await handle._waitForPending();
      handle.stop();

      // Should have created 2 runners
      const pool = runnerPools["scale2-agent"];
      expect(pool).toBeDefined();
      expect(pool.size).toBe(2);
    });

    it("scale=0 → scale=1 with schedule: cron job is added to cronJobs", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      addAgent(dir, "cron-activate-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        schedule: "*/5 * * * *", // every 5 min — valid cron
        scale: 1,
      });

      const agentConfigs: any[] = [
        {
          name: "cron-activate-agent",
          credentials: ["anthropic_key"],
          models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
          schedule: "*/5 * * * *",
          scale: 0, // was disabled
        },
      ];
      const runnerPools: Record<string, any> = {};
      const cronJobs: any[] = [];

      const ctx = makeMinimalCtx(dir, {
        agentConfigs,
        runnerPools,
        agentImages: { "cron-activate-agent": "al-base:test" },
        runtime: makeHostUserRuntime(),
        cronJobs,
      });

      const handle = watchAgents(ctx);

      await handle._handleAgentChange("cron-activate-agent");
      await handle._waitForPending();
      handle.stop();

      // A cron job should have been added for the schedule
      expect(cronJobs.length).toBeGreaterThan(0);
    });

    // ── scale N → 0 transition ───────────────────────────────────────────

    it("scale=1 → scale=0: runner pool is removed after transition", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      addAgent(dir, "deactivate-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        schedule: "0 0 31 2 *",
        scale: 0,
      });

      const existingPool = new RunnerPool([makeIdleRunner()]);
      const agentConfigs: any[] = [
        {
          name: "deactivate-agent",
          credentials: ["anthropic_key"],
          models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
          schedule: "0 0 31 2 *",
          scale: 1, // was enabled
        },
      ];
      const runnerPools: Record<string, any> = { "deactivate-agent": existingPool };

      const ctx = makeMinimalCtx(dir, {
        agentConfigs,
        runnerPools,
        agentImages: { "deactivate-agent": "al-base:test" },
        runtime: makeHostUserRuntime(),
      });

      const handle = watchAgents(ctx);

      await handle._handleAgentChange("deactivate-agent");
      await handle._waitForPending();
      handle.stop();

      // Pool should be removed from the map
      expect(runnerPools["deactivate-agent"]).toBeUndefined();
    });

    it("scale=1 → scale=0: logger logs 'deactivated (scale=0)'", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      addAgent(dir, "log-deactivate-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        schedule: "0 0 31 2 *",
        scale: 0,
      });

      const existingPool = new RunnerPool([makeIdleRunner()]);
      const agentConfigs: any[] = [
        {
          name: "log-deactivate-agent",
          credentials: ["anthropic_key"],
          models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
          schedule: "0 0 31 2 *",
          scale: 1,
        },
      ];
      const runnerPools: Record<string, any> = { "log-deactivate-agent": existingPool };
      const logger = makeLogger();

      const ctx = makeMinimalCtx(dir, {
        agentConfigs,
        runnerPools,
        agentImages: { "log-deactivate-agent": "al-base:test" },
        runtime: makeHostUserRuntime(),
        logger,
      });

      const handle = watchAgents(ctx);

      await handle._handleAgentChange("log-deactivate-agent");
      await handle._waitForPending();
      handle.stop();

      // Should log deactivation
      const infoLogs: string[] = logger.info.mock.calls.map((c: any[]) => c[1]);
      expect(infoLogs.some((msg: string) => msg.includes("deactivated (scale=0)"))).toBe(true);
    });

    it("scale=2 → scale=0: pool removed even when starting with scale > 1", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      addAgent(dir, "scale2-deactivate-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        schedule: "0 0 31 2 *",
        scale: 0,
      });

      const existingPool = new RunnerPool([makeIdleRunner(), makeIdleRunner()]);
      const agentConfigs: any[] = [
        {
          name: "scale2-deactivate-agent",
          credentials: ["anthropic_key"],
          models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
          schedule: "0 0 31 2 *",
          scale: 2,
        },
      ];
      const runnerPools: Record<string, any> = { "scale2-deactivate-agent": existingPool };

      const ctx = makeMinimalCtx(dir, {
        agentConfigs,
        runnerPools,
        agentImages: { "scale2-deactivate-agent": "al-base:test" },
        runtime: makeHostUserRuntime(),
      });

      const handle = watchAgents(ctx);

      await handle._handleAgentChange("scale2-deactivate-agent");
      await handle._waitForPending();
      handle.stop();

      // Pool should be removed from the map regardless of old size
      expect(runnerPools["scale2-deactivate-agent"]).toBeUndefined();
    });
  },
);
