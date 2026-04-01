/**
 * Integration tests: Phase 2 (persistence layer) creates the database — no Docker required.
 *
 * When startScheduler() succeeds through Phase 1 (validateAndDiscover) and
 * Phase 2 (createPersistence), the SQLite database is created at
 * <projectPath>/.al/action-llama.db before any Docker operations in Phase 4.
 *
 * In a no-Docker environment, Phase 4 (createContainerRuntime) fails. But
 * Phase 2 already ran and created the database file. This test verifies that:
 *   1. Phase 2 database creation runs successfully without Docker
 *   2. The database file exists at the expected path after a Phase-4 failure
 *   3. Phase 1 validation also runs correctly before Phase 4 fails
 *
 * Note: These tests purposely exercise the scheduler through Phase 3 (gateway start)
 * and reach Phase 4 where Docker check fails. The gateway is started but leaked
 * (scheduler returned error before this._scheduler was assigned). This is acceptable
 * since the port is random and freed on process exit.
 *
 * Covers:
 *   - scheduler/persistence.ts: createPersistence() — SQLite DB created at Phase 2
 *   - shared/paths.ts: dbPath() — returns correct path for .al/action-llama.db
 *   - scheduler/index.ts: phases 1-3 run before Phase 4 Docker check
 */

import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "fs";
import { resolve } from "path";
import { IntegrationHarness } from "./harness.js";

describe(
  "integration: Phase 2 persistence layer runs before Docker check",
  { timeout: 60_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) {
        try { await harness.shutdown(); } catch {}
        harness = undefined as unknown as IntegrationHarness;
      }
    });

    it("creates the SQLite database before Phase 4 Docker check fails", async () => {
      // Phase 2 (createPersistence) runs BEFORE Phase 4 (createContainerRuntime).
      // In a no-Docker environment, Phase 4 fails with AgentError("Docker is not running").
      // The database was already created at <projectPath>/.al/action-llama.db.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "db-check-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      // Database should NOT exist yet (before start)
      const dbPath = resolve(harness.projectPath, ".al", "action-llama.db");
      expect(existsSync(dbPath)).toBe(false);

      // Call start() — will fail at Phase 4 in no-Docker environments
      // OR succeed completely in Docker environments
      let startError: Error | undefined;
      try {
        await harness.start();
      } catch (err) {
        startError = err instanceof Error ? err : new Error(String(err));
      }

      if (startError) {
        // Phase 4 failed (Docker not available) — but Phase 2 already ran
        // The database file should now exist
        expect(existsSync(dbPath)).toBe(true);
        // Error should be Docker-related, NOT database-related
        expect(startError.message).not.toMatch(/database|sqlite|sql/i);
      } else {
        // Scheduler started successfully (Docker available) — database exists
        expect(existsSync(dbPath)).toBe(true);
        await harness.shutdown();
      }
    });

    it("Phase 1 validation succeeds for a well-configured agent before Phase 4", async () => {
      // When Phase 4 fails (Docker not available), all prior phases succeeded.
      // Specifically, Phase 1 (validateAndDiscover) accepted the agent config.
      // This test verifies that a valid agent config passes Phase 1 validation.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "phase-check-agent",
            schedule: "*/5 * * * *",  // valid cron schedule
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

      // In a no-Docker environment, error should be Docker-related (Phase 4)
      // NOT a config validation error (Phase 1)
      if (startError) {
        // Must NOT be a ConfigError or CredentialError
        expect(startError.message).not.toMatch(
          /must have|not found|not defined|invalid|malformed|parse error|credential|no agents/i,
        );
      }
      // In a Docker environment, start succeeds entirely — test trivially passes
    });
  },
);
