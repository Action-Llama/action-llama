/**
 * Integration test: verify that historyRetentionDays global config prunes
 * old stats data on scheduler startup.
 *
 * When the scheduler starts up, `StatsStore.prune(retentionDays)` is called
 * in `createPersistence()` using `globalConfig.historyRetentionDays` (default 14).
 * If `historyRetentionDays=0` is set, all existing runs/receipts/call-edges
 * older than "now" are deleted from the SQLite database.
 *
 * Test scenario:
 *   1. Start scheduler, run an agent, verify stats are recorded.
 *   2. Shutdown scheduler.
 *   3. Update global config.toml to set historyRetentionDays=0.
 *   4. Restart scheduler (prune runs on startup).
 *   5. Verify stats API returns 0 runs for the agent (all pruned).
 *
 * This exercises the `historyRetentionDays` config path in
 * scheduler/persistence.ts (previously untested in integration suite).
 *
 * Covers:
 *   - scheduler/persistence.ts createPersistence() → statsStore.prune()
 *   - stats/store.ts StatsStore.prune()
 *   - historyRetentionDays GlobalConfig field
 */
import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, readFileSync } from "fs";
import { resolve } from "path";
import { stringify as stringifyTOML, parse as parseTOML } from "smol-toml";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";
import { setDefaultBackend } from "@action-llama/action-llama/internals/credentials";
import { FilesystemBackend } from "@action-llama/action-llama/internals/filesystem-backend";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)(
  "integration: historyRetentionDays prunes old stats on startup",
  { timeout: 300_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) await harness.shutdown();
    });

    /** Fetch a stats endpoint with Bearer auth. */
    function statsAPI(h: IntegrationHarness, path: string): Promise<Response> {
      return fetch(`http://127.0.0.1:${h.gatewayPort}${path}`, {
        headers: { Authorization: `Bearer ${h.apiKey}` },
      });
    }

    it(
      "historyRetentionDays=0 prunes all runs on scheduler restart",
      async () => {
        // === Phase 1: start scheduler, run agent, verify stats are recorded ===
        harness = await IntegrationHarness.create({
          agents: [
            {
              name: "retention-agent",
              schedule: "0 0 31 2 *", // never fires by cron
              testScript: "#!/bin/sh\necho 'retention-agent ran'\nexit 0\n",
            },
          ],
        });

        await harness.start();

        // Trigger the agent and wait for it to complete
        await harness.triggerAgent("retention-agent");
        await harness.waitForRunResult("retention-agent");

        // Verify run is in stats
        const beforeRes = await statsAPI(
          harness,
          "/api/stats/agents/retention-agent/runs",
        );
        expect(beforeRes.ok).toBe(true);
        const beforeBody = (await beforeRes.json()) as { runs: unknown[]; total: number };
        expect(beforeBody.total).toBeGreaterThanOrEqual(1);

        // === Phase 2: shut down, patch config to set historyRetentionDays=0 ===
        await harness.shutdown();

        // Restore credential backend for the restart (shutdown() calls resetDefaultBackend())
        setDefaultBackend(new FilesystemBackend(harness.credentialDir));

        // Update the project-level config.toml to set historyRetentionDays=0
        // so that ALL existing runs are pruned on the next startup.
        const projectConfigPath = resolve(harness.projectPath, "config.toml");
        const existingConfig = parseTOML(readFileSync(projectConfigPath, "utf-8")) as Record<
          string,
          unknown
        >;
        existingConfig.historyRetentionDays = 0;
        writeFileSync(projectConfigPath, stringifyTOML(existingConfig));

        // === Phase 3: restart scheduler — prune runs on startup ===
        await harness.start();

        // === Phase 4: verify all runs were pruned ===
        const afterRes = await statsAPI(
          harness,
          "/api/stats/agents/retention-agent/runs",
        );
        expect(afterRes.ok).toBe(true);
        const afterBody = (await afterRes.json()) as { runs: unknown[]; total: number };
        // historyRetentionDays=0 prunes everything — stats should be empty
        expect(afterBody.total).toBe(0);
        expect(afterBody.runs).toHaveLength(0);
      },
    );
  },
);
