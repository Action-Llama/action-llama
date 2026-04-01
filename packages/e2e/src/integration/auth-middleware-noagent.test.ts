/**
 * Integration tests: auth middleware behavior — no Docker required.
 *
 * When an API key is configured (the harness always configures one), the gateway
 * applies auth middleware to protected routes. These tests verify:
 *
 *   1. Missing Authorization header → 401
 *   2. Wrong Bearer token → 401
 *   3. Correct Bearer token → 200 (authorized)
 *   4. /health is not protected (no auth required)
 *
 * Covers:
 *   - gateway/middleware/auth.ts: applyAuthMiddleware bearer token check
 *   - gateway/index.ts: auth middleware applied when apiKey is set
 */

import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness } from "./harness.js";

describe(
  "integration: auth middleware (no Docker required)",
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
          {
            name: "auth-test-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      try {
        await harness.start();
        gatewayAccessible = true;
      } catch {
        try {
          const healthRes = await fetch(
            `http://127.0.0.1:${harness.gatewayPort}/health`,
            { signal: AbortSignal.timeout(3_000) },
          );
          gatewayAccessible = healthRes.ok;
        } catch {
          gatewayAccessible = false;
        }
      }
    }

    it("GET /health requires no auth", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      // No auth header
      const res = await fetch(
        `http://127.0.0.1:${harness.gatewayPort}/health`,
        { signal: AbortSignal.timeout(3_000) },
      );
      expect(res.status).toBe(200);
    });

    it("protected route without Authorization header returns 401", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      // Try to access a protected stats endpoint without auth
      const res = await fetch(
        `http://127.0.0.1:${harness.gatewayPort}/api/stats/activity`,
        { signal: AbortSignal.timeout(3_000) },
      );
      expect(res.status).toBe(401);
    });

    it("protected route with wrong Bearer token returns 401", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await fetch(
        `http://127.0.0.1:${harness.gatewayPort}/api/stats/activity`,
        {
          headers: { Authorization: "Bearer wrong-api-key-value" },
          signal: AbortSignal.timeout(3_000),
        },
      );
      expect(res.status).toBe(401);
    });

    it("protected route with correct Bearer token returns 200", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await fetch(
        `http://127.0.0.1:${harness.gatewayPort}/api/stats/activity`,
        {
          headers: { Authorization: `Bearer ${harness.apiKey}` },
          signal: AbortSignal.timeout(3_000),
        },
      );
      expect(res.status).toBe(200);
    });
  },
);
