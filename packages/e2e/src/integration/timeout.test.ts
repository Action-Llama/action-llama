/**
 * Integration test: verify agent timeout enforcement.
 *
 * Agents have a configurable `timeout` (seconds) after which the container
 * self-terminates with exit code 124. This happens via a setTimeout in
 * container-entry.ts that calls process.exit(124).
 *
 * The scheduler then receives exit code 124 and records it as an "error" result.
 *
 * Covers: agent timeout enforcement end-to-end (timeout config → container
 * self-termination → error result recorded).
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: agent timeout enforcement", { timeout: 120_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("agent that exceeds its timeout is killed and results in error", async () => {
    // Configure a 10-second timeout. The test script sleeps 120 seconds,
    // which will be killed by the container's self-termination timer.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "timeout-agent",
          schedule: "0 0 31 2 *",
          config: {
            timeout: 10, // 10-second timeout
          },
          testScript: [
            "#!/bin/sh",
            // Sleep for much longer than the configured timeout
            "echo 'starting long sleep...'",
            "sleep 120",
            // This line should never be reached
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    await harness.triggerAgent("timeout-agent");

    // Wait for the run to complete (error due to timeout)
    // Allow 30s for container startup + 10s timeout + buffer
    const run = await harness.waitForRunResult("timeout-agent", 60_000);

    // The agent was killed by the timeout, so it should be an error
    expect(run.result).toBe("error");
  });

  it("agent that completes before timeout succeeds normally", async () => {
    // Configure a generous 60-second timeout. The test script completes quickly.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "fast-agent",
          schedule: "0 0 31 2 *",
          config: {
            timeout: 60, // 60-second timeout (plenty of time)
          },
          testScript: [
            "#!/bin/sh",
            'echo "fast-agent completed within timeout"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    await harness.triggerAgent("fast-agent");

    const run = await harness.waitForRunResult("fast-agent");
    expect(run.result).toBe("completed");
  });

  it("different agents can have different timeouts", async () => {
    // First agent: short timeout (15s), sleeps too long → error
    // Second agent: long timeout (60s), completes quickly → success
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "short-timeout-agent",
          schedule: "0 0 31 2 *",
          config: { timeout: 10 },
          testScript: "#!/bin/sh\nsleep 120\nexit 0\n",
        },
        {
          name: "long-timeout-agent",
          schedule: "0 0 31 2 *",
          config: { timeout: 60 },
          testScript: "#!/bin/sh\necho 'done'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    await harness.triggerAgent("short-timeout-agent");
    await harness.triggerAgent("long-timeout-agent");

    const [shortRun, longRun] = await Promise.all([
      harness.waitForRunResult("short-timeout-agent", 60_000),
      harness.waitForRunResult("long-timeout-agent", 60_000),
    ]);

    expect(shortRun.result).toBe("error"); // killed by timeout
    expect(longRun.result).toBe("completed"); // completed within timeout
  });
});
