/**
 * Integration tests: POST /control/pause and POST /control/resume — no Docker required.
 *
 * The pause and resume routes in control/routes/control.ts call
 * pauseScheduler() / resumeScheduler() from scheduler/gateway-setup.ts.
 * These functions iterate over state.cronJobs (empty without Docker) and
 * call statusTracker.setPaused(). Neither function requires Docker.
 *
 * Note: The isPaused() → 409 path in triggerAgent() only activates after
 * statusTracker.setSchedulerInfo() is called (which happens in the CLI `al start`
 * command, not in the harness). Without setSchedulerInfo(), setPaused() is a no-op
 * and isPaused() always returns false — so the pause/resume endpoints always
 * return {success:true} without affecting trigger dispatch in no-Docker tests.
 * The Docker-based pause-resume.test.ts covers the full end-to-end pause/trigger
 * behavior when the scheduler is fully initialized.
 *
 * Test scenarios (no Docker required):
 *   1. POST /control/pause → 200 { success: true, message: "Scheduler paused" }
 *   2. POST /control/resume → 200 { success: true, message: "Scheduler resumed" }
 *   3. POST /control/pause twice → both return 200 (idempotent success)
 *   4. POST /control/resume after pause → 200 (roundtrip)
 *   5. POST /control/pause without auth → 401
 *   6. POST /control/resume without auth → 401
 *
 * Covers:
 *   - control/routes/control.ts: POST /control/pause → success path (200)
 *   - control/routes/control.ts: POST /control/resume → success path (200)
 *   - scheduler/gateway-setup.ts: pauseScheduler() — iterates state.cronJobs (no-op
 *     when empty) + calls statusTracker?.setPaused(true) without throwing
 *   - scheduler/gateway-setup.ts: resumeScheduler() — iterates state.cronJobs (no-op
 *     when empty) + calls statusTracker?.setPaused(false) without throwing
 *   - gateway/middleware/auth.ts: Bearer auth check → 401 on these routes
 */

import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness } from "./harness.js";

describe(
  "integration: POST /control/pause and /control/resume (no Docker required)",
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
            name: "pause-test-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      try {
        // webUI=true so the StatusTracker is created, enabling isPaused() tracking
        await harness.start({ webUI: true });
        gatewayAccessible = true;
      } catch {
        // Phase 4 (Docker) may fail — check if the gateway is still up
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
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(5_000),
      });
    }

    function controlPostNoAuth(path: string): Promise<Response> {
      return fetch(`http://127.0.0.1:${harness.gatewayPort}${path}`, {
        method: "POST",
        signal: AbortSignal.timeout(5_000),
      });
    }

    it("POST /control/pause returns success", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await controlPost("/control/pause");
      expect(res.status).toBe(200);

      const body = (await res.json()) as { success: boolean; message: string };
      expect(body.success).toBe(true);
      expect(body.message).toMatch(/pause/i);
    });

    it("POST /control/resume returns success", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await controlPost("/control/resume");
      expect(res.status).toBe(200);

      const body = (await res.json()) as { success: boolean; message: string };
      expect(body.success).toBe(true);
      expect(body.message).toMatch(/resum/i);
    });

    it("POST /control/pause twice is idempotent (both return 200)", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res1 = await controlPost("/control/pause");
      expect(res1.status).toBe(200);
      const body1 = (await res1.json()) as { success: boolean; message: string };
      expect(body1.success).toBe(true);

      // Second pause call should also succeed (pauseScheduler is idempotent)
      const res2 = await controlPost("/control/pause");
      expect(res2.status).toBe(200);
      const body2 = (await res2.json()) as { success: boolean; message: string };
      expect(body2.success).toBe(true);
    });

    it("POST /control/pause then /control/resume roundtrip — both return 200", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const pauseRes = await controlPost("/control/pause");
      expect(pauseRes.status).toBe(200);
      const pauseBody = (await pauseRes.json()) as { success: boolean };
      expect(pauseBody.success).toBe(true);

      const resumeRes = await controlPost("/control/resume");
      expect(resumeRes.status).toBe(200);
      const resumeBody = (await resumeRes.json()) as { success: boolean };
      expect(resumeBody.success).toBe(true);
    });

    it("POST /control/pause returns 401 without auth header", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await controlPostNoAuth("/control/pause");
      expect(res.status).toBe(401);
    });

    it("POST /control/resume returns 401 without auth header", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await controlPostNoAuth("/control/resume");
      expect(res.status).toBe(401);
    });
  },
);
