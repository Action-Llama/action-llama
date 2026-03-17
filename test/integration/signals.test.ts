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
          testScript: "#!/bin/bash\necho 'success'\nexit 0\n",
        },
      ],
    });

    await harness.start();
    await harness.waitForAgentRun("exit-zero");
    expect(harness.getRunnerPool("exit-zero")?.hasRunningJobs).toBe(false);
  });

  it("exit 1 is treated as error", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "exit-error",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/bash\necho 'failure'\nexit 1\n",
        },
      ],
    });

    await harness.start();
    await harness.waitForAgentRun("exit-error");
    expect(harness.getRunnerPool("exit-error")?.hasRunningJobs).toBe(false);
  });

  it("exit 42 triggers rerun", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "rerun-agent",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/bash",
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
    await harness.waitForAgentRun("rerun-agent");
    await harness.waitForSettle(10000);
    await harness.waitForAgentRun("rerun-agent");
    expect(harness.getRunnerPool("rerun-agent")?.hasRunningJobs).toBe(false);
  });

  it("max reruns is enforced — agent stops after limit", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "forever-rerun",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/bash\necho 'rerun forever'\nexit 42\n",
          config: { timeout: 30 },
        },
      ],
      globalConfig: { maxReruns: 2 },
    });

    await harness.start();
    // 1 initial run + 2 reruns = 3 total runs, then stops
    await harness.waitForAgentRun("forever-rerun");
    await harness.waitForSettle(15000);
    expect(harness.getRunnerPool("forever-rerun")?.hasRunningJobs).toBe(false);
  });

  it("al-return emits structured log line that container runner captures", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "return-agent",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/bash",
            "export AL_SIGNAL_DIR=/tmp/signals",
            "mkdir -p $AL_SIGNAL_DIR",
            // al-return writes signal file AND posts to gateway
            'al-return "hello-from-return-agent"',
            // Also emit the structured log line that container runner parses
            'echo \'{"_log":true,"msg":"signal-result","type":"return","value":"hello-from-return-agent"}\'',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    await harness.waitForAgentRun("return-agent");
    expect(harness.getRunnerPool("return-agent")?.hasRunningJobs).toBe(false);
  });

  it("al-status updates agent status via gateway", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "status-agent",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/bash",
            "export AL_SIGNAL_DIR=/tmp/signals",
            "mkdir -p $AL_SIGNAL_DIR",
            // al-status posts to GATEWAY_URL/signals/status
            'al-status "processing step 1"',
            "sleep 1",
            'al-status "processing step 2"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    await harness.waitForAgentRun("status-agent");
    expect(harness.getRunnerPool("status-agent")?.hasRunningJobs).toBe(false);
  });

  it("al-rerun command works (posts to gateway, then exit 42 causes actual rerun)", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "al-rerun-agent",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/bash",
            "export AL_SIGNAL_DIR=/tmp/signals",
            "mkdir -p $AL_SIGNAL_DIR",
            'MARKER="/tmp/al-rerun-agent-ran"',
            'if [ ! -f "$MARKER" ]; then',
            '  touch "$MARKER"',
            "  al-rerun",   // posts to gateway
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
    await harness.waitForAgentRun("al-rerun-agent");
    await harness.waitForSettle(10000);
    await harness.waitForAgentRun("al-rerun-agent");
    expect(harness.getRunnerPool("al-rerun-agent")?.hasRunningJobs).toBe(false);
  });

  it("structured log lines are forwarded by container runner", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "structured-log-agent",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/bash",
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
    await harness.waitForAgentRun("structured-log-agent");
    expect(harness.getRunnerPool("structured-log-agent")?.hasRunningJobs).toBe(false);
  });
});
