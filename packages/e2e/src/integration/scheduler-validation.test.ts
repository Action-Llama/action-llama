/**
 * Integration test: verify the scheduler's config validation.
 *
 * The scheduler validates agent configurations before starting. Certain
 * configuration errors (like using pi_auth with container-based agents)
 * must be caught early and reported clearly.
 *
 * Covers:
 *   - scheduler/validation.ts: pi_auth with container mode validation
 *   - ConfigError thrown on invalid config → startScheduler rejects
 */
import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";
import { makeModel } from "./helpers.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: scheduler configuration validation", { timeout: 120_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) {
      try { await harness.shutdown(); } catch {}
    }
  });

  it("rejects startup when an agent uses pi_auth (unsupported in container mode)", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "pi-auth-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        // Override the default api_key model with a pi_auth model
        models: {
          sonnet: makeModel({ authType: "pi_auth" }),
        },
      },
    });

    // Starting the scheduler should fail because pi_auth is not supported
    // in container mode (scheduler/validation.ts enforces this).
    let startError: Error | undefined;
    try {
      await harness.start();
    } catch (err) {
      startError = err instanceof Error ? err : new Error(String(err));
    }

    expect(startError).toBeDefined();
    expect(startError!.message).toMatch(/pi_auth/i);
  });

  it("starts successfully with a valid api_key auth type", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "valid-auth-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'ran'\nexit 0\n",
        },
      ],
      globalConfig: {
        models: {
          sonnet: makeModel({ authType: "api_key" }),
        },
      },
    });

    // Should start without error
    await expect(harness.start()).resolves.not.toThrow();

    // Verify the agent can run
    await harness.triggerAgent("valid-auth-agent");
    const run = await harness.waitForRunResult("valid-auth-agent", 120_000);
    expect(run.result).toBe("completed");
  });
});
