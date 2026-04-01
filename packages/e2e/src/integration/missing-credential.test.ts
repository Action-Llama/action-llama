/**
 * Integration test: verify that the scheduler correctly rejects startup when
 * a required credential is missing from the credential store.
 *
 * During startup, validateAndDiscover() calls requireCredentialRef() for each
 * credential listed in active agent configs. If any credential doesn't exist
 * in the FilesystemBackend, a CredentialError is thrown and the scheduler
 * fails to start.
 *
 * Covers:
 *   - scheduler/validation.ts: validateAndDiscover() → requireCredentialRef() loop
 *   - shared/credentials.ts: requireCredentialRef() throws CredentialError
 *   - scheduler startup failure on missing credential
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: missing credential startup rejection", { timeout: 120_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) {
      try { await harness.shutdown(); } catch {}
    }
  });

  it("scheduler startup fails when a required credential is not in the credential store", async () => {
    // Configure an agent that requires 'linear_token' which the harness doesn't set up.
    // The harness only creates: anthropic_key, github_token, gateway_api_key.
    // When the scheduler validates active agent configs, requireCredentialRef("linear_token")
    // checks the FilesystemBackend and finds no linear_token/default/ directory.
    // This triggers a CredentialError and startScheduler() rejects.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "missing-cred-agent",
          schedule: "0 0 31 2 *",
          config: {
            // This credential is NOT set up by the harness
            credentials: ["anthropic_key", "linear_token"],
          },
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    // Do NOT write linear_token credentials — leave them missing from credentialDir.
    // harness.credentialDir has: anthropic_key, github_token, gateway_api_key only.

    let startError: Error | undefined;
    try {
      await harness.start();
    } catch (err) {
      startError = err instanceof Error ? err : new Error(String(err));
    }

    // Startup should fail due to missing credential
    expect(startError).toBeDefined();
    // The error message should mention the missing credential ref
    expect(startError!.message).toMatch(/linear_token|credential|doctor/i);
  });

  it("scheduler starts successfully when all required credentials are present", async () => {
    // Verify the positive case: when all credentials ARE present, startup succeeds.
    // This ensures the failure in the previous test is due to the missing credential
    // and not some other error.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "all-creds-present-agent",
          schedule: "0 0 31 2 *",
          config: {
            // Only use credentials that the harness sets up
            credentials: ["anthropic_key", "github_token"],
          },
          testScript: "#!/bin/sh\necho 'all credentials present'\nexit 0\n",
        },
      ],
    });

    // No extra credentials needed — harness sets up anthropic_key and github_token
    await expect(harness.start()).resolves.toBeUndefined();

    await harness.triggerAgent("all-creds-present-agent");
    const run = await harness.waitForRunResult("all-creds-present-agent", 120_000);
    expect(run.result).toBe("completed");
  });
});
