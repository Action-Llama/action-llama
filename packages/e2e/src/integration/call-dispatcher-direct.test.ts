/**
 * Integration tests: execution/call-dispatcher.ts wireCallDispatcher() — no Docker required.
 *
 * wireCallDispatcher() installs a call dispatcher on the gateway that handles
 * incoming al-subagent calls. It validates the call entry before delegating to
 * dispatchOrQueue(). All validation branches can be exercised without Docker by
 * constructing minimal mocks for GatewayServer, SchedulerContext, and StatusTracker.
 *
 * Test scenarios:
 *   1. Scheduler paused → { ok: false, reason: "scheduler is paused" }
 *   2. Self-call (caller === target) → { ok: false, reason: "agent cannot call itself" }
 *   3. Depth limit reached (depth >= maxTriggerDepth) → { ok: false, reason: "trigger depth limit reached" }
 *   4. Target agent not found in agentConfigs → { ok: false, reason: '...not found' }
 *   5. Runner pool missing for target → { ok: false, reason: '...is disabled' }
 *   6. Runner pool size=0 (scale=0) → { ok: false, reason: '...is disabled' }
 *   7. Runner available → { ok: true } (dispatched path)
 *   8. No runner available → { ok: true } (queued path via dispatchOrQueue)
 *
 * Covers:
 *   - execution/call-dispatcher.ts: wireCallDispatcher — paused check → ok:false
 *   - execution/call-dispatcher.ts: wireCallDispatcher — self-call → ok:false
 *   - execution/call-dispatcher.ts: wireCallDispatcher — depth limit → ok:false
 *   - execution/call-dispatcher.ts: wireCallDispatcher — target not found → ok:false
 *   - execution/call-dispatcher.ts: wireCallDispatcher — pool missing → ok:false
 *   - execution/call-dispatcher.ts: wireCallDispatcher — pool size=0 → ok:false
 *   - execution/call-dispatcher.ts: wireCallDispatcher — dispatched path → ok:true
 *   - execution/call-dispatcher.ts: wireCallDispatcher — queued path → ok:true
 */

import { describe, it, expect, vi } from "vitest";

const { wireCallDispatcher } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/call-dispatcher.js"
);

const { RunnerPool } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/runner-pool.js"
);

const { CallStore } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/call-store.js"
);

// ── Helpers ────────────────────────────────────────────────────────────────

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };
}

function makeCallEntry(overrides: Record<string, any> = {}) {
  return {
    callerAgent: "caller-agent",
    targetAgent: "target-agent",
    callId: "call-" + Math.random().toString(36).slice(2),
    callerInstanceId: "inst-001",
    depth: 0,
    context: "some task context",
    ...overrides,
  };
}

function makeGateway(callStore?: any) {
  let storedDispatcher: ((entry: any) => any) | undefined;
  return {
    callStore: callStore ?? null,
    setCallDispatcher(fn: (entry: any) => any) {
      storedDispatcher = fn;
    },
    dispatch(entry: any) {
      if (!storedDispatcher) throw new Error("dispatcher not set");
      return storedDispatcher(entry);
    },
  };
}

function makeMockRunner(isRunning = false) {
  return {
    isRunning,
    instanceId: "runner-" + Math.random().toString(36).slice(2),
    run: vi.fn(async () => ({ result: "completed", returnValue: undefined, triggers: [] })),
    abort: vi.fn(),
  };
}

function makeMinimalCtx(overrides: Record<string, any> = {}) {
  const logger = makeLogger();
  return {
    logger,
    maxTriggerDepth: 3,
    maxReruns: 0,
    agentConfigs: [] as any[],
    runnerPools: {} as Record<string, any>,
    workQueue: {
      enqueue: vi.fn(() => ({ accepted: true, dropped: undefined })),
      dequeue: vi.fn(() => undefined),
      size: vi.fn(() => 0),
      clear: vi.fn(),
      clearAll: vi.fn(),
      close: vi.fn(),
      setAgentMaxSize: vi.fn(),
      peek: vi.fn(() => []),
    },
    shuttingDown: false,
    useBakedImages: false,
    statsStore: undefined,
    statusTracker: undefined,
    skills: undefined,
    events: undefined,
    isAgentEnabled: (_name: string) => true,
    isPaused: () => false,
    ...overrides,
  };
}

function makeStatusTracker(paused: boolean) {
  return {
    isPaused: vi.fn(() => paused),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("integration: wireCallDispatcher() validation branches (no Docker required)", { timeout: 10_000 }, () => {
  it("returns ok:false with 'scheduler is paused' when statusTracker.isPaused() is true", () => {
    const gateway = makeGateway();
    const ctx = makeMinimalCtx();
    const statusTracker = makeStatusTracker(true);
    wireCallDispatcher(gateway, ctx, statusTracker);

    const result = gateway.dispatch(makeCallEntry());
    expect(result).toEqual({ ok: false, reason: "scheduler is paused" });
    expect(statusTracker.isPaused).toHaveBeenCalled();
  });

  it("returns ok:false when callerAgent === targetAgent (self-call)", () => {
    const gateway = makeGateway();
    const ctx = makeMinimalCtx();
    wireCallDispatcher(gateway, ctx);

    const result = gateway.dispatch(makeCallEntry({ callerAgent: "same-agent", targetAgent: "same-agent" }));
    expect(result).toEqual({ ok: false, reason: "agent cannot call itself" });
  });

  it("returns ok:false when depth >= maxTriggerDepth", () => {
    const gateway = makeGateway();
    const ctx = makeMinimalCtx({ maxTriggerDepth: 2 });
    wireCallDispatcher(gateway, ctx);

    const result = gateway.dispatch(makeCallEntry({ depth: 2 }));
    expect(result).toEqual({ ok: false, reason: "trigger depth limit reached" });
  });

  it("returns ok:false when depth is exactly at limit (depth >= maxTriggerDepth)", () => {
    const gateway = makeGateway();
    const ctx = makeMinimalCtx({ maxTriggerDepth: 5 });
    wireCallDispatcher(gateway, ctx);

    // depth=5 >= maxTriggerDepth=5 → rejected
    const result = gateway.dispatch(makeCallEntry({ depth: 5 }));
    expect(result).toEqual({ ok: false, reason: "trigger depth limit reached" });
  });

  it("returns ok:false with 'not found' when target agent is missing from agentConfigs", () => {
    const gateway = makeGateway();
    const ctx = makeMinimalCtx({
      agentConfigs: [{ name: "other-agent" }],
    });
    wireCallDispatcher(gateway, ctx);

    const result = gateway.dispatch(makeCallEntry({ targetAgent: "missing-agent" }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/missing-agent.*not found/);
  });

  it("returns ok:false with 'is disabled' when runner pool is missing for target", () => {
    const gateway = makeGateway();
    const ctx = makeMinimalCtx({
      agentConfigs: [{ name: "target-agent" }],
      runnerPools: {}, // no pool for "target-agent"
    });
    wireCallDispatcher(gateway, ctx);

    const result = gateway.dispatch(makeCallEntry({ targetAgent: "target-agent" }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/target-agent.*is disabled/);
  });

  it("returns ok:false with 'is disabled' when pool size is 0 (scale=0)", () => {
    const gateway = makeGateway();
    const emptyPool = new RunnerPool([]); // size = 0
    const ctx = makeMinimalCtx({
      agentConfigs: [{ name: "target-agent" }],
      runnerPools: { "target-agent": emptyPool },
    });
    wireCallDispatcher(gateway, ctx);

    const result = gateway.dispatch(makeCallEntry({ targetAgent: "target-agent" }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/target-agent.*is disabled/);
  });

  it("returns ok:true when a runner is available (dispatched path)", () => {
    const callStore = new CallStore(3600);
    const gateway = makeGateway(callStore);

    const mockRunner = makeMockRunner(false); // not running → available
    const pool = new RunnerPool([mockRunner]);
    const agentConfig = {
      name: "target-agent",
      schedule: "0 0 31 2 *",
      models: [{ provider: "anthropic", model: "claude-3-5-haiku-20241022", authType: "api_key" }],
    };
    const ctx = makeMinimalCtx({
      agentConfigs: [agentConfig],
      runnerPools: { "target-agent": pool },
      useBakedImages: true, // avoid building prompts that need skill files
    });

    wireCallDispatcher(gateway, ctx);

    const callEntry = callStore.create({
      callerAgent: "caller-agent",
      callerInstanceId: "inst-001",
      targetAgent: "target-agent",
      context: "do something",
      depth: 0,
    });

    const result = gateway.dispatch({
      callerAgent: "caller-agent",
      targetAgent: "target-agent",
      callId: callEntry.callId,
      callerInstanceId: "inst-001",
      depth: 0,
      context: "do something",
    });

    expect(result).toEqual({ ok: true });
    // callStore should have been set to running
    const updated = callStore.get(callEntry.callId);
    expect(updated?.status).toBe("running");

    callStore.dispose();
  });

  it("returns ok:true when no runner available (queued path)", () => {
    const callStore = new CallStore(3600);
    const gateway = makeGateway(callStore);

    const busyRunner = makeMockRunner(true); // already running → not available
    const pool = new RunnerPool([busyRunner]);
    const agentConfig = {
      name: "target-agent",
      schedule: "0 0 31 2 *",
      models: [{ provider: "anthropic", model: "claude-3-5-haiku-20241022", authType: "api_key" }],
    };
    const ctx = makeMinimalCtx({
      agentConfigs: [agentConfig],
      runnerPools: { "target-agent": pool },
      useBakedImages: true,
    });

    wireCallDispatcher(gateway, ctx);

    const callEntry = callStore.create({
      callerAgent: "caller-agent",
      callerInstanceId: "inst-001",
      targetAgent: "target-agent",
      context: "do something",
      depth: 0,
    });

    const result = gateway.dispatch({
      callerAgent: "caller-agent",
      targetAgent: "target-agent",
      callId: callEntry.callId,
      callerInstanceId: "inst-001",
      depth: 0,
      context: "do something",
    });

    // Should be queued since runner is busy
    expect(result).toEqual({ ok: true });
    // workQueue.enqueue should have been called
    expect(ctx.workQueue.enqueue).toHaveBeenCalledWith(
      "target-agent",
      expect.objectContaining({ type: "agent-trigger", callId: callEntry.callId }),
    );

    callStore.dispose();
  });

  it("does not check isPaused when statusTracker is undefined", () => {
    const gateway = makeGateway();
    const ctx = makeMinimalCtx({
      agentConfigs: [{ name: "other-agent" }],
    });
    // No statusTracker passed — should not throw
    wireCallDispatcher(gateway, ctx, undefined);

    const result = gateway.dispatch(makeCallEntry({ targetAgent: "nonexistent" }));
    // Should fall through to "target not found" rather than "scheduler is paused"
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/nonexistent.*not found/);
  });

  it("depth=0 with maxTriggerDepth=1 accepts depth=0 but rejects depth=1", () => {
    const gateway1 = makeGateway();
    const gateway2 = makeGateway();
    const ctx1 = makeMinimalCtx({ maxTriggerDepth: 1, agentConfigs: [] });
    const ctx2 = makeMinimalCtx({ maxTriggerDepth: 1, agentConfigs: [] });
    wireCallDispatcher(gateway1, ctx1);
    wireCallDispatcher(gateway2, ctx2);

    // depth=0 < maxTriggerDepth=1 → passes depth check, falls through to "not found"
    const r0 = gateway1.dispatch(makeCallEntry({ depth: 0, targetAgent: "missing" }));
    expect(r0.ok).toBe(false);
    expect(r0.reason).toMatch(/not found/);

    // depth=1 >= maxTriggerDepth=1 → rejected for depth limit
    const r1 = gateway2.dispatch(makeCallEntry({ depth: 1, targetAgent: "missing" }));
    expect(r1).toEqual({ ok: false, reason: "trigger depth limit reached" });
  });
});
