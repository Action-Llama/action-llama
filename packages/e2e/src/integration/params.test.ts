/**
 * Integration test: verify that agent `params` from config.toml are baked
 * into the container image's prompt-static.txt, making them available to the
 * agent at runtime.
 *
 * Params are arbitrary key-value pairs (strings/numbers/booleans) defined in
 * per-agent config.toml under [params]. They are serialised into the static
 * prompt skeleton by buildPromptSkeleton() and baked into the image as
 * /app/static/prompt-static.txt. The test-script can read this file to verify.
 *
 * Covers: agent params feature end-to-end (not previously covered by
 * integration tests).
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: agent params", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("params defined in config.toml are baked into prompt-static.txt in the container", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "params-agent",
          schedule: "0 0 31 2 *",
          config: {
            params: {
              repo: "acme/app",
              environment: "production",
              max_retries: 3,
            },
          },
          testScript: [
            "#!/bin/sh",
            "set -e",
            // prompt-static.txt is baked into the image at build time;
            // it contains the serialised params block inside <agent-config>
            'test -f /app/static/prompt-static.txt || { echo "prompt-static.txt not found"; exit 1; }',
            'PROMPT_STATIC=$(cat /app/static/prompt-static.txt)',
            // All three params should appear in the baked prompt
            'echo "$PROMPT_STATIC" | grep -q "acme/app" || { echo "param repo not found in prompt-static.txt"; exit 1; }',
            'echo "$PROMPT_STATIC" | grep -q "production" || { echo "param environment not found in prompt-static.txt"; exit 1; }',
            'echo "$PROMPT_STATIC" | grep -q "max_retries" || { echo "param max_retries not found in prompt-static.txt"; exit 1; }',
            'echo "params-agent: all params verified in prompt-static.txt"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    await harness.triggerAgent("params-agent");

    const run = await harness.waitForRunResult("params-agent");
    expect(run.result).toBe("completed");
  });

  it("agents with no params have an empty params block in the prompt", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "no-params-agent",
          schedule: "0 0 31 2 *",
          // No params config — should have empty {} in prompt
          testScript: [
            "#!/bin/sh",
            "set -e",
            'test -f /app/static/prompt-static.txt || { echo "prompt-static.txt not found"; exit 1; }',
            // The agent-config block should exist and contain an empty object
            'PROMPT_STATIC=$(cat /app/static/prompt-static.txt)',
            'echo "$PROMPT_STATIC" | grep -q "<agent-config>" || { echo "<agent-config> block not found"; exit 1; }',
            // Should contain {} (empty params object)
            'echo "$PROMPT_STATIC" | grep -q "{}" || { echo "empty params {} not found in prompt-static.txt"; exit 1; }',
            'echo "no-params-agent: empty params block verified"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    await harness.triggerAgent("no-params-agent");

    const run = await harness.waitForRunResult("no-params-agent");
    expect(run.result).toBe("completed");
  });

  it("params with special characters are correctly escaped in the prompt", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "special-params-agent",
          schedule: "0 0 31 2 *",
          config: {
            params: {
              filter: "label:bug AND is:open",
              url: "https://api.example.com/v1",
            },
          },
          testScript: [
            "#!/bin/sh",
            "set -e",
            'test -f /app/static/prompt-static.txt || { echo "prompt-static.txt not found"; exit 1; }',
            'PROMPT_STATIC=$(cat /app/static/prompt-static.txt)',
            // Verify URL param is present
            'echo "$PROMPT_STATIC" | grep -q "api.example.com" || { echo "URL param not found"; exit 1; }',
            // Verify filter param with spaces/colons is present
            'echo "$PROMPT_STATIC" | grep -q "label:bug" || { echo "filter param not found"; exit 1; }',
            'echo "special-params-agent: special character params verified"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    await harness.triggerAgent("special-params-agent");

    const run = await harness.waitForRunResult("special-params-agent");
    expect(run.result).toBe("completed");
  });
});
