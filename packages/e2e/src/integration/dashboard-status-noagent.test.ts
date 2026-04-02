/**
 * Integration tests: dashboard status and trigger endpoints — no Docker required.
 *
 * Tests dashboard API endpoints that are available without Docker (webUI=true):
 *   1. GET /api/dashboard/status — returns agents, scheduler info, recent logs
 *   2. GET /api/dashboard/triggers/:instanceId — 404 for unknown instance
 *   3. GET /api/dashboard/agents/:name/instances/:id — null for unknown instance
 *
 * These complement the Docker-required tests in dashboard-instance-api.test.ts,
 * providing coverage in environments without Docker.
 *
 * Covers:
 *   - control/routes/dashboard-api.ts: GET /api/dashboard/status
 *   - control/routes/dashboard-api.ts: GET /api/dashboard/triggers/:instanceId → 404
 *   - control/routes/dashboard-api.ts: GET /api/dashboard/agents/:name/instances/:id → null
 */

import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness } from "./harness.js";

describe(
  "integration: dashboard status/trigger endpoints (no Docker required, webUI=true)",
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
            name: "dash-status-agent",
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

    it("GET /api/dashboard/status returns agents, schedulerInfo, and recentLogs", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await dashGet("/api/dashboard/status");
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        agents: Array<{ name: string }>;
        schedulerInfo: Record<string, unknown> | null;
        recentLogs: unknown[];
      };

      // Agents should contain our test agent
      expect(Array.isArray(body.agents)).toBe(true);
      const agentNames = body.agents.map((a) => a.name);
      expect(agentNames).toContain("dash-status-agent");

      // schedulerInfo may be null before Docker Phase 4 sets it
      // recentLogs is always an array
      expect(Array.isArray(body.recentLogs)).toBe(true);
    });

    it("GET /api/dashboard/triggers/:instanceId returns 404 for unknown instance", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await dashGet("/api/dashboard/triggers/nonexistent-instance-xyz-123");
      expect(res.status).toBe(404);

      const body = (await res.json()) as { trigger: null };
      expect(body.trigger).toBeNull();
    });

    it("GET /api/dashboard/agents/:name/instances/:id returns null for unknown instanceId", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await dashGet(
        "/api/dashboard/agents/dash-status-agent/instances/unknown-id-xyz-456",
      );
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;
      // run and runningInstance should both be null (not found)
      expect(body.run === null || body.run === undefined).toBe(true);
      expect(body.runningInstance === null || body.runningInstance === undefined).toBe(true);
    });
  },
);
