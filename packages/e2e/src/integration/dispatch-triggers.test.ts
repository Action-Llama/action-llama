/**
 * Integration tests: execution/execution.ts dispatchTriggers() — no Docker required.
 *
 * dispatchTriggers() sends al-trigger signals to other agents. It handles
 * several early-exit cases that can be tested without running containers:
 *   - Agent tries to trigger itself → warn and skip
 *   - Trigger depth limit reached → warn and skip
 *   - Target agent not found in agentConfigs → warn and skip
 *
 * These paths only need a minimal SchedulerContext mock.
 *
 * Covers:
 *   - execution/execution.ts: dispatchTriggers() — self-trigger logs warning and skips
 *   - execution/execution.ts: dispatchTriggers() — depth-limit logs warning and skips
 *   - execution/execution.ts: dispatchTriggers() — target-not-found logs warning and skips
 *   - execution/execution.ts: dispatchTriggers() — empty triggers list is a no-op
 *   - execution/execution.ts: dispatchTriggers() — multiple triggers processed in order
 */

import { describe, it, expect, vi } from "vitest";

const {
  dispatchTriggers,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/execution.js"
);

// ── Helpers ────────────────────────────────────────────────────────────────

function makeLogger() {
  return {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };
}

function makeMinimalCtx(overrides: Record<string, any> = {}) {
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

// ── dispatchTriggers ───────────────────────────────────────────────────────

describe("integration: dispatchTriggers() (no Docker required)", { timeout: 10_000 }, () => {
  it("is a no-op for empty triggers list", () => {
    const ctx = makeMinimalCtx();
    // Should not throw
    expect(() => dispatchTriggers([], "source-agent", 0, ctx)).not.toThrow();
    expect(ctx.logger.warn).not.toHaveBeenCalled();
  });

  it("logs warning and skips when agent tries to trigger itself", () => {
    const ctx = makeMinimalCtx();
    dispatchTriggers(
      [{ agent: "self-agent", context: "some context" }],
      "self-agent", // sourceAgent same as target
      0,
      ctx
    );
    expect(ctx.logger.warn).toHaveBeenCalledTimes(1);
    const warnArgs = ctx.logger.warn.mock.calls[0];
    expect(warnArgs[1]).toMatch(/trigger itself/);
  });

  it("logs warning and skips when trigger depth limit is reached", () => {
    const ctx = makeMinimalCtx({ maxTriggerDepth: 2 });
    dispatchTriggers(
      [{ agent: "other-agent", context: "some context" }],
      "source-agent",
      2, // depth >= maxTriggerDepth (2 >= 2)
      ctx
    );
    expect(ctx.logger.warn).toHaveBeenCalledTimes(1);
    const warnArgs = ctx.logger.warn.mock.calls[0];
    expect(warnArgs[1]).toMatch(/depth limit/);
  });

  it("logs warning and skips when target agent not found in agentConfigs", () => {
    const ctx = makeMinimalCtx({
      agentConfigs: [
        { name: "existing-agent", credentials: [], models: [], scale: 1 },
      ],
    });
    dispatchTriggers(
      [{ agent: "nonexistent-agent", context: "some context" }],
      "source-agent",
      0, // within depth limit
      ctx
    );
    expect(ctx.logger.warn).toHaveBeenCalledTimes(1);
    const warnArgs = ctx.logger.warn.mock.calls[0];
    expect(warnArgs[1]).toMatch(/not found/);
  });

  it("skips self-trigger but continues processing subsequent triggers", () => {
    const ctx = makeMinimalCtx({
      agentConfigs: [
        { name: "target-agent", credentials: [], models: [], scale: 0 },
      ],
      runnerPools: {
        "target-agent": undefined, // No pool (scale=0 treated as disabled)
      },
    });
    // First trigger is self (skipped), second is depth limit (skipped), third not found
    dispatchTriggers(
      [
        { agent: "source-agent", context: "self-trigger (skipped)" },
        { agent: "other-nonexistent", context: "not-found (skipped)" },
      ],
      "source-agent",
      0,
      ctx
    );
    // Both should log warnings
    expect(ctx.logger.warn).toHaveBeenCalledTimes(2);
  });

  it("depth check: depth=1 with maxTriggerDepth=3 does NOT skip", () => {
    const ctx = makeMinimalCtx({
      maxTriggerDepth: 3,
      agentConfigs: [], // target not found (but depth check passes first)
    });
    dispatchTriggers(
      [{ agent: "any-agent", context: "test" }],
      "source-agent",
      1, // 1 < 3, within limit
      ctx
    );
    // Should NOT log depth warning, but WILL log "not found" warning
    const warnMessages = ctx.logger.warn.mock.calls.map((c: any[]) => c[1]);
    expect(warnMessages.some((m: string) => m.includes("depth limit"))).toBe(false);
    expect(warnMessages.some((m: string) => m.includes("not found"))).toBe(true);
  });

  it("depth=0 with maxTriggerDepth=0 triggers depth-limit warning", () => {
    const ctx = makeMinimalCtx({ maxTriggerDepth: 0 });
    dispatchTriggers(
      [{ agent: "other-agent", context: "test" }],
      "source-agent",
      0, // 0 >= 0, depth limit
      ctx
    );
    expect(ctx.logger.warn).toHaveBeenCalledTimes(1);
    const warnArgs = ctx.logger.warn.mock.calls[0];
    expect(warnArgs[1]).toMatch(/depth limit/);
  });
});

// ── drainQueues ────────────────────────────────────────────────────────────
// Import drainQueues separately

const { drainQueues } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/execution.js"
);

describe("integration: drainQueues() early-exit paths (no Docker required)", { timeout: 10_000 }, () => {
  it("returns early when ctx.shuttingDown is true", async () => {
    const ctx = makeMinimalCtx({ shuttingDown: true });
    // Should not throw and not call workQueue.dequeue
    await expect(drainQueues(ctx)).resolves.not.toThrow();
    expect(ctx.workQueue.size).not.toHaveBeenCalled();
  });

  it("returns early when scheduler is paused via statusTracker", async () => {
    const ctx = makeMinimalCtx({
      shuttingDown: false,
      statusTracker: { isPaused: () => true },
      agentConfigs: [{ name: "some-agent", credentials: [], models: [] }],
    });
    await expect(drainQueues(ctx)).resolves.not.toThrow();
    expect(ctx.workQueue.size).not.toHaveBeenCalled();
  });

  it("skips agent when it is disabled via isAgentEnabled", async () => {
    const ctx = makeMinimalCtx({
      shuttingDown: false,
      agentConfigs: [{ name: "disabled-agent", credentials: [], models: [] }],
      isAgentEnabled: (_name: string) => false, // All disabled
    });
    await expect(drainQueues(ctx)).resolves.not.toThrow();
    // workQueue.size should not have been called for the disabled agent
    expect(ctx.workQueue.size).not.toHaveBeenCalled();
  });

  it("skips agent when it has no runner pool", async () => {
    const ctx = makeMinimalCtx({
      shuttingDown: false,
      agentConfigs: [{ name: "no-pool-agent", credentials: [], models: [] }],
      runnerPools: {}, // No pool for this agent
      isAgentEnabled: () => true,
    });
    // workQueue.size IS called for no-pool agent to check queue size
    await expect(drainQueues(ctx)).resolves.not.toThrow();
  });

  it("skips agent when its work queue is empty", async () => {
    const ctx = makeMinimalCtx({
      shuttingDown: false,
      agentConfigs: [{ name: "empty-queue-agent", credentials: [], models: [] }],
      runnerPools: { "empty-queue-agent": { getAllAvailableRunners: () => [] } },
      workQueue: {
        size: vi.fn(() => 0), // Empty queue
        dequeue: vi.fn(() => undefined),
      } as any,
      isAgentEnabled: () => true,
    });
    await expect(drainQueues(ctx)).resolves.not.toThrow();
    expect(ctx.workQueue.size).toHaveBeenCalledWith("empty-queue-agent");
  });
});
