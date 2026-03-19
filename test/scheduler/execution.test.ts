import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PoolRunner } from "../../src/scheduler/runner-pool.js";
import { RunnerPool } from "../../src/scheduler/runner-pool.js";
import { WorkQueue } from "../../src/scheduler/event-queue.js";
import {
  executeRun,
  dispatchTriggers,
  drainQueues,
  runWithReruns,
  DEFAULT_MAX_RERUNS,
  DEFAULT_MAX_TRIGGER_DEPTH,
  type SchedulerContext,
  type WorkItem,
} from "../../src/scheduler/execution.js";
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
    model: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" },
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
    workQueue: new WorkQueue<WorkItem>(20),
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
    expect(runner.run).toHaveBeenCalledWith("prompt", { type: "schedule" });
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
});
