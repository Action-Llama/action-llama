/**
 * Integration tests: scheduler/watcher.ts handleRemovedAgent() additional paths
 * — no Docker required.
 *
 * The existing watcher-noagent.test.ts tests handleRemovedAgent() for the basic
 * case (removes from agentConfigs, kills pool). This test covers additional paths
 * in handleRemovedAgent() that aren't tested yet:
 *
 *   1. handleRemovedAgent with schedule: rebuildCronJobs called (stops old cron job)
 *   2. handleRemovedAgent with webhookRegistry: removeBindingsForAgent called
 *   3. handleRemovedAgent logs "agent teardown complete"
 *   4. handleRemovedAgent cleans up agentImages entry
 *   5. handleRemovedAgent with no pool (already removed) is a no-op for pool
 *
 * Covers:
 *   - scheduler/watcher.ts: handleRemovedAgent() — agentConfig.schedule → rebuildCronJobs
 *   - scheduler/watcher.ts: handleRemovedAgent() — webhookRegistry?.removeBindingsForAgent()
 *   - scheduler/watcher.ts: handleRemovedAgent() — logs "agent teardown complete"
 *   - scheduler/watcher.ts: handleRemovedAgent() — delete ctx.agentImages[agentName]
 *   - scheduler/watcher.ts: handleRemovedAgent() — no pool → no killAll call
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
  const dir = mkdtempSync(join(tmpdir(), "al-watcher-removed-test-"));
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
  // Create agents/ dir so watchAgents() can set up the watcher
  mkdirSync(join(dir, "agents"), { recursive: true });
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
  "integration: scheduler/watcher.ts handleRemovedAgent() additional paths — no Docker required",
  { timeout: 30_000 },
  () => {
    const tempDirs: string[] = [];

    afterEach(() => {
      for (const dir of tempDirs) {
        try { rmSync(dir, { recursive: true, force: true }); } catch {}
      }
      tempDirs.length = 0;
    });

    // ── Schedule cleanup via rebuildCronJobs ──────────────────────────────────

    it("handleRemovedAgent with schedule: stops old cron job (rebuildCronJobs called)", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      // Do NOT create the agent dir (simulates deletion)
      // But give it a schedule in agentConfigs

      const existingConfig = {
        name: "sched-gone-agent",
        credentials: [],
        models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
        schedule: "*/5 * * * *",  // has schedule
        scale: 1,
      };

      const agentConfigs: any[] = [existingConfig];
      const pool = new RunnerPool([makeIdleRunner()]);
      const runnerPools: Record<string, any> = { "sched-gone-agent": pool };

      // Pretend there's an existing mock cron job for this agent
      const mockCronJob = { stop: vi.fn(), nextRun: vi.fn(() => null) };
      const cronJobs: any[] = [mockCronJob];

      const ctx = makeMinimalCtx(dir, { agentConfigs, runnerPools, cronJobs });
      const handle = watchAgents(ctx);

      // Call handleRemovedAgent (agent dir does not exist → removal)
      await handle._handleAgentChange("sched-gone-agent");
      await handle._waitForPending();
      handle.stop();

      // rebuildCronJobs should have stopped the old cron job
      expect(mockCronJob.stop).toHaveBeenCalled();
      // cronJobs should now be empty (no other agents with schedules)
      expect(cronJobs.length).toBe(0);
    });

    it("handleRemovedAgent with schedule: logs 'agent teardown complete'", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      const existingConfig = {
        name: "log-gone-agent",
        credentials: [],
        models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
        schedule: "*/5 * * * *",
        scale: 1,
      };

      const agentConfigs: any[] = [existingConfig];
      const pool = new RunnerPool([makeIdleRunner()]);
      const runnerPools: Record<string, any> = { "log-gone-agent": pool };
      const logger = makeLogger();
      const cronJobs: any[] = [];

      const ctx = makeMinimalCtx(dir, { agentConfigs, runnerPools, cronJobs, logger });
      const handle = watchAgents(ctx);

      await handle._handleAgentChange("log-gone-agent");
      await handle._waitForPending();
      handle.stop();

      const infoLogs: string[] = logger.info.mock.calls.map((c: any[]) => c[1]);
      expect(infoLogs.some((msg: string) => msg.includes("agent teardown complete"))).toBe(true);
    });

    // ── Webhook registry cleanup ──────────────────────────────────────────────

    it("handleRemovedAgent with webhookRegistry: removeBindingsForAgent called", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      const existingConfig = {
        name: "webhook-gone-agent",
        credentials: [],
        models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
        webhooks: [{ source: "github", events: ["push"] }],
        scale: 1,
      };

      const agentConfigs: any[] = [existingConfig];
      const pool = new RunnerPool([makeIdleRunner()]);
      const runnerPools: Record<string, any> = { "webhook-gone-agent": pool };

      // Mock webhookRegistry
      const mockWebhookRegistry = {
        removeBindingsForAgent: vi.fn(),
        registerBinding: vi.fn(),
        dispatch: vi.fn(),
        dryRunDispatch: vi.fn(),
      };

      const ctx = makeMinimalCtx(dir, {
        agentConfigs,
        runnerPools,
        webhookRegistry: mockWebhookRegistry,
      });

      const handle = watchAgents(ctx);

      // Call handleRemovedAgent (agent dir does not exist → removal)
      await handle._handleAgentChange("webhook-gone-agent");
      await handle._waitForPending();
      handle.stop();

      // removeBindingsForAgent should have been called with the agent name
      expect(mockWebhookRegistry.removeBindingsForAgent).toHaveBeenCalledWith("webhook-gone-agent");
    });

    // ── agentImages cleanup ───────────────────────────────────────────────────

    it("handleRemovedAgent: removes agentImages entry", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      const existingConfig = {
        name: "img-gone-agent",
        credentials: [],
        models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
        schedule: "*/5 * * * *",
        scale: 1,
      };

      const agentConfigs: any[] = [existingConfig];
      const pool = new RunnerPool([makeIdleRunner()]);
      const runnerPools: Record<string, any> = { "img-gone-agent": pool };
      const agentImages: Record<string, string> = { "img-gone-agent": "al-base:test" };

      const ctx = makeMinimalCtx(dir, { agentConfigs, runnerPools, agentImages });
      const handle = watchAgents(ctx);

      await handle._handleAgentChange("img-gone-agent");
      await handle._waitForPending();
      handle.stop();

      // agentImages entry should be cleaned up
      expect(agentImages["img-gone-agent"]).toBeUndefined();
    });

    // ── No pool (already removed) ─────────────────────────────────────────────

    it("handleRemovedAgent with no pool: does not throw", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      const existingConfig = {
        name: "nopool-gone-agent",
        credentials: [],
        models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
        scale: 1,
        webhooks: [{ source: "github", events: ["push"] }],
      };

      const agentConfigs: any[] = [existingConfig];
      const runnerPools: Record<string, any> = {}; // no pool
      const logger = makeLogger();

      const ctx = makeMinimalCtx(dir, { agentConfigs, runnerPools, logger });
      const handle = watchAgents(ctx);

      // Should not throw even though there's no pool
      await expect(
        handle._handleAgentChange("nopool-gone-agent")
      ).resolves.toBeUndefined();

      await handle._waitForPending();
      handle.stop();

      // Agent should still be removed from agentConfigs
      const updatedConfigs: any[] = ctx.schedulerCtx.agentConfigs;
      const found = updatedConfigs.find((a: any) => a.name === "nopool-gone-agent");
      expect(found).toBeUndefined();
    });

    // ── No webhookRegistry (undefined) ───────────────────────────────────────

    it("handleRemovedAgent without webhookRegistry: no-op for webhook cleanup", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      const existingConfig = {
        name: "noregistry-gone-agent",
        credentials: [],
        models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
        webhooks: [{ source: "github", events: ["push"] }],
        scale: 1,
      };

      const agentConfigs: any[] = [existingConfig];
      const pool = new RunnerPool([makeIdleRunner()]);
      const runnerPools: Record<string, any> = { "noregistry-gone-agent": pool };

      const ctx = makeMinimalCtx(dir, {
        agentConfigs,
        runnerPools,
        webhookRegistry: undefined, // no registry
      });

      const handle = watchAgents(ctx);

      // Should not throw when webhookRegistry is undefined
      await expect(
        handle._handleAgentChange("noregistry-gone-agent")
      ).resolves.toBeUndefined();

      await handle._waitForPending();
      handle.stop();

      expect(runnerPools["noregistry-gone-agent"]).toBeUndefined();
    });
  }
);
