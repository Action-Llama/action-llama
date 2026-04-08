/**
 * Integration tests: signal route error paths — no Docker required.
 *
 * The signal routes (/signals/rerun, /signals/status, /signals/trigger,
 * /signals/return) are registered in the execution plane of the gateway
 * (Phase 3 of startScheduler). They reject malformed requests before doing
 * any Docker container lookup, so these error paths can be tested without
 * running containers.
 *
 * Error paths tested here (all return before containerRegistry.get()):
 *   1. Invalid JSON body → 400
 *   2. Missing `secret` field → 400
 *   3. Valid JSON with a secret (but no container registered) → 403
 *   4. POST /signals/status: present secret but missing `text` field → 400
 *      (this check happens after secret validation but before registry lookup)
 *
 * These complement the Docker-required tests in signals-error-paths.test.ts,
 * providing coverage in environments without Docker.
 *
 * Covers:
 *   - execution/routes/signals.ts: JSON parse error → 400
 *   - execution/routes/signals.ts: missing secret → 400
 *   - execution/routes/signals.ts: invalid secret → 403 (empty registry)
 *   - execution/routes/signals.ts: POST /signals/status missing text → 400
 *   - For /signals/rerun, /signals/status, /signals/trigger, /signals/return
 */

import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness } from "./harness.js";

describe(
  "integration: signal route error paths (no Docker required)",
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

    async function startHarness(): Promise<void> {
      harness = await IntegrationHarness.create({
        agents: [
          { name: "signal-noagent", schedule: "0 0 31 2 *", testScript: "#!/bin/sh\nexit 0\n" },
        ],
      });

      try {
        await harness.start();
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

    function signalPost(path: string, body: unknown): Promise<Response> {
      return fetch(`http://127.0.0.1:${harness.gatewayPort}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
      });
    }

    function signalPostRaw(path: string, rawBody: string): Promise<Response> {
      return fetch(`http://127.0.0.1:${harness.gatewayPort}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: rawBody,
        signal: AbortSignal.timeout(5_000),
      });
    }

    // ── /signals/rerun ──────────────────────────────────────────────────────

    it("POST /signals/rerun with invalid JSON returns 400", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await signalPostRaw("/signals/rerun", "not-json");
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/json/i);
    });

    it("POST /signals/rerun with missing secret returns 400", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await signalPost("/signals/rerun", {});
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/secret/i);
    });

    it("POST /signals/rerun with unregistered secret returns 403", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      // No containers are registered (no Docker), so any secret is invalid
      const res = await signalPost("/signals/rerun", { secret: "not-a-real-secret" });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/secret/i);
    });

    // ── /signals/status ─────────────────────────────────────────────────────

    it("POST /signals/status with invalid JSON returns 400", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await signalPostRaw("/signals/status", "{bad-json}");
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/json/i);
    });

    it("POST /signals/status with missing secret returns 400", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await signalPost("/signals/status", { text: "hello" });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/secret/i);
    });

    it("POST /signals/status with unregistered secret returns 403", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await signalPost("/signals/status", { secret: "bad-secret", text: "hello" });
      expect(res.status).toBe(403);
    });

    it("POST /signals/status with present secret but missing text returns 400", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      // The text validation check happens BEFORE containerRegistry.get(secret),
      // so a valid-looking secret with no text field returns 400, not 403.
      const res = await signalPost("/signals/status", { secret: "any-secret-value" });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/text/i);
    });

    // ── /signals/trigger ────────────────────────────────────────────────────

    it("POST /signals/trigger with invalid JSON returns 400", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await signalPostRaw("/signals/trigger", "invalid");
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/json/i);
    });

    it("POST /signals/trigger with missing secret returns 400", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await signalPost("/signals/trigger", { targetAgent: "some-agent" });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/secret/i);
    });

    it("POST /signals/trigger with unregistered secret returns 403", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await signalPost("/signals/trigger", {
        secret: "bad-secret",
        targetAgent: "some-agent",
        context: "{}",
      });
      expect(res.status).toBe(403);
    });

    // ── /signals/return ─────────────────────────────────────────────────────

    it("POST /signals/return with invalid JSON returns 400", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await signalPostRaw("/signals/return", "not-valid");
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/json/i);
    });

    it("POST /signals/return with missing secret returns 400", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await signalPost("/signals/return", { value: "result" });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/secret/i);
    });

    it("POST /signals/return with unregistered secret returns 403", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await signalPost("/signals/return", {
        secret: "bad-secret",
        value: "result-value",
      });
      expect(res.status).toBe(403);
    });
  },
);
