import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PoolRunner } from "../../src/execution/runner-pool.js";
import { RunnerPool } from "../../src/execution/runner-pool.js";
import { MemoryWorkQueue } from "../../src/events/event-queue.js";
import * as executionModule from "../../src/execution/execution.js";
import {
  executeRun,
  dispatchTriggers,
  drainQueues,
  runWithReruns,
  makeManualPrompt,
  makeScheduledPrompt,
  makeWebhookPrompt,
  makeTriggeredPrompt,
  DEFAULT_MAX_RERUNS,
  DEFAULT_MAX_TRIGGER_DEPTH,
  type SchedulerContext,
  type WorkItem,
} from "../../src/execution/execution.js";
import type { AgentConfig } from "../../src/shared/config.js";
import type { WebhookContext } from "../../src/webhooks/types.js";

function makeRunner(overrides: Partial<PoolRunner> = {}): PoolRunner {
  return {
    instanceId: overrides.instanceId ?? "test-agent",
    isRunning: overrides.isRunning ?? false,
    run: overrides.run ?? vi.fn().mockResolvedValue({ result: "completed", triggers: [] }),
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

function makeCtx(overrides: Partial<SchedulerContext> = {}): SchedulerContext {
  return {
    runnerPools: {},
    agentConfigs: [],
    maxReruns: DEFAULT_MAX_RERUNS,
    maxTriggerDepth: DEFAULT_MAX_TRIGGER_DEPTH,
    logger: makeLogger(),
    workQueue: new MemoryWorkQueue<WorkItem>(20),
    shuttingDown: false,
    useBakedImages: true,
    ...overrides,
  };
}

describe("executeRun", () => {
  it("calls runner.run and returns result/triggers", async () => {
    const runner = makeRunner({
      run: vi.fn().mockResolvedValue({ result: "completed", triggers: [{ agent: "b", context: "hi" }] }),
    });
    const ctx = makeCtx({
      agentConfigs: [makeAgentConfig("a"), makeAgentConfig("b")],
      runnerPools: {
        a: new RunnerPool([runner]),
        b: new RunnerPool([makeRunner({ instanceId: "b" })]),
      },
    });

    const { result, triggers } = await executeRun(
      runner, "prompt", { type: "schedule" }, "a", 0, ctx
    );

    expect(result).toBe("completed");
    expect(triggers).toEqual([{ agent: "b", context: "hi" }]);
    expect(runner.run).toHaveBeenCalledWith("prompt", { type: "schedule" }, undefined);
  });

  it("handles runs with no triggers", async () => {
    const runner = makeRunner({
      run: vi.fn().mockResolvedValue({ result: "completed" }),
    });
    const ctx = makeCtx();

    const { result, triggers } = await executeRun(
      runner, "prompt", { type: "schedule" }, "a", 0, ctx
    );

    expect(result).toBe("completed");
    expect(triggers).toEqual([]);
  });
});

describe("dispatchTriggers", () => {
  it("prevents self-triggering", () => {
    const ctx = makeCtx();
    dispatchTriggers([{ agent: "a", context: "hi" }], "a", 0, ctx);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      { source: "a" },
      "agent cannot trigger itself, skipping"
    );
  });

  it("enforces depth limit", () => {
    const ctx = makeCtx({ maxTriggerDepth: 2 });
    dispatchTriggers([{ agent: "b", context: "hi" }], "a", 2, ctx);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ depth: 2 }),
      "trigger depth limit reached, skipping"
    );
  });

  it("skips unknown target agents", () => {
    const ctx = makeCtx({ agentConfigs: [makeAgentConfig("a")] });
    dispatchTriggers([{ agent: "unknown", context: "hi" }], "a", 0, ctx);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ target: "unknown" }),
      "trigger target not found, skipping"
    );
  });

  it("skips disabled targets (scale=0)", () => {
    const config = makeAgentConfig("b", { scale: 0 });
    const ctx = makeCtx({
      agentConfigs: [makeAgentConfig("a"), config],
      runnerPools: {
        a: new RunnerPool([makeRunner()]),
        b: new RunnerPool([]),
      },
    });
    dispatchTriggers([{ agent: "b", context: "hi" }], "a", 0, ctx);
    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ target: "b" }),
      "target disabled (scale=0), skipping"
    );
  });

  it("queues when all runners are busy", () => {
    const busyRunner = makeRunner({ instanceId: "b", isRunning: true });
    const ctx = makeCtx({
      agentConfigs: [makeAgentConfig("a"), makeAgentConfig("b")],
      runnerPools: {
        a: new RunnerPool([makeRunner()]),
        b: new RunnerPool([busyRunner]),
      },
    });
    dispatchTriggers([{ agent: "b", context: "hi" }], "a", 0, ctx);
    expect(ctx.workQueue.size("b")).toBe(1);
    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ target: "b" }),
      "all runners busy, trigger queued"
    );
  });

  it("fires trigger when runner is available", () => {
    const targetRunner = makeRunner({ instanceId: "b" });
    const ctx = makeCtx({
      agentConfigs: [makeAgentConfig("a"), makeAgentConfig("b")],
      runnerPools: {
        a: new RunnerPool([makeRunner()]),
        b: new RunnerPool([targetRunner]),
      },
    });
    dispatchTriggers([{ agent: "b", context: "hi" }], "a", 0, ctx);
    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ target: "b", depth: 0 }),
      "agent trigger firing"
    );
    expect(targetRunner.run).toHaveBeenCalled();
  });

  it("queues trigger for paused target agent instead of dropping", () => {
    const targetRunner = makeRunner({ instanceId: "b" });
    const ctx = makeCtx({
      agentConfigs: [makeAgentConfig("a"), makeAgentConfig("b")],
      runnerPools: {
        a: new RunnerPool([makeRunner()]),
        b: new RunnerPool([targetRunner]),
      },
      isAgentEnabled: (name) => name !== "b",
    });
    dispatchTriggers([{ agent: "b", context: "hi" }], "a", 0, ctx);
    expect(ctx.workQueue.size("b")).toBe(1);
    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ target: "b" }),
      "target agent is paused, trigger queued"
    );
    expect(targetRunner.run).not.toHaveBeenCalled();
  });
});

describe("drainQueues", () => {
  it("processes queued webhooks", async () => {
    const runner = makeRunner({ instanceId: "a" });
    const config = makeAgentConfig("a");
    const ctx = makeCtx({
      agentConfigs: [config],
      runnerPools: { a: new RunnerPool([runner]) },
    });
    ctx.workQueue.enqueue("a", {
      type: "webhook",
      context: { event: "push", action: "", payload: {}, headers: {}, source: "github" } as any,
    });

    await drainQueues(ctx);

    expect(runner.run).toHaveBeenCalled();
  });

  it("processes queued triggers", async () => {
    const runner = makeRunner({ instanceId: "b" });
    const configA = makeAgentConfig("a");
    const configB = makeAgentConfig("b");
    const ctx = makeCtx({
      agentConfigs: [configA, configB],
      runnerPools: {
        a: new RunnerPool([makeRunner()]),
        b: new RunnerPool([runner]),
      },
    });
    ctx.workQueue.enqueue("b", {
      type: "agent-trigger",
      sourceAgent: "a",
      context: "some context",
      depth: 0,
    });

    await drainQueues(ctx);

    expect(runner.run).toHaveBeenCalled();
  });

  it("skips triggers that exceed depth limit", async () => {
    const runner = makeRunner({ instanceId: "b" });
    const ctx = makeCtx({
      maxTriggerDepth: 2,
      agentConfigs: [makeAgentConfig("a"), makeAgentConfig("b")],
      runnerPools: {
        a: new RunnerPool([makeRunner()]),
        b: new RunnerPool([runner]),
      },
    });
    ctx.workQueue.enqueue("b", {
      type: "agent-trigger",
      sourceAgent: "a",
      context: "ctx",
      depth: 2,
    });

    await drainQueues(ctx);

    // runner.run should not be called for the trigger (depth === maxTriggerDepth)
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("stops when scheduler is paused", async () => {
    const runner = makeRunner({ instanceId: "a" });
    const ctx = makeCtx({
      agentConfigs: [makeAgentConfig("a")],
      runnerPools: { a: new RunnerPool([runner]) },
      statusTracker: { isPaused: () => true } as any,
    });
    ctx.workQueue.enqueue("a", {
      type: "webhook",
      context: { event: "push", action: "", payload: {}, headers: {}, source: "github" } as any,
    });

    await drainQueues(ctx);

    expect(runner.run).not.toHaveBeenCalled();
    // Items remain in the queue (not lost)
    expect(ctx.workQueue.size("a")).toBe(1);
  });

  it("stops when shuttingDown is true", async () => {
    const runner = makeRunner({ instanceId: "a" });
    const ctx = makeCtx({
      agentConfigs: [makeAgentConfig("a")],
      runnerPools: { a: new RunnerPool([runner]) },
      shuttingDown: true,
    });
    ctx.workQueue.enqueue("a", {
      type: "webhook",
      context: { event: "push", action: "", payload: {}, headers: {}, source: "github" } as any,
    });

    await drainQueues(ctx);

    expect(runner.run).not.toHaveBeenCalled();
  });

  it("stops when queue is empty", async () => {
    const runner = makeRunner({ instanceId: "a" });
    const ctx = makeCtx({
      agentConfigs: [makeAgentConfig("a")],
      runnerPools: { a: new RunnerPool([runner]) },
    });

    await drainQueues(ctx);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("breaks when dequeue returns undefined before all runners are exhausted (more runners than items)", async () => {
    // Two runners but only one queued item — the second runner iteration should break
    const runner1 = makeRunner({ instanceId: "a-1" });
    const runner2 = makeRunner({ instanceId: "a-2" });
    const config = makeAgentConfig("a");
    const ctx = makeCtx({
      agentConfigs: [config],
      runnerPools: { a: new RunnerPool([runner1, runner2]) },
    });

    // Only one item in the queue, but two available runners
    ctx.workQueue.enqueue("a", {
      type: "webhook",
      context: { event: "push", action: "", payload: {}, headers: {}, source: "github" } as any,
    });

    await drainQueues(ctx);

    // runner1 should have fired the item, runner2 should not have been used (queue empty → break)
    expect(runner1.run).toHaveBeenCalledOnce();
    expect(runner2.run).not.toHaveBeenCalled();
  });

  it("skips queued work for disabled agents", async () => {
    const runner = makeRunner({ instanceId: "a" });
    const config = makeAgentConfig("a");
    const ctx = makeCtx({
      agentConfigs: [config],
      runnerPools: { a: new RunnerPool([runner]) },
      isAgentEnabled: (name) => name !== "a",
    });
    ctx.workQueue.enqueue("a", { type: "schedule" });

    await drainQueues(ctx);

    expect(runner.run).not.toHaveBeenCalled();
  });

  it("drains queued manual trigger", async () => {
    const runner = makeRunner({ instanceId: "a" });
    const config = makeAgentConfig("a");
    const ctx = makeCtx({
      agentConfigs: [config],
      runnerPools: { a: new RunnerPool([runner]) },
    });
    ctx.workQueue.enqueue("a", { type: "manual", prompt: "do something" });

    await drainQueues(ctx);

    expect(runner.run).toHaveBeenCalledOnce();
    const [, triggerInfo] = (runner.run as any).mock.calls[0];
    expect(triggerInfo.type).toBe("manual");
  });

  it("drains queued manual trigger without prompt", async () => {
    const runner = makeRunner({ instanceId: "a" });
    const config = makeAgentConfig("a");
    const ctx = makeCtx({
      agentConfigs: [config],
      runnerPools: { a: new RunnerPool([runner]) },
    });
    ctx.workQueue.enqueue("a", { type: "manual" });

    await drainQueues(ctx);

    // When no prompt is provided, runWithReruns treats it as a schedule run
    expect(runner.run).toHaveBeenCalledOnce();
  });
});

describe("runWithReruns", () => {
  it("runs once and drains when result is 'completed'", async () => {
    const runner = makeRunner({
      run: vi.fn().mockResolvedValue({ result: "completed", triggers: [] }),
    });
    const config = makeAgentConfig("a");
    const ctx = makeCtx({
      agentConfigs: [config],
      runnerPools: { a: new RunnerPool([runner]) },
    });

    await runWithReruns(runner, config, 0, ctx);

    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it("reruns when result is 'rerun'", async () => {
    const runner = makeRunner({
      run: vi.fn()
        .mockResolvedValueOnce({ result: "rerun", triggers: [] })
        .mockResolvedValueOnce({ result: "rerun", triggers: [] })
        .mockResolvedValueOnce({ result: "completed", triggers: [] }),
    });
    const config = makeAgentConfig("a");
    const ctx = makeCtx({
      agentConfigs: [config],
      runnerPools: { a: new RunnerPool([runner]) },
    });

    await runWithReruns(runner, config, 0, ctx);

    expect(runner.run).toHaveBeenCalledTimes(3);
    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ rerun: 1 }),
      expect.stringContaining("requested rerun")
    );
  });

  it("stops reruns when agent is paused mid-run", async () => {
    let callCount = 0;
    const runner = makeRunner({
      run: vi.fn().mockImplementation(async () => {
        callCount++;
        return { result: "rerun", triggers: [] };
      }),
    });
    const config = makeAgentConfig("a");
    // Agent is disabled after the first run
    const ctx = makeCtx({
      maxReruns: DEFAULT_MAX_RERUNS,
      agentConfigs: [config],
      runnerPools: { a: new RunnerPool([runner]) },
      isAgentEnabled: () => callCount < 2,
    });

    await runWithReruns(runner, config, 0, ctx);

    // First run (callCount becomes 1, still enabled), then check: callCount=1 < 2 → enabled
    // Before second run: callCount=1, isAgentEnabled returns 1 < 2 = true (enabled), run happens, callCount=2
    // Before third run: isAgentEnabled returns 2 < 2 = false → stop
    expect(runner.run).toHaveBeenCalledTimes(2);
    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "a" }),
      "agent paused, stopping reruns"
    );
  });

  it("caps reruns at maxReruns", async () => {
    const runner = makeRunner({
      run: vi.fn().mockResolvedValue({ result: "rerun", triggers: [] }),
    });
    const config = makeAgentConfig("a");
    const ctx = makeCtx({
      maxReruns: 3,
      agentConfigs: [config],
      runnerPools: { a: new RunnerPool([runner]) },
    });

    await runWithReruns(runner, config, 0, ctx);

    // 1 initial + 3 reruns = 4 total
    expect(runner.run).toHaveBeenCalledTimes(4);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ maxReruns: 3 }),
      expect.stringContaining("hit max reruns limit")
    );
  });

  it("uses manual prompt when prompt is provided", async () => {
    const runner = makeRunner({
      run: vi.fn().mockResolvedValue({ result: "completed", triggers: [] }),
    });
    const config = makeAgentConfig("a");
    const ctx = makeCtx({
      agentConfigs: [config],
      runnerPools: { a: new RunnerPool([runner]) },
    });

    await runWithReruns(runner, config, 0, ctx, "review PR #42");

    expect(runner.run).toHaveBeenCalledTimes(1);
    const prompt = (runner.run as any).mock.calls[0][0];
    expect(prompt).toContain("review PR #42");
    expect(prompt).toContain("<user-prompt>");
    const triggerInfo = (runner.run as any).mock.calls[0][1];
    expect(triggerInfo.type).toBe("manual");
    expect(triggerInfo.source).toBe("user-prompt");
  });
});

describe("makeManualPrompt", () => {
  it("returns user prompt suffix when baked and prompt given", () => {
    const config = makeAgentConfig("a");
    const ctx = makeCtx({ useBakedImages: true });
    const result = makeManualPrompt(config, ctx, "test task");
    expect(result).toContain("<user-prompt>");
    expect(result).toContain("test task");
    // Should NOT contain full skeleton when baked
    expect(result).not.toContain("<agent-config>");
  });

  it("returns manual suffix when baked and no prompt", () => {
    const config = makeAgentConfig("a");
    const ctx = makeCtx({ useBakedImages: true });
    const result = makeManualPrompt(config, ctx);
    expect(result).toContain("triggered manually");
    expect(result).not.toContain("<user-prompt>");
  });

  it("returns full prompt when not baked", () => {
    const config = makeAgentConfig("a");
    const ctx = makeCtx({ useBakedImages: false });
    const result = makeManualPrompt(config, ctx, "deploy");
    expect(result).toContain("<agent-config>");
    expect(result).toContain("<user-prompt>");
    expect(result).toContain("deploy");
  });
});

describe("makeScheduledPrompt", () => {
  it("returns scheduled suffix when useBakedImages is true", () => {
    const config = makeAgentConfig("a");
    const ctx = makeCtx({ useBakedImages: true });
    const result = makeScheduledPrompt(config, ctx);
    expect(result).toContain("schedule");
    expect(result).not.toContain("<agent-config>");
  });

  it("returns full prompt when useBakedImages is false", () => {
    const config = makeAgentConfig("a");
    const ctx = makeCtx({ useBakedImages: false });
    const result = makeScheduledPrompt(config, ctx);
    expect(result).toContain("<agent-config>");
    expect(result).not.toContain("<user-prompt>");
  });
});

describe("makeWebhookPrompt", () => {
  const webhookCtx: WebhookContext = {
    event: "push",
    action: "opened",
    payload: { ref: "main" },
    headers: {},
    source: "github",
  };

  it("returns webhook suffix when useBakedImages is true", () => {
    const config = makeAgentConfig("a");
    const ctx = makeCtx({ useBakedImages: true });
    const result = makeWebhookPrompt(config, webhookCtx, ctx);
    expect(result).toContain("push");
    expect(result).not.toContain("<agent-config>");
  });

  it("returns full webhook prompt when useBakedImages is false", () => {
    const config = makeAgentConfig("a");
    const ctx = makeCtx({ useBakedImages: false });
    const result = makeWebhookPrompt(config, webhookCtx, ctx);
    expect(result).toContain("<agent-config>");
    expect(result).toContain("push");
  });
});

describe("makeTriggeredPrompt", () => {
  it("returns called suffix when useBakedImages is true", () => {
    const config = makeAgentConfig("b");
    const ctx = makeCtx({ useBakedImages: true });
    const result = makeTriggeredPrompt(config, "agent-a", "deploy context", ctx);
    expect(result).toContain("agent-a");
    expect(result).toContain("deploy context");
    expect(result).not.toContain("<agent-config>");
  });

  it("returns full triggered prompt when useBakedImages is false", () => {
    const config = makeAgentConfig("b");
    const ctx = makeCtx({ useBakedImages: false });
    const result = makeTriggeredPrompt(config, "agent-a", "deploy context", ctx);
    expect(result).toContain("<agent-config>");
    expect(result).toContain("agent-a");
    expect(result).toContain("deploy context");
  });
});

describe("executeRun — instanceLifecycle", () => {
  it("calls lifecycle.complete() on successful run", async () => {
    const runner = makeRunner({
      run: vi.fn().mockResolvedValue({ result: "completed", triggers: [] }),
    });
    const lifecycle = { start: vi.fn(), complete: vi.fn(), fail: vi.fn() };
    const ctx = makeCtx();

    await executeRun(runner, "prompt", { type: "schedule" }, "a", 0, ctx, lifecycle as any);

    expect(lifecycle.start).toHaveBeenCalledOnce();
    expect(lifecycle.complete).toHaveBeenCalledOnce();
    expect(lifecycle.fail).not.toHaveBeenCalled();
  });

  it("calls lifecycle.fail() on runner error", async () => {
    const runner = makeRunner({
      run: vi.fn().mockRejectedValue(new Error("container crashed")),
    });
    const lifecycle = { start: vi.fn(), complete: vi.fn(), fail: vi.fn() };
    const ctx = makeCtx();

    const { result } = await executeRun(runner, "prompt", { type: "schedule" }, "a", 0, ctx, lifecycle as any);

    expect(result).toBe("error");
    expect(lifecycle.start).toHaveBeenCalledOnce();
    expect(lifecycle.fail).toHaveBeenCalledWith("container crashed");
    expect(lifecycle.complete).not.toHaveBeenCalled();
  });

  it("calls lifecycle.fail() when outcome has exitReason", async () => {
    const runner = makeRunner({
      run: vi.fn().mockResolvedValue({ result: "error", exitCode: 1, exitReason: "timeout", triggers: [] }),
    });
    const lifecycle = { start: vi.fn(), complete: vi.fn(), fail: vi.fn() };
    const ctx = makeCtx();

    await executeRun(runner, "prompt", { type: "schedule" }, "a", 0, ctx, lifecycle as any);

    expect(lifecycle.fail).toHaveBeenCalledWith("timeout");
    expect(lifecycle.complete).not.toHaveBeenCalled();
  });
});

describe("executeRun — statsStore", () => {
  it("records run stats when statsStore is provided", async () => {
    const runner = makeRunner({
      run: vi.fn().mockResolvedValue({
        result: "completed",
        exitCode: 0,
        triggers: [],
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cost: 0.01, turnCount: 3 },
      }),
    });
    const statsStore = { recordRun: vi.fn(), recordCallEdge: vi.fn(), updateCallEdge: vi.fn() };
    const ctx = makeCtx({ statsStore: statsStore as any });

    await executeRun(runner, "prompt", { type: "schedule" }, "a", 0, ctx);

    expect(statsStore.recordRun).toHaveBeenCalledOnce();
    const call = statsStore.recordRun.mock.calls[0][0];
    expect(call.agentName).toBe("a");
    expect(call.triggerType).toBe("schedule");
    expect(call.result).toBe("completed");
    expect(call.inputTokens).toBe(100);
    expect(call.outputTokens).toBe(50);
    expect(call.totalTokens).toBe(150);
    expect(call.costUsd).toBe(0.01);
    expect(call.turnCount).toBe(3);
  });

  it("does not throw when statsStore.recordRun throws", async () => {
    const runner = makeRunner({
      run: vi.fn().mockResolvedValue({ result: "completed", triggers: [] }),
    });
    const statsStore = { recordRun: vi.fn().mockImplementation(() => { throw new Error("db error"); }) };
    const ctx = makeCtx({ statsStore: statsStore as any });

    await expect(executeRun(runner, "prompt", { type: "schedule" }, "a", 0, ctx)).resolves.toBeDefined();
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), agent: "a" }),
      "failed to record run stats"
    );
  });
});

describe("executeRun — onRunComplete and returnValue", () => {
  it("calls onRunComplete with correct event data", async () => {
    const runner = makeRunner({
      run: vi.fn().mockResolvedValue({ result: "completed", triggers: [] }),
    });
    const onRunComplete = vi.fn();
    const ctx = makeCtx({ onRunComplete });

    await executeRun(runner, "prompt", { type: "manual" }, "my-agent", 0, ctx);

    expect(onRunComplete).toHaveBeenCalledOnce();
    expect(onRunComplete).toHaveBeenCalledWith({
      agentName: "my-agent",
      result: "completed",
      triggerType: "manual",
    });
  });

  it("returns returnValue from runner outcome", async () => {
    const runner = makeRunner({
      run: vi.fn().mockResolvedValue({ result: "completed", triggers: [], returnValue: "my-return" }),
    });
    const ctx = makeCtx();

    const { returnValue } = await executeRun(runner, "prompt", { type: "schedule" }, "a", 0, ctx);

    expect(returnValue).toBe("my-return");
  });
});

describe("dispatchTriggers — statsStore call edge recording", () => {
  it("records call edge in statsStore when callerInstanceId is provided", async () => {
    const targetRunner = makeRunner({ instanceId: "b-runner" });
    const statsStore = {
      recordRun: vi.fn(),
      recordCallEdge: vi.fn().mockReturnValue(42),
      updateCallEdge: vi.fn(),
    };
    const ctx = makeCtx({
      agentConfigs: [makeAgentConfig("a"), makeAgentConfig("b")],
      runnerPools: {
        a: new RunnerPool([makeRunner()]),
        b: new RunnerPool([targetRunner]),
      },
      statsStore: statsStore as any,
    });

    dispatchTriggers([{ agent: "b", context: "hi" }], "a", 0, ctx, "caller-instance-1");

    expect(statsStore.recordCallEdge).toHaveBeenCalledOnce();
    const edge = statsStore.recordCallEdge.mock.calls[0][0];
    expect(edge.callerAgent).toBe("a");
    expect(edge.callerInstance).toBe("caller-instance-1");
    expect(edge.targetAgent).toBe("b");
    expect(edge.depth).toBe(1);
    expect(edge.status).toBe("pending");
  });

  it("does not record call edge when callerInstanceId is not provided", () => {
    const targetRunner = makeRunner({ instanceId: "b-runner" });
    const statsStore = {
      recordRun: vi.fn(),
      recordCallEdge: vi.fn().mockReturnValue(1),
      updateCallEdge: vi.fn(),
    };
    const ctx = makeCtx({
      agentConfigs: [makeAgentConfig("a"), makeAgentConfig("b")],
      runnerPools: {
        a: new RunnerPool([makeRunner()]),
        b: new RunnerPool([targetRunner]),
      },
      statsStore: statsStore as any,
    });

    dispatchTriggers([{ agent: "b", context: "hi" }], "a", 0, ctx);

    expect(statsStore.recordCallEdge).not.toHaveBeenCalled();
  });

  it("does not throw when statsStore.recordCallEdge throws", () => {
    const targetRunner = makeRunner({ instanceId: "b-runner" });
    const statsStore = {
      recordRun: vi.fn(),
      recordCallEdge: vi.fn().mockImplementation(() => { throw new Error("db error"); }),
      updateCallEdge: vi.fn(),
    };
    const ctx = makeCtx({
      agentConfigs: [makeAgentConfig("a"), makeAgentConfig("b")],
      runnerPools: {
        a: new RunnerPool([makeRunner()]),
        b: new RunnerPool([targetRunner]),
      },
      statsStore: statsStore as any,
    });

    expect(() => dispatchTriggers([{ agent: "b", context: "hi" }], "a", 0, ctx, "caller-instance")).not.toThrow();
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "failed to record call edge"
    );
  });
});

describe("drainQueues — agent-trigger with callId", () => {
  it("calls callStore.complete when trigger run completes successfully", async () => {
    const runner = makeRunner({ instanceId: "b" });
    const callStore = { setRunning: vi.fn(), complete: vi.fn(), fail: vi.fn() };
    const configA = makeAgentConfig("a");
    const configB = makeAgentConfig("b");
    const ctx = makeCtx({
      agentConfigs: [configA, configB],
      runnerPools: {
        a: new RunnerPool([makeRunner()]),
        b: new RunnerPool([runner]),
      },
      callStore: callStore as any,
    });
    ctx.workQueue.enqueue("b", {
      type: "agent-trigger",
      sourceAgent: "a",
      context: "some context",
      depth: 0,
      callId: "call-123",
    });

    await drainQueues(ctx);
    // Wait for async operations to settle
    await new Promise((r) => setTimeout(r, 50));

    expect(callStore.setRunning).toHaveBeenCalledWith("call-123");
    expect(callStore.complete).toHaveBeenCalledWith("call-123", undefined);
  });

  it("calls callStore.fail when trigger run fails", async () => {
    const runner = makeRunner({
      instanceId: "b",
      run: vi.fn().mockResolvedValue({ result: "error", triggers: [], exitCode: 1 }),
    });
    const callStore = { setRunning: vi.fn(), complete: vi.fn(), fail: vi.fn() };
    const configA = makeAgentConfig("a");
    const configB = makeAgentConfig("b");
    const ctx = makeCtx({
      agentConfigs: [configA, configB],
      runnerPools: {
        a: new RunnerPool([makeRunner()]),
        b: new RunnerPool([runner]),
      },
      callStore: callStore as any,
    });
    ctx.workQueue.enqueue("b", {
      type: "agent-trigger",
      sourceAgent: "a",
      context: "some context",
      depth: 0,
      callId: "call-456",
    });

    await drainQueues(ctx);
    await new Promise((r) => setTimeout(r, 50));

    expect(callStore.setRunning).toHaveBeenCalledWith("call-456");
    expect(callStore.fail).toHaveBeenCalledWith("call-456", "agent run failed");
  });
});

describe("dispatchTriggers — rejected reason other than scale=0", () => {
  it("logs 'trigger skipped' info message for non-scale-0 rejected reasons", () => {
    const runner = makeRunner({ instanceId: "a" });
    const ctx = makeCtx({
      agentConfigs: [makeAgentConfig("a"), makeAgentConfig("b")],
      runnerPools: {
        a: new RunnerPool([runner]),
        // No pool for "b" — with default queueWhenBusy=true → will queue
        // Use isPaused to trigger "rejected" reason "scheduler is paused"
      },
      isPaused: () => true,
    });

    // dispatchTriggers from "a" to "b" with global isPaused → rejected with "scheduler is paused"
    dispatchTriggers([{ agent: "b", context: "ctx" }], "a", 0, ctx);

    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "scheduler is paused" }),
      "trigger skipped"
    );
  });
});

describe("drainQueues — schedule work item", () => {
  it("drains queued schedule-type items", async () => {
    const runner = makeRunner({ instanceId: "a" });
    const config = makeAgentConfig("a");
    const ctx = makeCtx({
      agentConfigs: [config],
      runnerPools: { a: new RunnerPool([runner]) },
    });
    ctx.workQueue.enqueue("a", { type: "schedule" });

    await drainQueues(ctx);
    // Wait for async run to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(runner.run).toHaveBeenCalledOnce();
  });

  it("logs error when queued scheduled run throws (via onRunComplete)", async () => {
    const runner = makeRunner({ instanceId: "a" });
    const config = makeAgentConfig("a");
    // Make executeRun throw by providing an onRunComplete that throws
    const ctx = makeCtx({
      agentConfigs: [config],
      runnerPools: { a: new RunnerPool([runner]) },
      onRunComplete: () => { throw new Error("schedule run failed"); },
    });
    ctx.workQueue.enqueue("a", { type: "schedule" });

    await drainQueues(ctx);
    await new Promise((r) => setTimeout(r, 50));

    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "a" }),
      "queued scheduled run failed"
    );
  });

  it("logs error when queued manual trigger run throws (via onRunComplete)", async () => {
    const runner = makeRunner({ instanceId: "a" });
    const config = makeAgentConfig("a");
    const ctx = makeCtx({
      agentConfigs: [config],
      runnerPools: { a: new RunnerPool([runner]) },
      onRunComplete: () => { throw new Error("manual run failed"); },
    });
    ctx.workQueue.enqueue("a", { type: "manual", prompt: "run this" });

    await drainQueues(ctx);
    await new Promise((r) => setTimeout(r, 50));

    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "a" }),
      "queued manual trigger failed"
    );
  });

  it("logs error when queued webhook run throws (via onRunComplete)", async () => {
    const runner = makeRunner({ instanceId: "a" });
    const config = makeAgentConfig("a");
    const ctx = makeCtx({
      agentConfigs: [config],
      runnerPools: { a: new RunnerPool([runner]) },
      onRunComplete: () => { throw new Error("webhook run failed"); },
    });
    const webhookCtx: WorkItem = {
      type: "webhook",
      context: { event: "push", payload: {}, receiptId: "r1", headers: {} },
    };
    ctx.workQueue.enqueue("a", webhookCtx);

    await drainQueues(ctx);
    await new Promise((r) => setTimeout(r, 50));

    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "a" }),
      "queued webhook failed"
    );
  });

  it("logs error when queued agent-trigger run throws (via onRunComplete, with callId)", async () => {
    const runnerA = makeRunner({ instanceId: "a" });
    const runnerB = makeRunner({ instanceId: "b" });
    const callStore = { setRunning: vi.fn(), complete: vi.fn(), fail: vi.fn() };
    const configA = makeAgentConfig("a");
    const configB = makeAgentConfig("b");
    const ctx = makeCtx({
      agentConfigs: [configA, configB],
      runnerPools: {
        a: new RunnerPool([runnerA]),
        b: new RunnerPool([runnerB]),
      },
      callStore: callStore as any,
      // onRunComplete throws to cause executeRun to reject
      onRunComplete: () => { throw new Error("agent trigger failed"); },
    });
    ctx.workQueue.enqueue("b", {
      type: "agent-trigger",
      sourceAgent: "a",
      context: "some context",
      depth: 0,
      callId: "call-err",
    });

    await drainQueues(ctx);
    await new Promise((r) => setTimeout(r, 50));

    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "b" }),
      "queued trigger failed"
    );
    // callStore.fail should be called via the catch handler
    expect(callStore.fail).toHaveBeenCalledWith("call-err", "agent trigger failed");
  });
});

describe("dispatchTriggers — executeRun rejection catch block", () => {
  it("logs error when executeRun rejects during triggered dispatch (via onRunComplete)", async () => {
    const runnerA = makeRunner({ instanceId: "a" });
    const runnerB = makeRunner({ instanceId: "b" });

    const statsStore = {
      recordCallEdge: vi.fn().mockReturnValue(42),
      updateCallEdge: vi.fn(),
      recordRun: vi.fn(),
    };

    let callCount = 0;
    const ctx = makeCtx({
      agentConfigs: [makeAgentConfig("a"), makeAgentConfig("b")],
      runnerPools: {
        a: new RunnerPool([runnerA]),
        b: new RunnerPool([runnerB]),
      },
      statsStore: statsStore as any,
      // First call is for runner "a", second call is for dispatched "b" trigger
      // Make the second call (for "b") throw so the .catch() in dispatchTriggers fires
      onRunComplete: () => {
        callCount++;
        if (callCount >= 2) throw new Error("triggered run exploded");
      },
    });

    // runner "a" returns a trigger to agent "b"
    runnerA.run = vi.fn().mockResolvedValue({
      result: "completed",
      triggers: [{ agent: "b", context: "go" }],
    });

    await executeRun(runnerA, "prompt", { type: "schedule" }, "a", 0, ctx);
    // Wait for the dispatched "b" run to complete and catch() to fire
    await new Promise((r) => setTimeout(r, 100));

    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ target: "b" }),
      "triggered run failed"
    );
    // statsStore.updateCallEdge should be called with error status
    expect(statsStore.updateCallEdge).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ status: "error" })
    );
  });
});
