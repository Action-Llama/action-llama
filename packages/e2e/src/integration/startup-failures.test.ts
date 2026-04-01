/**
 * Integration tests: scheduler startup failure paths that do NOT require Docker.
 *
 * All test cases here exercise validateAndDiscover() in Phase 1 of startScheduler().
 * Phase 1 runs before Phase 2 (persistence/SQLite), Phase 3 (gateway), and
 * Phase 4 (Docker). So these tests work in any environment, with or without Docker.
 *
 * Why this file exists (no skipIf(!DOCKER) guard):
 *   The existing integration tests in scheduler-validation.test.ts, no-agents-found.test.ts,
 *   missing-credential.test.ts, etc. guard on isDockerAvailable() even for failure cases
 *   that don't reach Phase 4. This file runs those same paths unconditionally, exercising
 *   the real scheduler validation logic with a real FilesystemBackend (no mocks).
 *
 * Covers (with real implementations, not mocked):
 *   - scheduler/validation.ts: validateAndDiscover() — multiple failure paths
 *   - shared/config/validate.ts: validateAgentConfig() — schedule/webhook requirement
 *   - shared/config/load-agent.ts: discoverAgents() — empty directory
 *   - shared/credentials.ts: requireCredentialRef() — real FilesystemBackend lookup
 *   - shared/errors.ts: ConfigError, CredentialError propagation through startScheduler
 */

import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { IntegrationHarness } from "./harness.js";
import { makeModel } from "./helpers.js";

describe("integration: scheduler startup failures (no Docker required)", { timeout: 60_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) {
      try { await harness.shutdown(); } catch {}
      harness = undefined as unknown as IntegrationHarness;
    }
  });

  it("rejects when no agent directories exist in the project", async () => {
    // Create a harness with an empty agents array — no agent directories are created.
    // discoverAgents() returns [] → validateAndDiscover() throws ConfigError.
    harness = await IntegrationHarness.create({
      agents: [],
    });

    let startError: Error | undefined;
    try {
      await harness.start();
    } catch (err) {
      startError = err instanceof Error ? err : new Error(String(err));
    }

    expect(startError, "expected startScheduler to throw").toBeDefined();
    expect(startError!.message).toMatch(/no agents|al new/i);
  });

  it("rejects when an agent config has no schedule and no webhooks", async () => {
    // An agent with no schedule and no webhooks (scale defaults to 1) is invalid.
    // validateAgentConfig() in shared/config/validate.ts throws ConfigError.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "no-triggers-agent",
          // Deliberately omit schedule and webhooks
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    let startError: Error | undefined;
    try {
      await harness.start();
    } catch (err) {
      startError = err instanceof Error ? err : new Error(String(err));
    }

    expect(startError, "expected startScheduler to throw").toBeDefined();
    expect(startError!.message).toMatch(/schedule|webhooks/i);
  });

  it("rejects when an agent model uses pi_auth (not supported in container mode)", async () => {
    // pi_auth requires access to the host authentication storage, which is unavailable
    // inside Docker containers. validateAndDiscover() enforces this restriction.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "pi-auth-agent",
          schedule: "0 0 31 2 *", // won't run — very distant schedule
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        models: {
          sonnet: makeModel({ authType: "pi_auth" }),
        },
      },
    });

    let startError: Error | undefined;
    try {
      await harness.start();
    } catch (err) {
      startError = err instanceof Error ? err : new Error(String(err));
    }

    expect(startError, "expected startScheduler to throw").toBeDefined();
    expect(startError!.message).toMatch(/pi_auth/i);
  });

  it("rejects when an agent references a credential not in the store", async () => {
    // The harness credential store holds: anthropic_key, github_token, gateway_api_key.
    // An agent that requires 'stripe_secret' will fail requireCredentialRef().
    // This exercises the REAL FilesystemBackend lookup — no credential mocks.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "missing-cred-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
          config: {
            credentials: ["stripe_secret"],  // not in harness credential store
          },
        },
      ],
    });

    let startError: Error | undefined;
    try {
      await harness.start();
    } catch (err) {
      startError = err instanceof Error ? err : new Error(String(err));
    }

    expect(startError, "expected startScheduler to throw").toBeDefined();
    // The error should mention the missing credential type
    expect(startError!.message).toMatch(/stripe_secret|credential/i);
  });

  it("rejects when the project global config.toml has invalid TOML syntax", async () => {
    // A malformed global config.toml causes loadGlobalConfig() to throw ConfigError
    // before validateAndDiscover() is ever called.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "valid-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    // Overwrite the global config with invalid TOML
    writeFileSync(
      resolve(harness.projectPath, "config.toml"),
      "this is not [[valid toml syntax [[[",
    );

    let startError: Error | undefined;
    try {
      await harness.start();
    } catch (err) {
      startError = err instanceof Error ? err : new Error(String(err));
    }

    expect(startError, "expected startScheduler to throw").toBeDefined();
    // Should report a config/parse error
    expect(startError!.message).toBeTruthy();
  });
});
