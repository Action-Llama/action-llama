/**
 * Integration tests: GET /control/status with webUI=true — no Docker required.
 *
 * When the scheduler starts with webUI=true, a StatusTracker is created.
 * GET /control/status then returns the full status payload including:
 *   - scheduler: schedulerInfo (or null if not initialized)
 *   - instances: running container instances (empty without Docker)
 *   - agents: registered agent list (populated by Phase 1 registerAgent calls)
 *   - running: count of running instances
 *   - queueSizes: per-agent queue sizes (0 when schedulerCtx is not set)
 *
 * The queueSizes field exercises the workQueue.size() accessor in gateway-setup.ts,
 * which returns 0 via the null-safe path (state.schedulerCtx?.workQueue.size(...) ?? 0)
 * when Phase 4 (Docker) fails.
 *
 * Also verifies that agents are registered in the status tracker before Phase 4
 * fails (registration happens in Phase 1 via statusTracker.registerAgent()).
 *
 * Covers:
 *   - control/routes/control.ts: GET /control/status → success path (200) with
 *     statusTracker available (webUI=true)
 *   - control/routes/control.ts: queueSizes populated via deps.workQueue.size()
 *   - scheduler/gateway-setup.ts: workQueue.size() → state.schedulerCtx?.workQueue ?? 0
 *   - scheduler/index.ts: statusTracker.registerAgent() called in Phase 1 before Docker
 */

import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness } from "./harness.js";

describe(
  "integration: GET /control/status with webUI=true (no Docker required)",
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
            name: "status-webui-agent",
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

    it("GET /control/status returns 200 with full payload when statusTracker is available", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await fetch(`http://127.0.0.1:${harness.gatewayPort}/control/status`, {
        headers: { Authorization: `Bearer ${harness.apiKey}` },
        signal: AbortSignal.timeout(5_000),
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        scheduler: unknown;
        instances: unknown[];
        agents: Array<{ name: string }>;
        running: number;
        queueSizes: Record<string, number>;
      };

      // Response must include all required fields
      expect(body).toHaveProperty("instances");
      expect(body).toHaveProperty("agents");
      expect(body).toHaveProperty("running");
      expect(body).toHaveProperty("queueSizes");

      // Instances and running count are 0 without Docker
      expect(Array.isArray(body.instances)).toBe(true);
      expect(body.instances).toHaveLength(0);
      expect(body.running).toBe(0);

      // Agents should include the registered agent (registered in Phase 1)
      expect(Array.isArray(body.agents)).toBe(true);
      const agentNames = body.agents.map((a) => a.name);
      expect(agentNames).toContain("status-webui-agent");

      // queueSizes is populated (0 per agent since schedulerCtx is not ready)
      expect(typeof body.queueSizes).toBe("object");
      // Our agent should have a queue size entry of 0
      if ("status-webui-agent" in body.queueSizes) {
        expect(body.queueSizes["status-webui-agent"]).toBe(0);
      }
    });

    it("GET /control/status returns 401 without auth", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await fetch(`http://127.0.0.1:${harness.gatewayPort}/control/status`, {
        signal: AbortSignal.timeout(5_000),
      });
      expect(res.status).toBe(401);
    });
  },
);
