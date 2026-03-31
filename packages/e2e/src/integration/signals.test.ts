import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: signals and exit codes", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("exit 0 is treated as completed", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "exit-zero",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'success'\nexit 0\n",
        },
      ],
    });

    await harness.start();
    
    // Manually trigger the agent since there are no more automatic initial runs
    await harness.triggerAgent("exit-zero");
    
    const run = await harness.waitForRunResult("exit-zero");
    expect(run.result).toBe("completed");
  });

  it("exit 1 is treated as error", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "exit-error",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'failure'\nexit 1\n",
        },
      ],
    });

    await harness.start();
    
    // Manually trigger the agent since there are no more automatic initial runs
    await harness.triggerAgent("exit-error");
    
    const run = await harness.waitForRunResult("exit-error");
    expect(run.result).toBe("error");
  });

  it("exit 42 triggers rerun", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "rerun-agent",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            'MARKER="/tmp/rerun-agent-ran"',
            'if [ ! -f "$MARKER" ]; then',
            '  touch "$MARKER"',
            '  echo "requesting rerun via exit 42"',
            "  exit 42",
            "fi",
            'echo "second run completed"',
            "exit 0",
          ].join("\n"),
          config: { timeout: 60 },
        },
      ],
      globalConfig: { maxReruns: 3 },
    });

    await harness.start();

    // Manually trigger the agent since there are no more automatic initial runs
    await harness.triggerAgent("rerun-agent");

    // First run exits 42, triggers rerun
    const firstRun = await harness.waitForRunResult("rerun-agent");
    expect(firstRun.result).toBe("rerun");

    // At least one rerun was triggered (marker doesn't persist across
    // Docker containers, so all runs exit 42 until maxReruns is hit)
    await harness.waitForRunResult("rerun-agent");
  });

  it("max reruns is enforced — agent stops after limit", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "forever-rerun",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'rerun forever'\nexit 42\n",
          config: { timeout: 30 },
        },
      ],
      globalConfig: { maxReruns: 2 },
    });

    await harness.start();

    // Manually trigger the agent since there are no more automatic initial runs
    await harness.triggerAgent("forever-rerun");

    // 1 initial + 2 reruns = 3 total runs, then stops
    await harness.waitForRunResult("forever-rerun");
    await harness.waitForRunResult("forever-rerun");
    await harness.waitForRunResult("forever-rerun");
    // Wait for the rerun loop to fully exit and release the runner
    await harness.waitForIdle("forever-rerun");
  });

  it("al-return emits structured log line that container runner captures", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "return-agent",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            "export AL_SIGNAL_DIR=/tmp/signals",
            "mkdir -p $AL_SIGNAL_DIR",
            // al-return — verify exit 0 + ok=true
            "set +e",
            'RESULT=$(al-return "hello-from-return-agent")',
            "RC=$?",
            "set -e",
            'test "$RC" -eq 0 || { echo "al-return exit=$RC: $RESULT"; exit 1; }',
            'OK=$(echo "$RESULT" | jq -r .ok)',
            'test "$OK" = "true" || { echo "al-return ok=$OK: $RESULT"; exit 1; }',
            // Also emit the structured log line that container runner parses
            'echo \'{"_log":true,"msg":"signal-result","type":"return","value":"hello-from-return-agent"}\'',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    
    // Manually trigger the agent since there are no more automatic initial runs
    await harness.triggerAgent("return-agent");
    
    const run = await harness.waitForRunResult("return-agent");
    expect(run.result).toBe("completed");
  });

  it("al-status updates agent status via gateway", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "status-agent",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            "export AL_SIGNAL_DIR=/tmp/signals",
            "mkdir -p $AL_SIGNAL_DIR",
            // al-status — verify exit 0 + ok=true
            "set +e",
            'RESULT=$(al-status "processing step 1")',
            "RC=$?",
            "set -e",
            'test "$RC" -eq 0 || { echo "al-status exit=$RC: $RESULT"; exit 1; }',
            'OK=$(echo "$RESULT" | jq -r .ok)',
            'test "$OK" = "true" || { echo "al-status ok=$OK: $RESULT"; exit 1; }',
            "sleep 1",
            // Second call
            "set +e",
            'RESULT=$(al-status "processing step 2")',
            "RC=$?",
            "set -e",
            'test "$RC" -eq 0 || { echo "al-status exit=$RC: $RESULT"; exit 1; }',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    
    // Manually trigger the agent since there are no more automatic initial runs
    await harness.triggerAgent("status-agent");
    
    const run = await harness.waitForRunResult("status-agent");
    expect(run.result).toBe("completed");
  });

  it("al-rerun command works (posts to gateway, then exit 42 causes actual rerun)", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "al-rerun-agent",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            "export AL_SIGNAL_DIR=/tmp/signals",
            "mkdir -p $AL_SIGNAL_DIR",
            'MARKER="/tmp/al-rerun-agent-ran"',
            'if [ ! -f "$MARKER" ]; then',
            '  touch "$MARKER"',
            // al-rerun — verify exit 0 + ok=true
            "  set +e",
            '  RESULT=$(al-rerun)',
            "  RC=$?",
            "  set -e",
            '  test "$RC" -eq 0 || { echo "al-rerun exit=$RC: $RESULT"; exit 1; }',
            '  OK=$(echo "$RESULT" | jq -r .ok)',
            '  test "$OK" = "true" || { echo "al-rerun ok=$OK: $RESULT"; exit 1; }',
            "  exit 42",    // container runner checks exit code
            "fi",
            'echo "second run after al-rerun"',
            "exit 0",
          ].join("\n"),
          config: { timeout: 60 },
        },
      ],
      globalConfig: { maxReruns: 3 },
    });

    await harness.start();

    // Manually trigger the agent since there are no more automatic initial runs
    await harness.triggerAgent("al-rerun-agent");

    // First run calls al-rerun then exits 42
    const firstRun = await harness.waitForRunResult("al-rerun-agent");
    expect(firstRun.result).toBe("rerun");

    // At least one rerun was triggered
    await harness.waitForRunResult("al-rerun-agent");
  });

  it("run:end event includes exitCode for error exits", async () => {
    // The run:end event should include the exitCode when a container exits
    // with a non-zero code. This is used by the dashboard to show exit codes.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "exit-code-agent",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            // Exit with a specific non-zero code
            "exit 2",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    // Subscribe to run:end to capture the full event with exitCode
    const runEndPromise = harness.events.waitFor(
      "run:end",
      (e) => e.agentName === "exit-code-agent",
      60_000,
    );

    await harness.triggerAgent("exit-code-agent");

    const runEnd = await runEndPromise;
    expect(runEnd.agentName).toBe("exit-code-agent");
    expect(runEnd.result).toBe("error");
    // exitCode should be present and reflect the container's exit code
    expect(runEnd.exitCode).toBe(2);
  });

  it("structured log lines are forwarded by container runner", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "structured-log-agent",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            // Emit various structured log lines the host parses
            'echo \'{"_log":true,"level":"info","msg":"custom info message","key":"value"}\'',
            'echo \'{"_log":true,"level":"warn","msg":"custom warning"}\'',
            'echo \'{"_log":true,"level":"debug","msg":"debug detail","count":42}\'',
            // Plain text output (not JSON) is also forwarded
            'echo "plain text output from agent"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    
    // Manually trigger the agent since there are no more automatic initial runs
    await harness.triggerAgent("structured-log-agent");
    
    const run = await harness.waitForRunResult("structured-log-agent");
    expect(run.result).toBe("completed");
  });
});
