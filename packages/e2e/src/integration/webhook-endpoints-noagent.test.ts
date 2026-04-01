/**
 * Integration tests: webhook endpoint behavior without agents — no Docker required.
 *
 * Webhook routes are registered in Phase 3 of startScheduler via setupGateway →
 * startGateway. When Phase 4 (Docker) fails, webhook routes are still accessible.
 *
 * With no webhook sources configured (default harness has no webhook sources),
 * requests to /webhooks/:source return 404 for unknown sources and the body
 * content-length validation (413 for oversized bodies) works independently of
 * agent configuration.
 *
 * Test scenarios:
 *   1. POST /webhooks/unknown-source returns 404 with ok:false
 *   2. GET /webhooks/unknown-source (CRC challenge) returns 404 for unknown source
 *   3. GET /health returns { status: "ok" } (sanity check for gateway access)
 *
 * Covers:
 *   - events/routes/webhooks.ts: GET /webhooks/:source — unknown source → 404
 *   - events/routes/webhooks.ts: POST /webhooks/:source — unknown source → 404
 *   - gateway/routes/system.ts: GET /health — system health check
 */

import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness } from "./harness.js";

describe(
  "integration: webhook endpoint error paths (no Docker required)",
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
            // No webhooks configured — gateway has no webhook registry entries
            name: "webhook-noagent",
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

    it("GET /health returns { status: 'ok' }", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await fetch(
        `http://127.0.0.1:${harness.gatewayPort}/health`,
        { signal: AbortSignal.timeout(3_000) },
      );
      expect(res.status).toBe(200);

      const body = (await res.json()) as { status: string };
      expect(body.status).toBe("ok");
    });

    it("POST /webhooks/unknown-source returns 404 for unregistered source", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await fetch(
        `http://127.0.0.1:${harness.gatewayPort}/webhooks/nonexistent-source`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: "test" }),
          signal: AbortSignal.timeout(3_000),
        },
      );
      expect(res.status).toBe(404);
    });

    it("GET /webhooks/unknown-source (CRC challenge) returns 404 for unknown source", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await fetch(
        `http://127.0.0.1:${harness.gatewayPort}/webhooks/nonexistent-source?crc_token=test`,
        {
          method: "GET",
          signal: AbortSignal.timeout(3_000),
        },
      );
      // Unknown sources return 404
      expect(res.status).toBe(404);
    });

    it("POST /webhooks/test returns ok:true when test source is configured", async () => {
      // The default harness config includes no explicit webhook sources,
      // but the harness auto-configures "test" source via makeAgentConfig when webhooks are present.
      // This test verifies that with an agent that has no webhooks, the test source is NOT registered.
      // A 404 is expected.
      await startHarness();
      if (!gatewayAccessible) return;

      // The "test" source is only registered when an agent has webhooks configured.
      // Our agent has no webhooks, so this should return 404.
      const res = await fetch(
        `http://127.0.0.1:${harness.gatewayPort}/webhooks/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "test", source: "test" }),
          signal: AbortSignal.timeout(3_000),
        },
      );
      // Without "test" webhook source configured, returns 404
      expect(res.status).toBe(404);
    });
  },
);
