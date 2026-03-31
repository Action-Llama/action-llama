/**
 * Integration test: verify that project-level shared files are baked into
 * all agent container images.
 *
 * Files placed in <projectPath>/shared/ are loaded by loadSharedFiles() in
 * image-builder.ts and baked into every agent image at /app/static/shared/.
 * This allows project-wide scripts, configs, or data to be shared across agents.
 *
 * Covers: loadSharedFiles() + image build pipeline + container file access.
 */
import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: project shared files in containers", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("shared script file is available at /app/static/shared/ inside container", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "shared-files-agent",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            "set -e",
            // Verify the shared script exists in the container
            'test -f /app/static/shared/utils.sh || { echo "shared/utils.sh not found in container"; exit 1; }',
            // Execute the shared script and verify its output
            'OUTPUT=$(sh /app/static/shared/utils.sh)',
            'test "$OUTPUT" = "shared-utils-ok" || { echo "unexpected output: $OUTPUT"; exit 1; }',
            'echo "shared-files-agent: shared file verified OK"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    // Write a shared script to the project's shared/ directory BEFORE starting
    // (the harness has already written config files; we add the shared dir now)
    const sharedDir = resolve(harness.projectPath, "shared");
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(
      resolve(sharedDir, "utils.sh"),
      "#!/bin/sh\necho 'shared-utils-ok'\n",
    );

    await harness.start();
    await harness.triggerAgent("shared-files-agent");

    const run = await harness.waitForRunResult("shared-files-agent", 120_000);
    expect(run.result).toBe("completed");
  });

  it("shared files with nested directory structure are accessible in container", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "nested-shared-agent",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            "set -e",
            // Verify nested shared files
            'test -f /app/static/shared/config/settings.json || { echo "nested shared file not found"; exit 1; }',
            'CONTENT=$(cat /app/static/shared/config/settings.json)',
            'echo "$CONTENT" | grep -q "test-value" || { echo "unexpected content: $CONTENT"; exit 1; }',
            'echo "nested-shared-agent: nested shared file verified OK"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    // Write nested shared files
    const configDir = resolve(harness.projectPath, "shared", "config");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      resolve(configDir, "settings.json"),
      JSON.stringify({ key: "test-value", mode: "integration-test" }),
    );

    await harness.start();
    await harness.triggerAgent("nested-shared-agent");

    const run = await harness.waitForRunResult("nested-shared-agent", 120_000);
    expect(run.result).toBe("completed");
  });

  it("agent without shared directory still starts and runs correctly", async () => {
    // No shared directory created — loadSharedFiles() should return {} and
    // the agent should build and run normally.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "no-shared-agent",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            // shared/ should not exist (it was never created)
            '! test -d /app/static/shared || echo "note: shared dir unexpectedly exists"',
            'echo "no-shared-agent: OK without shared files"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    // Explicitly do NOT create a shared/ directory

    await harness.start();
    await harness.triggerAgent("no-shared-agent");

    const run = await harness.waitForRunResult("no-shared-agent", 120_000);
    expect(run.result).toBe("completed");
  });
});
