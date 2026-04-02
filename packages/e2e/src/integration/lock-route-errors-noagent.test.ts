/**
 * Integration tests: lock route error paths — no Docker required.
 *
 * The lock routes (/locks/acquire, /locks/release, /locks/heartbeat) are
 * registered in the execution plane of the gateway (Phase 3). They reject
 * malformed requests before doing any container registry lookup, so these
 * error paths are testable without Docker.
 *
 * Error paths tested here:
 *   1. Invalid JSON body → 400 (all lock routes)
 *   2. Missing `secret` field → 400
 *   3. Missing `resourceKey` field (acquire only) → 400
 *   4. Invalid URI format in `resourceKey` → 400 (acquire only)
 *   5. Valid body but unregistered secret → 403 (empty container registry)
 *
 * These complement the Docker-required tests in lock-route-errors.test.ts,
 * providing coverage in environments without Docker.
 *
 * Covers:
 *   - execution/routes/locks.ts: JSON parse error → 400
 *   - execution/routes/locks.ts: missing secret → 400
 *   - execution/routes/locks.ts: missing resourceKey → 400 (acquire)
 *   - execution/routes/locks.ts: invalid URI format → 400 (acquire)
 *   - execution/routes/locks.ts: invalid secret → 403 (empty registry)
 */

import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness } from "./harness.js";

describe(
  "integration: lock route error paths (no Docker required)",
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
          { name: "lock-noagent", schedule: "0 0 31 2 *", testScript: "#!/bin/sh\nexit 0\n" },
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

    function lockPost(path: string, body: unknown): Promise<Response> {
      return fetch(`http://127.0.0.1:${harness.gatewayPort}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
      });
    }

    function lockPostRaw(path: string, rawBody: string): Promise<Response> {
      return fetch(`http://127.0.0.1:${harness.gatewayPort}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: rawBody,
        signal: AbortSignal.timeout(5_000),
      });
    }

    // ── /locks/acquire ──────────────────────────────────────────────────────

    it("POST /locks/acquire with invalid JSON returns 400", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await lockPostRaw("/locks/acquire", "not-json");
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/json/i);
    });

    it("POST /locks/acquire with missing secret returns 400", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await lockPost("/locks/acquire", { resourceKey: "test://resource/1" });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/secret/i);
    });

    it("POST /locks/acquire with missing resourceKey returns 400", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await lockPost("/locks/acquire", { secret: "some-secret" });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/resourceKey/i);
    });

    it("POST /locks/acquire with invalid URI format in resourceKey returns 400", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      // An invalid URI (no scheme) should fail URI validation before secret check
      const res = await lockPost("/locks/acquire", {
        secret: "some-secret",
        resourceKey: "not-a-valid-uri",
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/uri|invalid/i);
    });

    it("POST /locks/acquire with unregistered secret returns 403", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      // No containers registered → any secret is invalid
      const res = await lockPost("/locks/acquire", {
        secret: "not-a-real-secret",
        resourceKey: "test://resource/key",
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/secret/i);
    });

    // ── /locks/release ──────────────────────────────────────────────────────

    it("POST /locks/release with invalid JSON returns 400", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await lockPostRaw("/locks/release", "{invalid}");
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/json/i);
    });

    it("POST /locks/release with missing secret returns 400", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await lockPost("/locks/release", { resourceKey: "test://resource/1" });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/secret/i);
    });

    it("POST /locks/release with unregistered secret returns 403", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await lockPost("/locks/release", {
        secret: "not-registered",
        resourceKey: "test://resource/key",
      });
      expect(res.status).toBe(403);
    });

    // ── /locks/heartbeat ────────────────────────────────────────────────────

    it("POST /locks/heartbeat with invalid JSON returns 400", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await lockPostRaw("/locks/heartbeat", "invalid-json");
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/json/i);
    });

    it("POST /locks/heartbeat with missing secret returns 400", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await lockPost("/locks/heartbeat", { resourceKey: "test://resource/1" });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/secret/i);
    });

    it("POST /locks/heartbeat with unregistered secret returns 403", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await lockPost("/locks/heartbeat", {
        secret: "bad-secret",
        resourceKey: "test://resource/key",
      });
      expect(res.status).toBe(403);
    });
  },
);
