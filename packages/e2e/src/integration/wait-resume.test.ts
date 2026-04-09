/**
 * Integration tests: wait/resume — webhook dispatch resolves waiting instances.
 *
 * Tests the critical integration path: when a webhook arrives, the dispatch
 * logic checks the WaitingRegistry first. If a matching suspended instance
 * exists, it is resolved (resumed) instead of dispatching a new run.
 *
 * Also tests: agent-trigger matching, timeout expiration, FIFO ordering,
 * and filter specificity.
 *
 * No Docker required — tests the WaitingRegistry + dispatch integration directly.
 *
 * Covers:
 *   - execution/waiting-registry.ts: matchWebhook() resolves waiting instance
 *   - execution/waiting-registry.ts: matchAgentTrigger() resolves waiting instance
 *   - execution/waiting-registry.ts: timeout expires → reject
 *   - execution/waiting-registry.ts: non-matching webhook does not resolve
 *   - execution/waiting-registry.ts: FIFO ordering across multiple waiters
 *   - execution/execution.ts: dispatchTriggers() checks waitingRegistry before normal dispatch
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distRoot = resolve(__dirname, "../../../action-llama/dist");

const { WaitingRegistry } = await import(
  /* @vite-ignore */
  `${distRoot}/execution/waiting-registry.js`
);

const { dispatchTriggers } = await import(
  /* @vite-ignore */
  `${distRoot}/execution/execution.js`
);

// ── Helpers ────────────────────────────────────────────────────────────────

function makeWaitingEntry(overrides: Record<string, any> = {}) {
  return {
    instanceId: `inst-${Math.random().toString(36).slice(2, 8)}`,
    agentName: "test-agent",
    filter: { type: "webhook" as const },
    deadline: Date.now() + 60_000,
    registeredAt: Date.now(),
    runId: "container-123",
    runtimeType: "container",
    cwd: "/tmp/work",
    ...overrides,
  };
}

function makeWebhookContext(overrides: Record<string, any> = {}) {
  return {
    source: "test",
    event: "deploy",
    action: "created",
    repo: "acme/app",
    sender: "tester",
    title: "Deploy v1.0",
    rawPayload: {},
    headers: {},
    ...overrides,
  };
}

function makeLogger() {
  return {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };
}

function makeSchedulerCtx(overrides: Record<string, any> = {}) {
  const logger = makeLogger();
  return {
    logger,
    maxTriggerDepth: 3,
    agentConfigs: [] as any[],
    runnerPools: {} as any,
    workQueue: { enqueue: vi.fn(() => ({ accepted: true })), size: vi.fn(() => 0) } as any,
    maxReruns: 10,
    shuttingDown: false,
    useBakedImages: false,
    statsStore: undefined,
    isPaused: () => false,
    isAgentEnabled: (_name: string) => true,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("integration: wait/resume — webhook resolves waiting instance (no Docker)", { timeout: 15_000 }, () => {
  const timers: ReturnType<typeof setTimeout>[] = [];

  afterEach(() => {
    for (const t of timers) clearTimeout(t);
    timers.length = 0;
  });

  it("webhook matches and resolves a waiting instance", async () => {
    const registry = new WaitingRegistry();
    const resolved = new Promise<any>((resolve, reject) => {
      const entry = makeWaitingEntry({
        agentName: "deploy-agent",
        filter: { type: "webhook", source: "test", event: "deploy" },
        resolve,
        reject,
      });
      registry.register(entry);
      if (entry.timeoutTimer) timers.push(entry.timeoutTimer);
    });

    // Simulate webhook dispatch — same path as scheduler/index.ts onTrigger
    const context = makeWebhookContext({ source: "test", event: "deploy" });
    const match = registry.matchWebhook("deploy-agent", context);

    expect(match).not.toBeNull();
    expect(match!.agentName).toBe("deploy-agent");

    // Resolve the promise (as the scheduler would)
    match!.resolve?.(context);
    const payload = await resolved;
    expect(payload.event).toBe("deploy");
    expect(payload.repo).toBe("acme/app");

    // Registry should be empty after match
    expect(registry.count()).toBe(0);
  });

  it("non-matching webhook does not resolve waiting instance", () => {
    const registry = new WaitingRegistry();
    const reject = vi.fn();
    const entry = makeWaitingEntry({
      agentName: "deploy-agent",
      filter: { type: "webhook", source: "test", event: "deploy" },
      reject,
    });
    registry.register(entry);
    if (entry.timeoutTimer) timers.push(entry.timeoutTimer);

    // Wrong event
    const context = makeWebhookContext({ source: "test", event: "push" });
    const match = registry.matchWebhook("deploy-agent", context);

    expect(match).toBeNull();
    expect(registry.count()).toBe(1);
  });

  it("webhook for wrong agent does not resolve", () => {
    const registry = new WaitingRegistry();
    const entry = makeWaitingEntry({
      agentName: "deploy-agent",
      filter: { type: "webhook", source: "test" },
    });
    registry.register(entry);
    if (entry.timeoutTimer) timers.push(entry.timeoutTimer);

    const context = makeWebhookContext({ source: "test", event: "deploy" });
    const match = registry.matchWebhook("other-agent", context);

    expect(match).toBeNull();
    expect(registry.count()).toBe(1);
  });

  it("broad filter (no source/event) matches any webhook for that agent", () => {
    const registry = new WaitingRegistry();
    const entry = makeWaitingEntry({
      agentName: "catch-all",
      filter: { type: "webhook" }, // no source or event filter
    });
    registry.register(entry);
    if (entry.timeoutTimer) timers.push(entry.timeoutTimer);

    const context = makeWebhookContext({ source: "github", event: "issues" });
    const match = registry.matchWebhook("catch-all", context);

    expect(match).not.toBeNull();
    expect(match!.agentName).toBe("catch-all");
    expect(registry.count()).toBe(0);
  });

  it("dot-path match filter works on webhook context", () => {
    const registry = new WaitingRegistry();
    const entry = makeWaitingEntry({
      agentName: "pr-agent",
      filter: {
        type: "webhook",
        source: "test",
        event: "pull_request",
        match: { action: "closed", repo: "acme/app" },
      },
    });
    registry.register(entry);
    if (entry.timeoutTimer) timers.push(entry.timeoutTimer);

    // Non-matching action
    const ctx1 = makeWebhookContext({ source: "test", event: "pull_request", action: "opened", repo: "acme/app" });
    expect(registry.matchWebhook("pr-agent", ctx1)).toBeNull();

    // Matching
    const ctx2 = makeWebhookContext({ source: "test", event: "pull_request", action: "closed", repo: "acme/app" });
    const match = registry.matchWebhook("pr-agent", ctx2);
    expect(match).not.toBeNull();
    expect(registry.count()).toBe(0);
  });

  it("FIFO ordering — first registered instance is matched first", () => {
    const registry = new WaitingRegistry();
    const entry1 = makeWaitingEntry({
      instanceId: "first",
      agentName: "agent",
      filter: { type: "webhook", event: "deploy" },
      registeredAt: Date.now() - 1000,
    });
    const entry2 = makeWaitingEntry({
      instanceId: "second",
      agentName: "agent",
      filter: { type: "webhook", event: "deploy" },
      registeredAt: Date.now(),
    });
    registry.register(entry1);
    registry.register(entry2);
    if (entry1.timeoutTimer) timers.push(entry1.timeoutTimer);
    if (entry2.timeoutTimer) timers.push(entry2.timeoutTimer);

    const context = makeWebhookContext({ event: "deploy" });
    const match = registry.matchWebhook("agent", context);

    expect(match!.instanceId).toBe("first");
    expect(registry.count()).toBe(1);

    // Second webhook matches the remaining instance
    const match2 = registry.matchWebhook("agent", context);
    expect(match2!.instanceId).toBe("second");
    expect(registry.count()).toBe(0);
  });

  it("timeout rejects the waiting instance", async () => {
    const registry = new WaitingRegistry();
    const waitPromise = new Promise<any>((resolve, reject) => {
      const entry = makeWaitingEntry({
        agentName: "timeout-agent",
        filter: { type: "webhook" },
        deadline: Date.now() + 100, // 100ms timeout
        resolve,
        reject,
      });
      registry.register(entry);
    });

    await expect(waitPromise).rejects.toThrow("Wait timeout expired");
    expect(registry.count()).toBe(0);
  });

  it("agent-trigger matches and resolves a waiting instance", async () => {
    const registry = new WaitingRegistry();
    const resolved = new Promise<any>((resolve, reject) => {
      const entry = makeWaitingEntry({
        agentName: "target-agent",
        filter: { type: "agent-trigger", sourceAgent: "deployer" },
        resolve,
        reject,
      });
      registry.register(entry);
      if (entry.timeoutTimer) timers.push(entry.timeoutTimer);
    });

    const match = registry.matchAgentTrigger("target-agent", "deployer");
    expect(match).not.toBeNull();

    match!.resolve?.({ type: "agent-trigger", sourceAgent: "deployer", context: "deploy complete" });
    const payload = await resolved;
    expect(payload.sourceAgent).toBe("deployer");
  });

  it("agent-trigger from wrong source does not match", () => {
    const registry = new WaitingRegistry();
    const entry = makeWaitingEntry({
      agentName: "target-agent",
      filter: { type: "agent-trigger", sourceAgent: "deployer" },
    });
    registry.register(entry);
    if (entry.timeoutTimer) timers.push(entry.timeoutTimer);

    const match = registry.matchAgentTrigger("target-agent", "other-agent");
    expect(match).toBeNull();
    expect(registry.count()).toBe(1);
  });
});

// ── dispatchTriggers + waitingRegistry integration ────────────────────────

describe("integration: dispatchTriggers() with waitingRegistry (no Docker)", { timeout: 10_000 }, () => {
  it("resolves waiting instance instead of normal dispatch", () => {
    const registry = new WaitingRegistry();
    const resolveFn = vi.fn();
    const entry = makeWaitingEntry({
      agentName: "target-agent",
      filter: { type: "agent-trigger" }, // matches any source
      resolve: resolveFn,
    });
    registry.register(entry);

    const ctx = makeSchedulerCtx({
      agentConfigs: [{ name: "target-agent", credentials: [], models: [], scale: 1 }],
      runnerPools: { "target-agent": { getAllAvailableRunners: () => [], hasRunningJobs: false } },
      waitingRegistry: registry,
    });

    dispatchTriggers(
      [{ agent: "target-agent", context: "work to do" }],
      "source-agent",
      0,
      ctx,
    );

    // The waiting instance should have been resolved
    expect(resolveFn).toHaveBeenCalledTimes(1);
    const payload = resolveFn.mock.calls[0][0];
    expect(payload.type).toBe("agent-trigger");
    expect(payload.sourceAgent).toBe("source-agent");
    expect(registry.count()).toBe(0);
  });

  it("falls through to normal dispatch when no waiting instance matches", () => {
    const registry = new WaitingRegistry();
    // No waiting instances registered

    const ctx = makeSchedulerCtx({
      agentConfigs: [{ name: "target-agent", credentials: [], models: [], scale: 1 }],
      runnerPools: {
        "target-agent": {
          getAllAvailableRunners: () => [],
          getAvailableRunner: () => null,
          hasRunningJobs: false,
        },
      },
      waitingRegistry: registry,
      workQueue: {
        enqueue: vi.fn(() => ({ accepted: true })),
        size: vi.fn(() => 0),
      } as any,
    });

    dispatchTriggers(
      [{ agent: "target-agent", context: "work to do" }],
      "source-agent",
      0,
      ctx,
    );

    // Should have fallen through to enqueue since no runners available
    expect(ctx.workQueue.enqueue).toHaveBeenCalled();
  });
});
