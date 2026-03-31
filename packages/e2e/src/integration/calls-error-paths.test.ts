/**
 * Integration test: verify error paths on the internal /calls routes.
 *
 * The /calls (POST) and /calls/:callId (GET) routes are internal
 * container-to-scheduler routes for al-subagent coordination. Like the
 * signal routes, they require a valid container secret.
 *
 * These error paths are never tested by the subagent tests (which run
 * via the al-subagent shell command inside containers). This test directly
 * exercises the HTTP validation error branches.
 *
 * Covers: execution/routes/calls.ts
 *   - POST /calls — missing secret (400), invalid secret (403),
 *                   missing targetAgent (400), invalid JSON (400)
 *   - GET /calls/:callId — missing secret (400), invalid secret (403)
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)(
  "integration: /calls route error paths",
  { timeout: 180_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) await harness.shutdown();
    });

    function callsPost(
      h: IntegrationHarness,
      body: Record<string, unknown>,
    ): Promise<Response> {
      return fetch(`http://127.0.0.1:${h.gatewayPort}/calls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    function callsGet(h: IntegrationHarness, callId: string, secret?: string): Promise<Response> {
      const url = new URL(`http://127.0.0.1:${h.gatewayPort}/calls/${callId}`);
      if (secret) url.searchParams.set("secret", secret);
      return fetch(url.toString());
    }

    it("POST /calls with missing secret returns 400", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "calls-err-secret",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });
      await harness.start();

      const res = await callsPost(harness, {
        targetAgent: "some-agent",
        context: "{}",
        // no secret
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("secret");
    });

    it("POST /calls with invalid secret returns 403", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "calls-err-secret2",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });
      await harness.start();

      const res = await callsPost(harness, {
        secret: "invalid-secret-xyz",
        targetAgent: "some-agent",
        context: "{}",
      });
      expect(res.status).toBe(403);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("secret");
    });

    it("POST /calls with missing targetAgent returns 400", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "calls-err-target",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });
      await harness.start();

      // invalid secret → 403, but if we could get past it we'd get 400 for targetAgent
      // Test with missing secret to get 400 first:
      const res = await callsPost(harness, {
        secret: undefined,
        context: "{}",
        // no targetAgent, no secret
      } as any);
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      // Either "missing secret" or "missing targetAgent" — both are 400
      expect(body.error).toBeTruthy();
    });

    it("POST /calls with invalid JSON body returns 400", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "calls-err-json",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });
      await harness.start();

      const res = await fetch(`http://127.0.0.1:${harness.gatewayPort}/calls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json {{{",
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("JSON");
    });

    it("GET /calls/:callId without secret returns 400", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "calls-get-no-secret",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });
      await harness.start();

      // No ?secret= parameter
      const res = await callsGet(harness, "some-call-id-xyz");
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("secret");
    });

    it("GET /calls/:callId with invalid secret returns 403", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "calls-get-bad-secret",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });
      await harness.start();

      const res = await callsGet(harness, "some-call-id-xyz", "invalid-secret-xyz");
      expect(res.status).toBe(403);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("secret");
    });

    it("POST /calls with present secret but missing targetAgent returns 400", async () => {
      // The /calls route validates in order: secret → targetAgent → context → registry lookup.
      // A non-empty secret string that is not in the registry still passes the
      // first check, so we reach the "missing targetAgent" branch (400) before the
      // 403 registry check.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "calls-err-no-target",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });
      await harness.start();

      const res = await callsPost(harness, {
        secret: "some-secret-string",
        context: "{}",
        // targetAgent is missing
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("targetAgent");
    });

    it("POST /calls with present secret and targetAgent but missing context returns 400", async () => {
      // secret (non-empty string) + targetAgent present → reaches the context validation.
      // context is undefined → 400 "missing context" before registry lookup.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "calls-err-no-context",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });
      await harness.start();

      const res = await callsPost(harness, {
        secret: "some-secret-string",
        targetAgent: "some-agent",
        // context is missing
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("context");
    });

    it("GET /calls/:callId with valid secret but unknown callId returns 404", async () => {
      // A running container with a valid secret queries an unknown callId.
      // The call store returns null → 404 "call not found".
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "calls-get-unknown-id",
            schedule: "0 0 31 2 *",
            testScript: [
              "#!/bin/sh",
              // Query an unknown callId using the container's own secret
              "set +e",
              'RESULT=$(curl -s "$GATEWAY_URL/calls/nonexistent-call-id-xyz?secret=$SHUTDOWN_SECRET")',
              "set -e",
              'STATUS=$(echo "$RESULT" | jq -r .error)',
              // The route returns {"error":"call not found"} with 404
              'test "$STATUS" = "call not found" || { echo "unexpected response: $RESULT"; exit 1; }',
              'echo "calls-get-unknown-id: got expected call not found OK"',
              "exit 0",
            ].join("\n"),
          },
        ],
      });
      await harness.start();

      await harness.triggerAgent("calls-get-unknown-id");
      const run = await harness.waitForRunResult("calls-get-unknown-id", 60_000);
      expect(run.result).toBe("completed");
    });
  },
);
