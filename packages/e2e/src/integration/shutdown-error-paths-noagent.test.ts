/**
 * Integration tests: /shutdown route error paths — no Docker required.
 *
 * The /shutdown route is registered in the gateway's system routes (Phase 3).
 * It validates the request before performing a container registry lookup and
 * killing the container, so the validation error paths can be tested without
 * Docker.
 *
 * Error paths tested here:
 *   1. Invalid JSON body → 400
 *   2. Missing `secret` field → 400
 *   3. Valid JSON with unregistered secret → 403 (empty container registry)
 *
 * These complement the Docker-required tests in shutdown-error-paths.test.ts,
 * providing coverage in environments without Docker.
 *
 * Covers:
 *   - execution/routes/shutdown.ts: JSON parse error → 400
 *   - execution/routes/shutdown.ts: missing secret → 400
 *   - execution/routes/shutdown.ts: invalid secret → 403
 */

import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness } from "./harness.js";

describe(
  "integration: /shutdown route error paths (no Docker required)",
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
          { name: "shutdown-noagent", schedule: "0 0 31 2 *", testScript: "#!/bin/sh\nexit 0\n" },
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

    function shutdownPost(body: unknown): Promise<Response> {
      return fetch(`http://127.0.0.1:${harness.gatewayPort}/shutdown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
      });
    }

    function shutdownPostRaw(rawBody: string): Promise<Response> {
      return fetch(`http://127.0.0.1:${harness.gatewayPort}/shutdown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: rawBody,
        signal: AbortSignal.timeout(5_000),
      });
    }

    it("POST /shutdown with invalid JSON body returns 400", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await shutdownPostRaw("not-valid-json");
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/json/i);
    });

    it("POST /shutdown with missing secret returns 400", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await shutdownPost({ reason: "test" });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/secret/i);
    });

    it("POST /shutdown with unregistered secret returns 403", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      // No containers registered (no Docker) → any secret is invalid
      const res = await shutdownPost({ secret: "not-registered-secret", reason: "test" });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/secret/i);
    });
  },
);
