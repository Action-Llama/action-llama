import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PoolRunner } from "../../src/execution/runner-pool.js";
import { RunnerPool } from "../../src/execution/runner-pool.js";
import { MemoryWorkQueue } from "../../src/events/event-queue.js";
import {
  executeRun,
  dispatchTriggers,
  drainQueues,
  runWithReruns,
  makeManualPrompt,
  DEFAULT_MAX_RERUNS,
  DEFAULT_MAX_TRIGGER_DEPTH,
  type SchedulerContext,
  type WorkItem,
} from "../../src/execution/execution.js";
import type { AgentConfig } from "../../src/shared/config.js";

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
    const ctx = makeCtx({
      agentConfigs: [makeAgentConfig("a")],
      runnerPools: { a: new RunnerPool([makeRunner()]) },
    });

    // Should complete immediately with no work
    await drainQueues(ctx);
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
