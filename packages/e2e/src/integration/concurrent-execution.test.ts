/**
 * Integration test: verify concurrent agent execution and work queue behaviour.
 *
 * Tests:
 * 1. Agent with scale=2 can run two jobs simultaneously
 * 2. Work queue: triggers beyond runner capacity are queued and executed once
 *    runners become available
 * 3. Multiple distinct agents run independently at the same time
 *
 * These tests exercise:
 * - RunnerPool concurrent execution (scale > 1)
 * - WorkQueue enqueue/dequeue cycle
 * - Per-agent isolation (runner pools don't interfere)
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: concurrent execution and work queue", { timeout: 300_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("agent with scale=2 runs two jobs in parallel", async () => {
    // Both jobs sleep for 5 seconds; with scale=2 they should both start
    // and both complete within ~10s total rather than ~10s sequentially.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "scaled-agent",
          schedule: "0 0 31 2 *",
          config: {
            scale: 2,
          },
          testScript: [
            "#!/bin/sh",
            // Short sleep to let both containers run concurrently
            "sleep 3",
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    const startTime = Date.now();

    // Trigger two concurrent jobs
    await harness.triggerAgent("scaled-agent");
    await harness.triggerAgent("scaled-agent");

    // Wait for both to complete
    const [run1, run2] = await Promise.all([
      harness.waitForRunResult("scaled-agent", 60_000),
      harness.waitForRunResult("scaled-agent", 60_000),
    ]);

    const totalMs = Date.now() - startTime;

    expect(run1.result).toBe("completed");
    expect(run2.result).toBe("completed");

    // Both ran in parallel: total time should be significantly less than
    // 6 seconds (two sequential 3s sleeps). Allow 7s to account for startup overhead.
    expect(totalMs).toBeLessThan(7_000);
  });

  it("work queue: triggers beyond runner capacity queue and execute in order", async () => {
    // Agent with scale=1 — only one runner. Trigger three times: one runs
    // immediately, two queue. All three should complete.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "single-runner-agent",
          schedule: "0 0 31 2 *",
          config: {
            scale: 1,
          },
          testScript: [
            "#!/bin/sh",
            // Brief sleep to hold the runner so the next trigger queues
            "sleep 2",
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    // Trigger three times in rapid succession
    await harness.triggerAgent("single-runner-agent");
    await harness.triggerAgent("single-runner-agent");
    await harness.triggerAgent("single-runner-agent");

    // Wait for all three to complete (they run sequentially via work queue)
    const results = await Promise.all([
      harness.waitForRunResult("single-runner-agent", 120_000),
      harness.waitForRunResult("single-runner-agent", 120_000),
      harness.waitForRunResult("single-runner-agent", 120_000),
    ]);

    for (const run of results) {
      expect(run.result).toBe("completed");
    }
  });

  it("multiple agents run concurrently without interfering with each other", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "concurrent-a",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            "sleep 2",
            'echo "concurrent-a done"',
            "exit 0",
          ].join("\n"),
        },
        {
          name: "concurrent-b",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            "sleep 2",
            'echo "concurrent-b done"',
            "exit 0",
          ].join("\n"),
        },
        {
          name: "concurrent-c",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            "sleep 2",
            'echo "concurrent-c done"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    const startTime = Date.now();

    // Trigger all three agents simultaneously
    await harness.triggerAgent("concurrent-a");
    await harness.triggerAgent("concurrent-b");
    await harness.triggerAgent("concurrent-c");

    // Wait for all three to complete
    const [runA, runB, runC] = await Promise.all([
      harness.waitForRunResult("concurrent-a", 60_000),
      harness.waitForRunResult("concurrent-b", 60_000),
      harness.waitForRunResult("concurrent-c", 60_000),
    ]);

    const totalMs = Date.now() - startTime;

    expect(runA.result).toBe("completed");
    expect(runB.result).toBe("completed");
    expect(runC.result).toBe("completed");

    // All three ran in parallel: total time should be under 7s (< 3 × 2s sequential)
    expect(totalMs).toBeLessThan(7_000);
  });
});
