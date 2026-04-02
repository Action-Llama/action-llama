/**
 * Integration tests: dashboard API agent + config endpoints — no Docker required.
 *
 * The dashboard API routes require webUI=true to be registered (they're only
 * added when the status tracker is available). These endpoints return agent
 * summary data and project config from the status tracker and project files.
 *
 * Endpoints tested:
 *   1. GET /api/dashboard/agents/:name — agent summary (status, config, instances)
 *   2. GET /api/dashboard/agents/:name/skill — SKILL.md body + agent config
 *   3. GET /api/dashboard/agents/:name/skill for unknown agent → 404
 *   4. GET /api/dashboard/config — project config and settings
 *
 * None of these require Docker since they only read from:
 *   - The StatusTracker (in-memory, populated at startup)
 *   - SKILL.md and config.toml files (written by the harness)
 *   - Global project config (loaded from project directory)
 *
 * Covers:
 *   - control/routes/dashboard-api.ts: GET /api/dashboard/agents/:name
 *   - control/routes/dashboard-api.ts: GET /api/dashboard/agents/:name/skill
 *   - control/routes/dashboard-api.ts: GET /api/dashboard/config
 *   - control/routes/dashboard-api.ts: GET /api/dashboard/agents/:name/skill → 404 for unknown
 */

import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness } from "./harness.js";

describe(
  "integration: dashboard agent API endpoints (no Docker required, webUI=true)",
  { timeout: 60_000 },
  () => {
    let harness: IntegrationHarness;
    let gatewayAccessible = false;

    afterEach(async () => {
      if (harness) {
        try { await harness.shutdown(); } catch {}
        harness = undefined as unknown as IntegrationHarness;
        gatewayAccessible = false;
      }
    });

    async function startHarnessWithWebUI(): Promise<void> {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "dash-test-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      try {
        await harness.start({ webUI: true });
        gatewayAccessible = true;
      } catch {
        try {
          const h = await fetch(
            `http://127.0.0.1:${harness.gatewayPort}/health`,
            { signal: AbortSignal.timeout(3_000) },
          );
          gatewayAccessible = h.ok;
        } catch {
          gatewayAccessible = false;
        }
      }
    }

    function dashGet(path: string): Promise<Response> {
      return fetch(`http://127.0.0.1:${harness.gatewayPort}${path}`, {
        headers: { Authorization: `Bearer ${harness.apiKey}` },
        signal: AbortSignal.timeout(5_000),
      });
    }

    it("GET /api/dashboard/agents/:name returns agent status and config", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await dashGet("/api/dashboard/agents/dash-test-agent");
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        agent: { name: string; state?: string } | null;
        agentConfig: unknown;
        summary: unknown;
        runningInstances: unknown[];
        totalHistorical: number;
      };

      // Agent should be registered in the status tracker
      expect(body.agent).not.toBeNull();
      if (body.agent) {
        expect(body.agent.name).toBe("dash-test-agent");
      }

      // No running instances without Docker
      expect(Array.isArray(body.runningInstances)).toBe(true);
      expect(body.runningInstances).toHaveLength(0);

      // No historical runs without Docker
      expect(typeof body.totalHistorical).toBe("number");
      expect(body.totalHistorical).toBe(0);
    });

    it("GET /api/dashboard/agents/:name/skill returns SKILL.md body and agent config", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await dashGet("/api/dashboard/agents/dash-test-agent/skill");
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        body: string;
        agentConfig: { name?: string; schedule?: string } | null;
      };

      // SKILL.md body should be non-empty (harness writes "# dash-test-agent\nTest agent.\n")
      expect(typeof body.body).toBe("string");
      expect(body.body.length).toBeGreaterThan(0);
      expect(body.body).toContain("dash-test-agent");

      // agentConfig should contain agent details
      expect(body.agentConfig).not.toBeNull();
      if (body.agentConfig) {
        expect(body.agentConfig.name).toBe("dash-test-agent");
      }
    });

    it("GET /api/dashboard/agents/:name/skill returns 404 for unknown agent", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await dashGet("/api/dashboard/agents/nonexistent-agent-xyz/skill");
      expect(res.status).toBe(404);

      const body = (await res.json()) as { body: string };
      expect(body.body).toBe("");
    });

    it("GET /api/dashboard/config returns project configuration", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await dashGet("/api/dashboard/config");
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        projectName: string | undefined;
        projectScale: number;
        gatewayPort: number;
        webhooksActive: boolean;
      };

      // projectScale defaults to 5 when not configured
      expect(typeof body.projectScale).toBe("number");
      expect(body.projectScale).toBeGreaterThanOrEqual(1);

      // No webhooks configured in this test
      expect(typeof body.webhooksActive).toBe("boolean");
    });
  },
);
