import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: agent files accessible in container", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("ACTIONS.md is readable from the container working directory", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "file-reader",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            "set -e",
            // The cwd should be /app/static where agent files are baked in.
            // Verify ACTIONS.md exists and is readable from cwd.
            'test -f /app/static/ACTIONS.md || { echo "ACTIONS.md not found at /app/static"; exit 1; }',
            'test -f /app/static/agent-config.json || { echo "agent-config.json not found at /app/static"; exit 1; }',
            // Verify the content is non-empty
            'CONTENT=$(cat /app/static/ACTIONS.md)',
            'test -n "$CONTENT" || { echo "ACTIONS.md is empty"; exit 1; }',
            'echo "agent files accessible OK"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    const run = await harness.waitForRunResult("file-reader");
    expect(run.result).toBe("completed");
  });
});
