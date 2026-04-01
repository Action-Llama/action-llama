/**
 * Integration test: verify that the scheduler rejects agents referencing
 * undefined webhook sources.
 *
 * When an agent's config.toml references a webhook source (e.g. `source = "github"`)
 * that is NOT declared in the global config.toml `[webhooks]` section,
 * `resolveWebhookSource()` throws an error during `validateAndDiscover()`.
 * The scheduler should fail to start with a clear error message.
 *
 * This is an important guard-rail: misconfigured webhook bindings cause
 * immediate startup failures rather than silent no-op webhooks.
 *
 * Test scenarios:
 *   1. Agent references undefined webhook source → scheduler startup fails
 *      (throws during validateAndDiscover)
 *   2. Agent references a properly declared webhook source → starts normally
 *
 * Covers:
 *   - events/webhook-setup.ts resolveWebhookSource() error path
 *   - scheduler/validation.ts validateAndDiscover() webhook source validation
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)(
  "integration: webhook source validation on startup",
  { timeout: 300_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) await harness.shutdown();
    });

    it(
      "scheduler fails to start when agent references undefined webhook source",
      async () => {
        harness = await IntegrationHarness.create({
          agents: [
            {
              name: "bad-webhook-agent",
              // Agent declares webhook trigger for a source that doesn't exist
              // in the global [webhooks] section
              webhooks: [{ source: "nonexistent-source", events: ["push"] }],
              testScript: "#!/bin/sh\nexit 0\n",
            },
          ],
          globalConfig: {
            // No webhooks section — "nonexistent-source" is not declared
          },
        });

        // Scheduler should fail to start because the webhook source is undefined
        await expect(harness.start()).rejects.toThrow();
      },
    );

    it(
      "scheduler starts normally when agent references a declared webhook source",
      async () => {
        harness = await IntegrationHarness.create({
          agents: [
            {
              name: "valid-webhook-agent",
              // Agent declares webhook trigger for a properly declared source
              webhooks: [{ source: "my-github", events: ["push"] }],
              testScript: "#!/bin/sh\necho 'valid-webhook-agent ran'\nexit 0\n",
            },
          ],
          globalConfig: {
            webhooks: {
              "my-github": { type: "github", allowUnsigned: true },
            },
          },
        });

        // Scheduler should start successfully
        await expect(harness.start()).resolves.not.toThrow();

        // Agent should be triggerable manually
        await harness.triggerAgent("valid-webhook-agent");
        const run = await harness.waitForRunResult("valid-webhook-agent", 120_000);
        expect(run.result).toBe("completed");
      },
    );
  },
);
