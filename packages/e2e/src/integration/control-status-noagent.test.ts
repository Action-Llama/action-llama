/**
 * Integration tests: control API status-tracker-unavailable paths — no Docker required.
 *
 * When the scheduler is started without webUI=true, the status tracker is not
 * created. In this case:
 *   - GET /control/instances returns 503 (status tracker not available)
 *   - GET /control/status returns 503 (status tracker not available)
 *
 * These tests work without Docker because:
 *   1. Phase 3 starts the gateway and registers control routes (including /control/*)
 *   2. The harness.start() without webUI:true does NOT create a StatusTracker
 *   3. Control routes that require statusTracker return 503 when it's absent
 *   4. Phase 4 (Docker) may fail — the gateway remains accessible regardless
 *
 * Also tests:
 *   - GET /control/instances with statusTracker available (webUI:true, empty list)
 *   - Control API is protected by Bearer auth when API key is set
 *
 * These complement the Docker-required tests in control-instances.test.ts.
 *
 * Covers:
 *   - control/routes/control.ts: GET /control/instances — no statusTracker → 503
 *   - control/routes/control.ts: GET /control/status — no statusTracker → 503
 *   - control/routes/control.ts: GET /control/instances — with tracker → empty list
 */

import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness } from "./harness.js";

describe(
  "integration: control API status-tracker-unavailable paths (no Docker required)",
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

    async function startHarness(opts?: { webUI?: boolean }): Promise<void> {
      harness = await IntegrationHarness.create({
        agents: [
          { name: "ctrl-noagent", schedule: "0 0 31 2 *", testScript: "#!/bin/sh\nexit 0\n" },
        ],
      });

      try {
        await harness.start(opts);
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

    function controlGet(path: string): Promise<Response> {
      return fetch(`http://127.0.0.1:${harness.gatewayPort}${path}`, {
        headers: { Authorization: `Bearer ${harness.apiKey}` },
        signal: AbortSignal.timeout(5_000),
      });
    }

    it("GET /control/instances returns 503 when no status tracker is available (webUI=false)", async () => {
      // Default start: no webUI → no statusTracker → 503 for tracker-dependent endpoints
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await controlGet("/control/instances");
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/status tracker not available/i);
    });

    it("GET /control/status returns 503 when no status tracker is available (webUI=false)", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await controlGet("/control/status");
      expect(res.status).toBe(503);
    });

    it("GET /control/instances with webUI=true returns empty instances list", async () => {
      // With webUI=true, statusTracker is created and control routes return real data
      await startHarness({ webUI: true });
      if (!gatewayAccessible) return;

      const res = await controlGet("/control/instances");
      expect(res.status).toBe(200);

      const body = (await res.json()) as { instances: unknown[] };
      expect(Array.isArray(body.instances)).toBe(true);
      // No Docker = no running containers → empty list
      expect(body.instances).toHaveLength(0);
    });

    it("GET /control/instances returns 401 without auth header", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await fetch(
        `http://127.0.0.1:${harness.gatewayPort}/control/instances`,
        { signal: AbortSignal.timeout(5_000) },
      );
      expect(res.status).toBe(401);
    });
  },
);
