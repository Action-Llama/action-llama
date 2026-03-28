import { describe, it, expect, vi, beforeEach } from "vitest";
import { wireCallDispatcher } from "../../src/execution/call-dispatcher.js";
import { RunnerPool } from "../../src/execution/runner-pool.js";
import { MemoryWorkQueue } from "../../src/events/event-queue.js";
import {
  DEFAULT_MAX_TRIGGER_DEPTH,
  type SchedulerContext,
  type WorkItem,
} from "../../src/execution/execution.js";
import type { AgentConfig } from "../../src/shared/config.js";

// Minimal mock for the GatewayServer
function makeGateway() {
  let capturedDispatcher: ((entry: any) => any) | undefined;
  return {
    callStore: {
      setRunning: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
    },
    setCallDispatcher: vi.fn((dispatcher: (entry: any) => any) => {
      capturedDispatcher = dispatcher;
    }),
    getDispatcher: () => capturedDispatcher,
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;
}

function makeAgentConfig(name: string, overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name,
    credentials: [],
    models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
    schedule: "0 * * * *",
    scale: 1,
    ...overrides,
  };
}

function makeRunner(overrides: any = {}) {
  return {
    instanceId: overrides.instanceId ?? "test-agent",
    isRunning: overrides.isRunning ?? false,
    run: overrides.run ?? vi.fn().mockResolvedValue({ result: "completed", triggers: [] }),
  };
}

function makeCtx(overrides: Partial<SchedulerContext> = {}): SchedulerContext {
  return {
    runnerPools: {},
    agentConfigs: [],
    maxReruns: 10,
    maxTriggerDepth: DEFAULT_MAX_TRIGGER_DEPTH,
    logger: makeLogger(),
    workQueue: new MemoryWorkQueue<WorkItem>(20),
    shuttingDown: false,
    useBakedImages: true,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<{
  callId: string;
  callerAgent: string;
  callerInstanceId: string;
  targetAgent: string;
  context: string;
  depth: number;
}> = {}) {
  return {
    callId: "call-1",
    callerAgent: "agent-a",
    callerInstanceId: "inst-a",
    targetAgent: "agent-b",
    context: "do something",
    depth: 0,
    ...overrides,
  };
}

describe("wireCallDispatcher", () => {
  let gateway: ReturnType<typeof makeGateway>;
  let ctx: SchedulerContext;

  beforeEach(() => {
    gateway = makeGateway();
    ctx = makeCtx();
  });

  it("registers a dispatcher on the gateway", () => {
    wireCallDispatcher(gateway as any, ctx);
    expect(gateway.setCallDispatcher).toHaveBeenCalledOnce();
    expect(gateway.getDispatcher()).toBeTypeOf("function");
  });

  describe("dispatcher behavior", () => {
    it("returns ok: false when scheduler is paused", () => {
      const statusTracker = { isPaused: vi.fn().mockReturnValue(true) };
      wireCallDispatcher(gateway as any, ctx, statusTracker as any);
      const dispatch = gateway.getDispatcher()!;

      const result = dispatch(makeEntry());
      expect(result).toEqual({ ok: false, reason: "scheduler is paused" });
    });

    it("returns ok: false when agent calls itself", () => {
      wireCallDispatcher(gateway as any, ctx);
      const dispatch = gateway.getDispatcher()!;

      const result = dispatch(makeEntry({ callerAgent: "agent-a", targetAgent: "agent-a" }));
      expect(result).toEqual({ ok: false, reason: "agent cannot call itself" });
    });

    it("returns ok: false when depth >= maxTriggerDepth", () => {
      ctx = makeCtx({ maxTriggerDepth: 3 });
      wireCallDispatcher(gateway as any, ctx);
      const dispatch = gateway.getDispatcher()!;

      const result = dispatch(makeEntry({ depth: 3 }));
      expect(result).toEqual({ ok: false, reason: "trigger depth limit reached" });
    });

    it("returns ok: false when depth is exactly at limit", () => {
      ctx = makeCtx({ maxTriggerDepth: 5 });
      wireCallDispatcher(gateway as any, ctx);
      const dispatch = gateway.getDispatcher()!;

      const result = dispatch(makeEntry({ depth: 5 }));
      expect(result).toEqual({ ok: false, reason: "trigger depth limit reached" });
    });

    it("returns ok: false when target agent not found in config", () => {
      ctx = makeCtx({ agentConfigs: [makeAgentConfig("agent-a")] });
      wireCallDispatcher(gateway as any, ctx);
      const dispatch = gateway.getDispatcher()!;

      const result = dispatch(makeEntry({ targetAgent: "agent-b" }));
      expect(result).toEqual({ ok: false, reason: 'target agent "agent-b" not found' });
    });

    it("returns ok: false when target agent pool is missing", () => {
      ctx = makeCtx({
        agentConfigs: [makeAgentConfig("agent-b")],
        runnerPools: {},
      });
      wireCallDispatcher(gateway as any, ctx);
      const dispatch = gateway.getDispatcher()!;

      const result = dispatch(makeEntry({ targetAgent: "agent-b" }));
      expect(result).toEqual({ ok: false, reason: 'target agent "agent-b" is disabled' });
    });

    it("returns ok: false when target agent pool is empty (scale=0)", () => {
      ctx = makeCtx({
        agentConfigs: [makeAgentConfig("agent-b")],
        runnerPools: { "agent-b": new RunnerPool([]) },
      });
      wireCallDispatcher(gateway as any, ctx);
      const dispatch = gateway.getDispatcher()!;

      const result = dispatch(makeEntry({ targetAgent: "agent-b" }));
      expect(result).toEqual({ ok: false, reason: 'target agent "agent-b" is disabled' });
    });

    it("returns ok: true and dispatches to available runner", async () => {
      const runner = makeRunner({ instanceId: "agent-b" });
      const pool = new RunnerPool([runner]);
      ctx = makeCtx({
        agentConfigs: [makeAgentConfig("agent-a"), makeAgentConfig("agent-b")],
        runnerPools: {
          "agent-b": pool,
        },
      });
      wireCallDispatcher(gateway as any, ctx);
      const dispatch = gateway.getDispatcher()!;

      const result = dispatch(makeEntry({ callerAgent: "agent-a", targetAgent: "agent-b", depth: 0 }));
      expect(result).toEqual({ ok: true });
      expect(gateway.callStore.setRunning).toHaveBeenCalledWith("call-1");
    });

    it("logs info and marks call running when dispatching to available runner", async () => {
      const runner = makeRunner({ instanceId: "agent-b" });
      const pool = new RunnerPool([runner]);
      ctx = makeCtx({
        agentConfigs: [makeAgentConfig("agent-a"), makeAgentConfig("agent-b")],
        runnerPools: { "agent-b": pool },
      });
      wireCallDispatcher(gateway as any, ctx);
      const dispatch = gateway.getDispatcher()!;

      dispatch(makeEntry({ callerAgent: "agent-a", targetAgent: "agent-b" }));
      expect(ctx.logger.info).toHaveBeenCalledWith(
        { caller: "agent-a", target: "agent-b", depth: 0 },
        "dispatching call"
      );
    });

    it("enqueues work when all runners are busy", () => {
      const busyRunner = makeRunner({ instanceId: "agent-b", isRunning: true });
      const pool = new RunnerPool([busyRunner]);
      ctx = makeCtx({
        agentConfigs: [makeAgentConfig("agent-a"), makeAgentConfig("agent-b")],
        runnerPools: { "agent-b": pool },
      });
      wireCallDispatcher(gateway as any, ctx);
      const dispatch = gateway.getDispatcher()!;

      const result = dispatch(makeEntry({ callerAgent: "agent-a", targetAgent: "agent-b", callId: "call-99", depth: 1 }));
      expect(result).toEqual({ ok: true });
      expect(ctx.workQueue.size("agent-b")).toBe(1);
      const item = ctx.workQueue.dequeue("agent-b");
      expect(item?.context).toMatchObject({
        type: "agent-trigger",
        sourceAgent: "agent-a",
        callId: "call-99",
        depth: 1,
      });
    });

    it("logs when all runners are busy and call is queued", () => {
      const busyRunner = makeRunner({ instanceId: "agent-b", isRunning: true });
      const pool = new RunnerPool([busyRunner]);
      ctx = makeCtx({
        agentConfigs: [makeAgentConfig("agent-a"), makeAgentConfig("agent-b")],
        runnerPools: { "agent-b": pool },
      });
      wireCallDispatcher(gateway as any, ctx);
      const dispatch = gateway.getDispatcher()!;

      dispatch(makeEntry({ callerAgent: "agent-a", targetAgent: "agent-b" }));
      expect(ctx.logger.info).toHaveBeenCalledWith(
        { caller: "agent-a", target: "agent-b" },
        "all runners busy, call queued"
      );
    });

    it("does not block on paused check when no statusTracker is provided", () => {
      // No statusTracker — should proceed normally (not return paused error)
      ctx = makeCtx({ agentConfigs: [makeAgentConfig("agent-a")] });
      wireCallDispatcher(gateway as any, ctx, undefined);
      const dispatch = gateway.getDispatcher()!;

      const result = dispatch(makeEntry({ targetAgent: "agent-b" }));
      // Falls through to "target not found" because no agent-b in config
      expect(result).toEqual({ ok: false, reason: 'target agent "agent-b" not found' });
    });

    it("completes call store on successful run", async () => {
      const runner = makeRunner({
        instanceId: "agent-b",
        run: vi.fn().mockResolvedValue({ result: "completed", triggers: [], returnValue: "done" }),
      });
      const pool = new RunnerPool([runner]);
      ctx = makeCtx({
        agentConfigs: [makeAgentConfig("agent-a"), makeAgentConfig("agent-b")],
        runnerPools: { "agent-b": pool },
      });
      wireCallDispatcher(gateway as any, ctx);
      const dispatch = gateway.getDispatcher()!;

      dispatch(makeEntry({ callerAgent: "agent-a", targetAgent: "agent-b", callId: "call-ok" }));

      // Wait for async run to complete
      await vi.waitFor(() => expect(gateway.callStore.complete).toHaveBeenCalled());
      expect(gateway.callStore.complete).toHaveBeenCalledWith("call-ok", "done");
    });

    it("fails call store when run result is not completed or rerun", async () => {
      const runner = makeRunner({
        instanceId: "agent-b",
        run: vi.fn().mockResolvedValue({ result: "error", triggers: [] }),
      });
      const pool = new RunnerPool([runner]);
      ctx = makeCtx({
        agentConfigs: [makeAgentConfig("agent-a"), makeAgentConfig("agent-b")],
        runnerPools: { "agent-b": pool },
      });
      wireCallDispatcher(gateway as any, ctx);
      const dispatch = gateway.getDispatcher()!;

      dispatch(makeEntry({ callerAgent: "agent-a", targetAgent: "agent-b", callId: "call-fail" }));

      await vi.waitFor(() => expect(gateway.callStore.fail).toHaveBeenCalled());
      expect(gateway.callStore.fail).toHaveBeenCalledWith("call-fail", "agent run failed");
    });
  });
});
