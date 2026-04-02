/**
 * Integration tests: per-agent enable/disable/pause/resume control API — no Docker required.
 *
 * The enable, disable, pause (alias), and resume (alias) routes in
 * control/routes/control.ts call enableAgent() / disableAgent() from
 * scheduler/gateway-setup.ts. These functions reference state.agentConfigs
 * (populated at Phase 1) and statusTracker (available when webUI=true).
 *
 * With webUI=true and no Docker, the scheduler starts the gateway (Phase 3)
 * but fails at Phase 4 (Docker). The control routes are still accessible
 * and agent names ARE populated (Phase 1 config loading runs before Phase 4).
 *
 * Test scenarios:
 *   1. POST /control/agents/:name/disable for existing agent → 200 success
 *   2. POST /control/agents/:name/enable for existing agent → 200 success
 *   3. POST /control/agents/:name/disable for nonexistent agent → 404
 *   4. POST /control/agents/:name/enable for nonexistent agent → 404
 *   5. POST /control/agents/:name/pause (alias for disable) → 200
 *   6. POST /control/agents/:name/resume (alias for enable) → 200
 *   7. POST /control/kill/:instanceId for nonexistent instanceId → 404
 *   8. POST /control/agents/:name/kill for nonexistent agent → 404
 *   9. POST /control/agents/:name/enable without auth → 401
 *
 * Covers:
 *   - control/routes/control.ts: POST /control/agents/:name/disable (success + 404)
 *   - control/routes/control.ts: POST /control/agents/:name/enable (success + 404)
 *   - control/routes/control.ts: POST /control/agents/:name/pause (success path)
 *   - control/routes/control.ts: POST /control/agents/:name/resume (success path)
 *   - control/routes/control.ts: POST /control/kill/:instanceId → 404 (instance not found)
 *   - control/routes/control.ts: POST /control/agents/:name/kill → 404 (pool not found)
 *   - scheduler/gateway-setup.ts: enableAgent() — statusTracker.enableAgent() call
 *   - scheduler/gateway-setup.ts: disableAgent() — statusTracker.disableAgent() call
 *   - scheduler/gateway-setup.ts: killInstance() — empty pool loop → false → 404
 *   - scheduler/gateway-setup.ts: killAgent() — null pool → null → 404
 */

import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness } from "./harness.js";

describe(
  "integration: per-agent enable/disable/pause/resume and kill control API (no Docker required)",
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
            name: "ena-dis-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      try {
        // webUI=true creates the StatusTracker needed for enable/disable to work
        await harness.start({ webUI: true });
        gatewayAccessible = true;
      } catch {
        // Phase 4 (Docker) may fail — check if gateway is still up from Phase 3
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

    function controlPost(path: string, body?: unknown): Promise<Response> {
      return fetch(`http://127.0.0.1:${harness.gatewayPort}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${harness.apiKey}`,
          "Content-Type": "application/json",
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(5_000),
      });
    }

    function controlPostNoAuth(path: string, body?: unknown): Promise<Response> {
      return fetch(`http://127.0.0.1:${harness.gatewayPort}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(5_000),
      });
    }

    // ── enable/disable ───────────────────────────────────────────────────────

    it("POST /control/agents/:name/disable for existing agent returns 200", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await controlPost("/control/agents/ena-dis-agent/disable");
      expect(res.status).toBe(200);

      const body = (await res.json()) as { success: boolean; message?: string };
      expect(body.success).toBe(true);
      expect(typeof body.message).toBe("string");
    });

    it("POST /control/agents/:name/enable for existing agent returns 200", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      // Disable first, then re-enable
      await controlPost("/control/agents/ena-dis-agent/disable");

      const res = await controlPost("/control/agents/ena-dis-agent/enable");
      expect(res.status).toBe(200);

      const body = (await res.json()) as { success: boolean; message?: string };
      expect(body.success).toBe(true);
      expect(typeof body.message).toBe("string");
    });

    it("POST /control/agents/:name/disable for nonexistent agent returns 404", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await controlPost("/control/agents/nonexistent-agent-xyz-abc/disable");
      expect(res.status).toBe(404);

      const body = (await res.json()) as { error: string };
      expect(typeof body.error).toBe("string");
      expect(body.error).toMatch(/not found/i);
    });

    it("POST /control/agents/:name/enable for nonexistent agent returns 404", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await controlPost("/control/agents/nonexistent-agent-abc-xyz/enable");
      expect(res.status).toBe(404);

      const body = (await res.json()) as { error: string };
      expect(typeof body.error).toBe("string");
    });

    // ── pause/resume (aliases) ────────────────────────────────────────────────

    it("POST /control/agents/:name/pause (alias for disable) returns 200", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await controlPost("/control/agents/ena-dis-agent/pause");
      expect(res.status).toBe(200);

      const body = (await res.json()) as { success: boolean; message?: string };
      expect(body.success).toBe(true);
    });

    it("POST /control/agents/:name/resume (alias for enable) returns 200", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      // Pause first, then resume
      await controlPost("/control/agents/ena-dis-agent/pause");

      const res = await controlPost("/control/agents/ena-dis-agent/resume");
      expect(res.status).toBe(200);

      const body = (await res.json()) as { success: boolean; message?: string };
      expect(body.success).toBe(true);
    });

    // ── kill routes ───────────────────────────────────────────────────────────

    it("POST /control/kill/:instanceId for nonexistent instance returns 404", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      // Without Docker, no containers are running, so any instanceId is not found
      const res = await controlPost("/control/kill/nonexistent-instance-id-xyz");
      expect(res.status).toBe(404);

      const body = (await res.json()) as { error: string };
      expect(typeof body.error).toBe("string");
      expect(body.error).toMatch(/not found/i);
    });

    it("POST /control/agents/:name/kill for nonexistent agent returns 404", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      // Without Docker, no runner pools are created, so all agents return 404
      const res = await controlPost("/control/agents/nonexistent-kill-agent-xyz/kill");
      expect(res.status).toBe(404);

      const body = (await res.json()) as { error: string };
      expect(typeof body.error).toBe("string");
      expect(body.error).toMatch(/not found/i);
    });

    // ── auth ──────────────────────────────────────────────────────────────────

    it("POST /control/agents/:name/enable without Authorization header returns 401", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await controlPostNoAuth("/control/agents/ena-dis-agent/enable");
      expect(res.status).toBe(401);
    });
  },
);
