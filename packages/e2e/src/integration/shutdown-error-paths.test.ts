/**
 * Integration test: verify the /shutdown route error paths.
 *
 * The POST /shutdown route is an internal container-to-scheduler route used
 * by the container process to request termination (e.g., via al-shutdown).
 * The route validates the secret before killing the container.
 *
 * Error paths tested:
 *   - Invalid JSON body → 400
 *   - Missing secret → 400
 *   - Invalid secret (not in registry) → 403
 *
 * These error branches are not exercised by the al-shutdown integration tests
 * (which only test the happy path via the shell command).
 *
 * Covers: execution/routes/shutdown.ts (400 and 403 error paths)
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)(
  "integration: /shutdown route error paths",
  { timeout: 180_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) await harness.shutdown();
    });

    function shutdownPost(h: IntegrationHarness, body: Record<string, unknown>): Promise<Response> {
      return fetch(`http://127.0.0.1:${h.gatewayPort}/shutdown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    it("POST /shutdown with invalid JSON body returns 400", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "shutdown-badjson-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      await harness.start();

      const res = await fetch(`http://127.0.0.1:${harness.gatewayPort}/shutdown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json {{{",
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("JSON");
    });

    it("POST /shutdown with missing secret returns 400", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "shutdown-nosecret-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      await harness.start();

      // No secret field
      const res = await shutdownPost(harness, {
        reason: "test shutdown",
        // secret is missing
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("secret");
    });

    it("POST /shutdown with invalid secret returns 403", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "shutdown-badsecret-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      await harness.start();

      // Invalid secret (not in registry)
      const res = await shutdownPost(harness, {
        secret: "completely-invalid-secret-xyz",
        reason: "test shutdown",
      });
      expect(res.status).toBe(403);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("secret");
    });
  },
);
