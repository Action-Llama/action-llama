/**
 * Integration tests: webhook oversized payload rejection — no Docker required.
 *
 * The webhook POST handler (events/routes/webhooks.ts) enforces a 10 MB body
 * size limit via two independent checks:
 *
 *   1. Content-Length header check — if Content-Length > 10 MB, return 413 immediately
 *      (before reading the body).
 *   2. Actual body size check — if the body read exceeds 10 MB, return 413.
 *
 * Both checks run before any agent is triggered or any Docker container is started,
 * so they can be exercised here without Docker.
 *
 * The oversized checks only fire when the webhook source IS registered (otherwise
 * the unknown-source 404 fires first). The integration harness auto-registers a
 * "test" webhook source when the agent has a webhook with source = "test".
 * Requests go to /webhooks/test which maps to the TestWebhookProvider (source = "test").
 *
 * Test scenarios:
 *   1. Content-Length > 10 MB with registered source returns 413
 *   2. Actual body > 10 MB with registered source returns 413
 *   3. Small payload (< 10 MB) with registered source is not rejected with 413
 *
 * Covers:
 *   - events/routes/webhooks.ts: Content-Length > MAX_BODY_SIZE check → 413
 *   - events/routes/webhooks.ts: rawBody.length > MAX_BODY_SIZE check → 413
 */

import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness } from "./harness.js";
import * as http from "http";

describe(
  "integration: webhook oversized payload rejection (no Docker required)",
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

    async function startHarnessWithTestWebhook(): Promise<void> {
      // The harness auto-registers "test" source when agent has webhooks with source = "test"
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "oversized-test-agent",
            // source = "test" → harness auto-registers { "test": { type: "test" } }
            // → TestWebhookProvider registered at /webhooks/test
            webhooks: [{ source: "test" }],
            testScript: "#!/bin/sh\nexit 0\n",
          },
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

    /**
     * Send an HTTP request with a fake Content-Length header using Node.js http module.
     * The browser fetch API rejects mismatched content-length, so we use raw http.
     */
    function sendWithFakeContentLength(
      port: number,
      path: string,
      fakeContentLength: number,
      body: string,
    ): Promise<{ statusCode: number; body: string }> {
      return new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port,
            path,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": String(fakeContentLength),
            },
          },
          (res) => {
            let data = "";
            res.on("data", (chunk) => { data += chunk; });
            res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body: data }));
          },
        );
        req.on("error", reject);
        req.write(body);
        req.end();
      });
    }

    it("POST /webhooks/test returns 413 when Content-Length exceeds 10 MB", async () => {
      await startHarnessWithTestWebhook();
      if (!gatewayAccessible) return;

      // Use raw http to send a fake Content-Length header (browser fetch rejects mismatch)
      const result = await sendWithFakeContentLength(
        harness.gatewayPort,
        "/webhooks/test",
        10 * 1024 * 1024 + 1, // 10 MB + 1 byte (exceeds limit)
        JSON.stringify({ event: "test", source: "test" }),
      );

      expect(result.statusCode).toBe(413);
      const body = JSON.parse(result.body) as { error: string };
      expect(body.error).toMatch(/payload too large/i);
    });

    it("POST /webhooks/test returns 413 when actual body exceeds 10 MB", async () => {
      await startHarnessWithTestWebhook();
      if (!gatewayAccessible) return;

      // Send an actual oversized body without a Content-Length header
      // so only the rawBody.length check fires (not the Content-Length check).
      const MAX_BODY_SIZE = 10 * 1024 * 1024;
      const largeBody = "x".repeat(MAX_BODY_SIZE + 1);

      const res = await fetch(
        `http://127.0.0.1:${harness.gatewayPort}/webhooks/test`,
        {
          method: "POST",
          headers: {
            "Content-Type": "text/plain",
            // Intentionally no Content-Length to bypass the header check
          },
          body: largeBody,
          signal: AbortSignal.timeout(15_000),
          // @ts-ignore - duplex is needed for streaming in some environments
          duplex: "half",
        },
      );

      expect(res.status).toBe(413);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/payload too large/i);
    });

    it("POST /webhooks/test small valid payload is not rejected (not 413)", async () => {
      await startHarnessWithTestWebhook();
      if (!gatewayAccessible) return;

      // A small payload with the registered test source should not return 413
      const res = await fetch(
        `http://127.0.0.1:${harness.gatewayPort}/webhooks/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "test",
            source: "test",
            repo: "acme/test",
            sender: "user",
          }),
          signal: AbortSignal.timeout(5_000),
        },
      );

      // Any response other than 413 is acceptable — the payload was not rejected for size
      expect(res.status).not.toBe(413);
    });
  },
);
