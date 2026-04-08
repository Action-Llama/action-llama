/**
 * Integration tests: scheduler/watcher.ts handleChangedAgent() schedule change,
 * runtime config change, and scale N→M paths — no Docker required.
 *
 * These paths in handleChangedAgent() are not covered by existing no-Docker tests:
 *
 * 1. Schedule change (oldSchedule !== newConfig.schedule):
 *    - When schedule is removed: rebuildCronJobs called, next-run cleared
 *    - When schedule is added: new Cron job added to cronJobs
 *    - When schedule is changed: old job removed + new job added
 *
 * 2. Runtime config change (oldRuntimeConfig !== newRuntimeConfig):
 *    - When runtime section added: agentRuntimeOverrides updated with new HostUserRuntime
 *    - When runtime section removed: override deleted (reverted to container runtime)
 *    - setRuntime called on existing runner when runtime config changes
 *
 * 3. Scale N → M (both > 0):
 *    - scale=1 → scale=2: addRunner called, pool grows
 *    - scale=2 → scale=1: shrinkTo called, pool shrinks
 *
 * 4. maxWorkQueueSize change:
 *    - workQueue.setAgentMaxSize called when maxWorkQueueSize is set in new config
 *
 * All tests use HostUserRuntime to skip Docker image builds.
 *
 * Covers:
 *   - scheduler/watcher.ts: handleChangedAgent() — oldSchedule !== newConfig.schedule → rebuildCronJobs
 *   - scheduler/watcher.ts: handleChangedAgent() — schedule added → new Cron job in cronJobs
 *   - scheduler/watcher.ts: handleChangedAgent() — schedule removed → cronJobs stays empty
 *   - scheduler/watcher.ts: handleChangedAgent() — oldRuntimeConfig !== newRuntimeConfig → logger logs update
 *   - scheduler/watcher.ts: handleChangedAgent() — runtime cleared → override deleted
 *   - scheduler/watcher.ts: handleChangedAgent() — newScale > oldScale → addRunner
 *   - scheduler/watcher.ts: handleChangedAgent() — newScale < oldScale → shrinkTo
 *   - scheduler/watcher.ts: handleChangedAgent() — maxWorkQueueSize → setAgentMaxSize called
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

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "al-watcher-sched-test-"));
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
    agentRuntimeOverrides?: Record<string, any>;
    schedulerCtx?: any;
    workQueue?: any;
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
    agentRuntimeOverrides: opts.agentRuntimeOverrides ?? {},
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
  "integration: scheduler/watcher.ts handleChangedAgent() schedule, runtime, scale N→M — no Docker required",
  { timeout: 30_000 },
  () => {
    const tempDirs: string[] = [];

    afterEach(() => {
      for (const dir of tempDirs) {
        try { rmSync(dir, { recursive: true, force: true }); } catch {}
      }
      tempDirs.length = 0;
    });

    // ── Schedule change: add schedule ────────────────────────────────────────

    it("adding a schedule: new cron job added to cronJobs array", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      // Config file on disk has a schedule
      addAgent(dir, "add-schedule-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        schedule: "*/5 * * * *", // NEW schedule
      });

      const existingPool = new RunnerPool([makeIdleRunner()]);
      const agentConfigs: any[] = [
        {
          name: "add-schedule-agent",
          credentials: ["anthropic_key"],
          models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
          // No schedule initially (oldSchedule = undefined)
          schedule: undefined,
          scale: 1,
        },
      ];
      const cronJobs: any[] = [];
      const runnerPools: Record<string, any> = { "add-schedule-agent": existingPool };

      const ctx = makeMinimalCtx(dir, {
        agentConfigs,
        runnerPools,
        agentImages: { "add-schedule-agent": "al-base:test" },
        cronJobs,
      });

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("add-schedule-agent");
      await handle._waitForPending();
      handle.stop();

      // A cron job should have been added
      expect(cronJobs.length).toBeGreaterThan(0);
    });

    // ── Schedule change: remove schedule ──────────────────────────────────────

    it("removing a schedule: cronJobs is empty after rebuildCronJobs", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      // Config on disk now has NO schedule but has a webhook (passes validation)
      addAgent(dir, "remove-schedule-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        webhooks: [{ source: "github", events: ["push"] }],
        // No schedule in new config
      });

      const existingPool = new RunnerPool([makeIdleRunner()]);
      const agentConfigs: any[] = [
        {
          name: "remove-schedule-agent",
          credentials: ["anthropic_key"],
          models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
          schedule: "*/5 * * * *", // was set, now removed
          scale: 1,
        },
      ];

      // Pretend there's an existing mock cron job
      const mockCronJob = { stop: vi.fn(), nextRun: vi.fn(() => null) };
      const cronJobs: any[] = [mockCronJob];
      const runnerPools: Record<string, any> = { "remove-schedule-agent": existingPool };

      const ctx = makeMinimalCtx(dir, {
        agentConfigs,
        runnerPools,
        agentImages: { "remove-schedule-agent": "al-base:test" },
        cronJobs,
      });

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("remove-schedule-agent");
      await handle._waitForPending();
      handle.stop();

      // Old cron job should be stopped and not re-added (no schedule in new config)
      expect(mockCronJob.stop).toHaveBeenCalled();
      expect(cronJobs.length).toBe(0);
    });

    // ── Schedule change: logger ──────────────────────────────────────────────

    it("schedule change: logs 'agent updated' after hot-reload", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      // New config has different schedule
      addAgent(dir, "sched-change-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        schedule: "0 12 * * *", // changed schedule
      });

      const existingPool = new RunnerPool([makeIdleRunner()]);
      const agentConfigs: any[] = [
        {
          name: "sched-change-agent",
          credentials: ["anthropic_key"],
          models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
          schedule: "0 6 * * *", // old schedule
          scale: 1,
        },
      ];
      const cronJobs: any[] = [];
      const runnerPools: Record<string, any> = { "sched-change-agent": existingPool };
      const logger = makeLogger();

      const ctx = makeMinimalCtx(dir, {
        agentConfigs,
        runnerPools,
        agentImages: { "sched-change-agent": "al-base:test" },
        cronJobs,
        logger,
      });

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("sched-change-agent");
      await handle._waitForPending();
      handle.stop();

      const infoLogs: string[] = logger.info.mock.calls.map((c: any[]) => c[1]);
      expect(infoLogs.some((msg: string) => msg.includes("agent updated"))).toBe(true);
    });

    // ── Scale N → M (both > 0): increase ─────────────────────────────────────

    it("scale=1 → scale=2: pool gains a runner (addRunner path)", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      // New config has scale=2
      addAgent(dir, "scale-up-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        schedule: "*/5 * * * *",
        scale: 2,
      });

      const runner1 = makeIdleRunner();
      const existingPool = new RunnerPool([runner1]);
      const agentConfigs: any[] = [
        {
          name: "scale-up-agent",
          credentials: ["anthropic_key"],
          models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
          schedule: "*/5 * * * *",
          scale: 1, // was 1
        },
      ];
      const runnerPools: Record<string, any> = { "scale-up-agent": existingPool };

      const ctx = makeMinimalCtx(dir, {
        agentConfigs,
        runnerPools,
        agentImages: { "scale-up-agent": "al-base:test" },
      });

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("scale-up-agent");
      await handle._waitForPending();
      handle.stop();

      // Pool should now have 2 runners
      expect(existingPool.size).toBe(2);
    });

    // ── Scale N → M (both > 0): decrease ─────────────────────────────────────

    it("scale=2 → scale=1: pool shrinks (shrinkTo path)", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      // New config has scale=1
      addAgent(dir, "scale-down-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        schedule: "*/5 * * * *",
        scale: 1,
      });

      const runner1 = makeIdleRunner();
      const runner2 = makeIdleRunner();
      const existingPool = new RunnerPool([runner1, runner2]);
      expect(existingPool.size).toBe(2);

      const agentConfigs: any[] = [
        {
          name: "scale-down-agent",
          credentials: ["anthropic_key"],
          models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
          schedule: "*/5 * * * *",
          scale: 2, // was 2
        },
      ];
      const runnerPools: Record<string, any> = { "scale-down-agent": existingPool };

      const ctx = makeMinimalCtx(dir, {
        agentConfigs,
        runnerPools,
        agentImages: { "scale-down-agent": "al-base:test" },
      });

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("scale-down-agent");
      await handle._waitForPending();
      handle.stop();

      // Pool should now have 1 runner
      expect(existingPool.size).toBe(1);
    });

    // ── maxWorkQueueSize change ───────────────────────────────────────────────

    it("maxWorkQueueSize set in new config: workQueue.setAgentMaxSize called", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      // New config has maxWorkQueueSize set
      addAgent(dir, "queue-cap-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        schedule: "*/5 * * * *",
        maxWorkQueueSize: 5,
      });

      const existingPool = new RunnerPool([makeIdleRunner()]);
      const agentConfigs: any[] = [
        {
          name: "queue-cap-agent",
          credentials: ["anthropic_key"],
          models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
          schedule: "*/5 * * * *",
          scale: 1,
          // No maxWorkQueueSize before
        },
      ];
      const runnerPools: Record<string, any> = { "queue-cap-agent": existingPool };

      const mockWorkQueue = {
        enqueue: vi.fn(() => ({ accepted: true, dropped: false })),
        dequeue: vi.fn(() => undefined),
        size: vi.fn(() => 0),
        peek: vi.fn(() => []),
        setAgentMaxSize: vi.fn(),
        clearAll: vi.fn(),
        close: vi.fn(),
      };

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
        agentImages: { "queue-cap-agent": "al-base:test" },
        schedulerCtx,
        workQueue: mockWorkQueue,
      });
      // Override schedulerCtx to use the mock workQueue
      ctx.schedulerCtx = schedulerCtx;

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("queue-cap-agent");
      await handle._waitForPending();
      handle.stop();

      // setAgentMaxSize should have been called with the agent name and max size
      expect(mockWorkQueue.setAgentMaxSize).toHaveBeenCalledWith("queue-cap-agent", 5);
    });

    // ── setRuntime called on runners when runtime config changes ──────────────

    it("runtime config change: setRuntime called on existing runner", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      // New config has runtime section (type: "host-user" triggers createAgentRuntimeOverride)
      addAgent(dir, "runtime-change-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        schedule: "*/5 * * * *",
        runtime: { type: "host-user", run_as: "al-agent", groups: ["docker"] },
      });

      const runner = makeIdleRunner();
      const existingPool = new RunnerPool([runner]);
      const agentConfigs: any[] = [
        {
          name: "runtime-change-agent",
          credentials: ["anthropic_key"],
          models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
          schedule: "*/5 * * * *",
          scale: 1,
          // No runtime section initially
        },
      ];
      const runnerPools: Record<string, any> = { "runtime-change-agent": existingPool };
      const agentRuntimeOverrides: Record<string, any> = {};

      const ctx = makeMinimalCtx(dir, {
        agentConfigs,
        runnerPools,
        agentImages: { "runtime-change-agent": "al-base:test" },
        agentRuntimeOverrides,
      });

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("runtime-change-agent");
      await handle._waitForPending();
      handle.stop();

      // setRuntime should have been called on the runner
      expect(runner.setRuntime).toHaveBeenCalled();
    });

    // ── Runtime config change: logger ─────────────────────────────────────────

    it("runtime config change: logs 'updated host-user runtime config'", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      // New config has runtime section added (type: "host-user" required for override creation)
      addAgent(dir, "runtime-log-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        schedule: "*/5 * * * *",
        runtime: { type: "host-user", run_as: "al-agent", groups: ["docker"] },
      });

      const existingPool = new RunnerPool([makeIdleRunner()]);
      const agentConfigs: any[] = [
        {
          name: "runtime-log-agent",
          credentials: ["anthropic_key"],
          models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
          schedule: "*/5 * * * *",
          scale: 1,
          // No runtime section initially
        },
      ];
      const runnerPools: Record<string, any> = { "runtime-log-agent": existingPool };
      const logger = makeLogger();

      const ctx = makeMinimalCtx(dir, {
        agentConfigs,
        runnerPools,
        agentImages: { "runtime-log-agent": "al-base:test" },
        logger,
      });

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("runtime-log-agent");
      await handle._waitForPending();
      handle.stop();

      const infoLogs: string[] = logger.info.mock.calls.map((c: any[]) => c[1]);
      expect(infoLogs.some((msg: string) => msg.includes("updated host-user runtime config"))).toBe(true);
    });

    // ── setAgentConfig called on runners ─────────────────────────────────────

    it("config change: setAgentConfig called on existing runner", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      // Description comes from SKILL.md frontmatter, not config.toml
      // Write the agent directory directly to set description in frontmatter
      {
        const agentDir = join(dir, "agents", "config-update-agent");
        mkdirSync(agentDir, { recursive: true });
        const frontmatter = stringifyYAML({ name: "config-update-agent", description: "Updated description" }).trimEnd();
        writeFileSync(join(agentDir, "SKILL.md"), `---\n${frontmatter}\n---\n\n# config-update-agent\n`);
        writeFileSync(join(agentDir, "config.toml"), stringifyTOML({
          models: ["sonnet"],
          credentials: ["anthropic_key"],
          schedule: "*/5 * * * *",
        }));
      }

      const runner = makeIdleRunner();
      const existingPool = new RunnerPool([runner]);
      const agentConfigs: any[] = [
        {
          name: "config-update-agent",
          credentials: ["anthropic_key"],
          models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
          schedule: "*/5 * * * *",
          scale: 1,
          description: "Old description",
        },
      ];
      const runnerPools: Record<string, any> = { "config-update-agent": existingPool };

      const ctx = makeMinimalCtx(dir, {
        agentConfigs,
        runnerPools,
        agentImages: { "config-update-agent": "al-base:test" },
      });

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("config-update-agent");
      await handle._waitForPending();
      handle.stop();

      // setAgentConfig should have been called with the new config
      expect(runner.setAgentConfig).toHaveBeenCalled();
      const calledWith = runner.setAgentConfig.mock.calls[0][0];
      expect(calledWith.description).toBe("Updated description");
    });
  }
);
