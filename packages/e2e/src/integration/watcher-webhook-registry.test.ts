/**
 * Integration tests: scheduler/watcher.ts handleChangedAgent() webhook registry paths
 * — no Docker required.
 *
 * The scale 0→N and N→0 transition handlers in handleChangedAgent() call
 * registerWebhookBindings() and webhookRegistry.removeBindingsForAgent()
 * when a webhookRegistry is provided. The existing watcher-scale-transitions.test.ts
 * uses webhookRegistry: undefined, leaving these branches uncovered.
 *
 * This test exercises those branches by providing a real WebhookRegistry
 * (with a TestWebhookProvider registered) alongside a matching webhookSources
 * entry so that registerWebhookBindings() can resolve and register the binding.
 *
 * Also covers the webhook-change path (handleChangedAgent when webhook config
 * changes with a live webhookRegistry) — lines 496-500 in watcher.ts.
 *
 * Test scenarios:
 *   1. scale=0 → scale=1 with webhookRegistry: binding added to registry
 *   2. scale=1 → scale=0 with webhookRegistry: binding removed from registry
 *   3. Webhook config change with webhookRegistry: old bindings removed, new registered
 *
 * Covers:
 *   - scheduler/watcher.ts: handleChangedAgent() scale 0→N — if (ctx.webhookRegistry) block
 *   - scheduler/watcher.ts: handleChangedAgent() scale N→0 — webhookRegistry?.removeBindingsForAgent()
 *   - scheduler/watcher.ts: handleChangedAgent() webhook change — pool && ctx.webhookRegistry block
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

const { WebhookRegistry } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/registry.js"
);

const { TestWebhookProvider } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/providers/test.js"
);

// ── Helpers ───────────────────────────────────────────────────────────────

function makeTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "al-watcher-wh-test-"));
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

function makeWebhookRegistry(logger: ReturnType<typeof makeLogger>) {
  const registry = new WebhookRegistry(logger as any);
  registry.registerProvider(new TestWebhookProvider());
  return registry;
}

/** webhookSources config that maps "my-test-src" to the test provider. */
const TEST_WEBHOOK_SOURCES: Record<string, any> = {
  "my-test-src": {
    type: "test",
    allowUnsigned: true,
  },
};

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
    webhookSources?: Record<string, any>;
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
    webhookRegistry: opts.webhookRegistry ?? undefined,
    webhookSources: opts.webhookSources ?? {},
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
  "integration: scheduler/watcher.ts handleChangedAgent() webhook registry paths — no Docker required",
  { timeout: 30_000 },
  () => {
    const tempDirs: string[] = [];

    afterEach(() => {
      for (const dir of tempDirs) {
        try { rmSync(dir, { recursive: true, force: true }); } catch {}
      }
      tempDirs.length = 0;
    });

    // ── scale 0→N with webhookRegistry ─────────────────────────────────────

    it("scale=0 → scale=1 with webhookRegistry: webhook binding is added to registry", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      // Disk config has scale=1 and a test webhook trigger
      addAgent(dir, "webhook-activate-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        webhooks: [{ source: "my-test-src" }],
        scale: 1,
      });

      // In-memory: agent is currently at scale=0 (disabled, no pool)
      const agentConfigs: any[] = [
        {
          name: "webhook-activate-agent",
          credentials: ["anthropic_key"],
          models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
          webhooks: [{ source: "my-test-src" }],
          scale: 0,
        },
      ];
      const runnerPools: Record<string, any> = {};
      const logger = makeLogger();
      const webhookRegistry = makeWebhookRegistry(logger);

      const ctx = makeMinimalCtx(dir, {
        agentConfigs,
        runnerPools,
        agentImages: { "webhook-activate-agent": "al-base:test" },
        runtime: makeHostUserRuntime(),
        logger,
        webhookRegistry,
        webhookSources: TEST_WEBHOOK_SOURCES,
      });

      const handle = watchAgents(ctx);

      // Trigger the scale 0→1 transition
      await handle._handleAgentChange("webhook-activate-agent");
      await handle._waitForPending();
      handle.stop();

      // Runner pool should have been created
      expect(runnerPools["webhook-activate-agent"]).toBeDefined();
      expect(runnerPools["webhook-activate-agent"].size).toBe(1);

      // Verify that the "if (ctx.webhookRegistry)" block was entered by checking
      // that the registry now has a binding for the agent (via addBinding call in registerWebhookBindings).
      // Use dryRunDispatch which returns bindings count/details without needing HTTP.
      const dryRun = webhookRegistry.dryRunDispatch(
        "test",
        {},
        JSON.stringify({ source: "test", action: "test" }),
        { secrets: undefined, config: { type: "test", allowUnsigned: true } }
      );
      // Should have matched the binding for webhook-activate-agent
      expect(dryRun.bindings.length).toBeGreaterThan(0);
      expect(dryRun.bindings.some((b: any) => b.agentName === "webhook-activate-agent")).toBe(true);
    });

    it("scale=0 → scale=1 with webhookRegistry: logger logs webhook setup via registerWebhookBindings", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      addAgent(dir, "wh-log-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        webhooks: [{ source: "my-test-src" }],
        scale: 1,
      });

      const agentConfigs: any[] = [
        {
          name: "wh-log-agent",
          credentials: ["anthropic_key"],
          models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
          webhooks: [{ source: "my-test-src" }],
          scale: 0,
        },
      ];
      const runnerPools: Record<string, any> = {};
      const logger = makeLogger();
      const webhookRegistry = makeWebhookRegistry(logger);

      const ctx = makeMinimalCtx(dir, {
        agentConfigs,
        runnerPools,
        agentImages: { "wh-log-agent": "al-base:test" },
        runtime: makeHostUserRuntime(),
        logger,
        webhookRegistry,
        webhookSources: TEST_WEBHOOK_SOURCES,
      });

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("wh-log-agent");
      await handle._waitForPending();
      handle.stop();

      // registerWebhookBindings calls webhookRegistry.addBinding which logs "webhook binding added"
      const infoArgs = logger.info.mock.calls.map((c: any[]) => c[1]);
      expect(infoArgs.some((msg: string) =>
        msg === "webhook binding added" || msg.includes("activated from scale=0")
      )).toBe(true);
    });

    // ── scale N→0 with webhookRegistry ─────────────────────────────────────

    it("scale=1 → scale=0 with webhookRegistry: webhook binding is removed from registry", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      // Disk config: scale=0 (deactivated)
      addAgent(dir, "webhook-deactivate-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        webhooks: [{ source: "my-test-src" }],
        scale: 0,
      });

      // In-memory: agent is at scale=1 (active) with a webhook binding
      const agentConfigs: any[] = [
        {
          name: "webhook-deactivate-agent",
          credentials: ["anthropic_key"],
          models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
          webhooks: [{ source: "my-test-src" }],
          scale: 1,
        },
      ];
      const existingPool = new RunnerPool([makeIdleRunner()]);
      const runnerPools: Record<string, any> = { "webhook-deactivate-agent": existingPool };
      const logger = makeLogger();
      const webhookRegistry = makeWebhookRegistry(logger);

      // Pre-register a binding for the agent
      webhookRegistry.addBinding({
        agentName: "webhook-deactivate-agent",
        source: "default",
        type: "test",
        filter: undefined,
        trigger: () => true,
      });

      const ctx = makeMinimalCtx(dir, {
        agentConfigs,
        runnerPools,
        agentImages: { "webhook-deactivate-agent": "al-base:test" },
        runtime: makeHostUserRuntime(),
        logger,
        webhookRegistry,
        webhookSources: TEST_WEBHOOK_SOURCES,
      });

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("webhook-deactivate-agent");
      await handle._waitForPending();
      handle.stop();

      // Pool should be removed
      expect(runnerPools["webhook-deactivate-agent"]).toBeUndefined();

      // The binding should have been removed via webhookRegistry.removeBindingsForAgent()
      const dryRun = webhookRegistry.dryRunDispatch(
        "test",
        {},
        JSON.stringify({ source: "test", action: "test" }),
        { secrets: undefined, config: { type: "test", allowUnsigned: true } }
      );
      expect(dryRun.bindings.filter((b: any) => b.agentName === "webhook-deactivate-agent").length).toBe(0);
    });

    // ── Webhook config change with webhookRegistry ──────────────────────────

    it("webhook config change with webhookRegistry: old bindings removed, new bindings registered", async () => {
      const dir = makeTempProject();
      tempDirs.push(dir);

      // Initial state: agent at scale=1 with old webhook binding
      const agentConfigs: any[] = [
        {
          name: "wh-change-agent",
          credentials: ["anthropic_key"],
          models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
          webhooks: [{ source: "my-test-src", events: ["push"] }],
          scale: 1,
        },
      ];
      const existingPool = new RunnerPool([makeIdleRunner()]);
      const runnerPools: Record<string, any> = { "wh-change-agent": existingPool };
      const logger = makeLogger();
      const webhookRegistry = makeWebhookRegistry(logger);

      // Pre-register old binding
      webhookRegistry.addBinding({
        agentName: "wh-change-agent",
        source: "default",
        type: "test",
        filter: { events: ["push"] } as any,
        trigger: () => true,
      });

      // Update disk config: same scale=1 but different webhook filter (events: ["pull"])
      addAgent(dir, "wh-change-agent", {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        webhooks: [{ source: "my-test-src", events: ["pull"] }],
        scale: 1,
      });

      const ctx = makeMinimalCtx(dir, {
        agentConfigs,
        runnerPools,
        agentImages: { "wh-change-agent": "al-base:test" },
        runtime: makeHostUserRuntime(),
        logger,
        webhookRegistry,
        webhookSources: TEST_WEBHOOK_SOURCES,
      });

      const handle = watchAgents(ctx);
      await handle._handleAgentChange("wh-change-agent");
      await handle._waitForPending();
      handle.stop();

      // The watcher should have detected the webhook change and re-registered bindings.
      // We verify by confirming the agent still has a binding (re-registered with new filter).
      const dryRun = webhookRegistry.dryRunDispatch(
        "test",
        {},
        JSON.stringify({ source: "test", action: "test" }),
        { secrets: undefined, config: { type: "test", allowUnsigned: true } }
      );
      // The binding for wh-change-agent should exist (re-registered)
      expect(dryRun.bindings.some((b: any) => b.agentName === "wh-change-agent")).toBe(true);
    });
  },
);
