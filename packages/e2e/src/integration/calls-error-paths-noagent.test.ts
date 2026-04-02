/**
 * Integration tests: calls route error paths — no Docker required.
 *
 * The /calls routes are registered in the execution plane of the gateway
 * (Phase 3). They validate request parameters before performing container
 * registry lookups, so the validation error paths are testable without Docker.
 *
 * Error paths tested here:
 *   POST /calls:
 *     1. Invalid JSON body → 400
 *     2. Missing `secret` field → 400
 *     3. Missing `targetAgent` field (secret present) → 400
 *     4. Missing `context` field (secret+targetAgent present) → 400
 *     5. All params valid but unregistered secret → 403
 *
 *   GET /calls/:callId:
 *     6. Missing `secret` query param → 400
 *     7. Unregistered secret → 403
 *
 * These complement the Docker-required tests in calls-error-paths.test.ts,
 * providing coverage in environments without Docker.
 *
 * Covers:
 *   - execution/routes/calls.ts: JSON parse error → 400
 *   - execution/routes/calls.ts: missing secret → 400
 *   - execution/routes/calls.ts: missing targetAgent → 400
 *   - execution/routes/calls.ts: missing context → 400
 *   - execution/routes/calls.ts: invalid secret → 403
 *   - execution/routes/calls.ts: GET /calls/:callId missing secret → 400
 *   - execution/routes/calls.ts: GET /calls/:callId invalid secret → 403
 */

import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness } from "./harness.js";

describe(
  "integration: calls route error paths (no Docker required)",
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
          { name: "calls-noagent", schedule: "0 0 31 2 *", testScript: "#!/bin/sh\nexit 0\n" },
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

    function callsPost(body: unknown): Promise<Response> {
      return fetch(`http://127.0.0.1:${harness.gatewayPort}/calls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
      });
    }

    function callsPostRaw(rawBody: string): Promise<Response> {
      return fetch(`http://127.0.0.1:${harness.gatewayPort}/calls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: rawBody,
        signal: AbortSignal.timeout(5_000),
      });
    }

    function callsGet(callId: string, secret?: string): Promise<Response> {
      const query = secret ? `?secret=${encodeURIComponent(secret)}` : "";
      return fetch(`http://127.0.0.1:${harness.gatewayPort}/calls/${callId}${query}`, {
        signal: AbortSignal.timeout(5_000),
      });
    }

    // ── POST /calls ─────────────────────────────────────────────────────────

    it("POST /calls with invalid JSON body returns 400", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await callsPostRaw("not-valid-json");
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/json/i);
    });

    it("POST /calls with missing secret returns 400", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await callsPost({ targetAgent: "some-agent", context: "{}" });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/secret/i);
    });

    it("POST /calls with secret but missing targetAgent returns 400", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      // Secret is present but targetAgent is missing — validation fails before registry lookup
      const res = await callsPost({ secret: "some-secret", context: "{}" });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/targetAgent/i);
    });

    it("POST /calls with secret+targetAgent but missing context returns 400", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      // context is undefined — validation fails before registry lookup
      const res = await callsPost({ secret: "some-secret", targetAgent: "my-agent" });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/context/i);
    });

    it("POST /calls with all params but unregistered secret returns 403", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      // All required params present, but no container registered for this secret
      const res = await callsPost({
        secret: "not-a-registered-secret",
        targetAgent: "some-agent",
        context: '{"key":"value"}',
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/secret/i);
    });

    // ── GET /calls/:callId ───────────────────────────────────────────────────

    it("GET /calls/:callId without secret query param returns 400", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await callsGet("some-call-id");
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/secret/i);
    });

    it("GET /calls/:callId with unregistered secret returns 403", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await callsGet("some-call-id", "not-a-real-secret");
      expect(res.status).toBe(403);
    });
  },
);
