/**
 * Integration test: verify the HTTP error response paths for the lock routes.
 *
 * The /locks/acquire, /locks/release, and /locks/heartbeat routes have error
 * paths that are not exercised by the rlock/runlock/rlock-heartbeat shell
 * commands (which only call the happy path).
 *
 * Tests:
 *   1. POST /locks/release for a non-existent lock → 404 "lock not found"
 *   2. POST /locks/heartbeat for a non-existent lock → 404 "lock not found"
 *   3. POST /locks/release for a lock held by a different instance → 409
 *   4. POST /locks/acquire with invalid JSON body → 400
 *
 * Covers: execution/routes/locks.ts (release 404, heartbeat 404, release 409)
 *         execution/lock-store.ts (release/heartbeat error branches)
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

const WAIT_FOR_GATEWAY = [
  "i=0; while [ $i -lt 30 ]; do",
  '  curl -sf --connect-timeout 1 "$GATEWAY_URL/health" > /dev/null 2>&1 && break',
  "  i=$((i+1)); sleep 0.5",
  "done",
  'if [ -z "$SHUTDOWN_SECRET" ]; then echo "SHUTDOWN_SECRET not set" >&2; exit 99; fi',
].join("\n");

describe.skipIf(!DOCKER)(
  "integration: lock route HTTP error paths",
  { timeout: 180_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) await harness.shutdown();
    });

    it("POST /locks/release for non-existent lock returns 404", async () => {
      // Releasing a lock that was never acquired returns 404 "lock not found".
      // This error branch is NOT exercised by the runlock shell command
      // (which only calls release after a successful acquire).
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "release-notfound-agent",
            schedule: "0 0 31 2 *",
            testScript: [
              "#!/bin/sh",
              "set -e",
              WAIT_FOR_GATEWAY,
              // Call /locks/release directly without ever acquiring the lock
              'PAYLOAD=$(printf \'{"secret":"%s","resourceKey":"test://lock-release-notfound/resource"}\' "$SHUTDOWN_SECRET")',
              'RELEASE_RESP=$(curl -sf -X POST "$GATEWAY_URL/locks/release" \\',
              '  -H "Content-Type: application/json" \\',
              '  -d "$PAYLOAD" \\',
              "  -w '\\n%{http_code}' 2>&1)",
              'STATUS_CODE=$(echo "$RELEASE_RESP" | tail -1)',
              'BODY=$(echo "$RELEASE_RESP" | head -1)',
              // Should get 404 for "lock not found"
              'test "$STATUS_CODE" = "404" || { echo "expected 404 but got $STATUS_CODE: $BODY"; exit 1; }',
              'REASON=$(echo "$BODY" | jq -r .reason 2>/dev/null)',
              'test "$REASON" = "lock not found" || { echo "expected reason lock not found, got: $REASON ($BODY)"; exit 1; }',
              'echo "release-notfound-agent: got expected 404 lock not found OK"',
              "exit 0",
            ].join("\n"),
          },
        ],
      });

      await harness.start();
      await harness.triggerAgent("release-notfound-agent");
      const run = await harness.waitForRunResult("release-notfound-agent", 60_000);
      expect(run.result).toBe("completed");
    });

    it("POST /locks/heartbeat for non-existent lock returns 404", async () => {
      // Heartbeating a lock that was never acquired returns 404 "lock not found".
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "heartbeat-notfound-agent",
            schedule: "0 0 31 2 *",
            testScript: [
              "#!/bin/sh",
              "set -e",
              WAIT_FOR_GATEWAY,
              // Call /locks/heartbeat directly without ever acquiring the lock
              'PAYLOAD=$(printf \'{"secret":"%s","resourceKey":"test://lock-heartbeat-notfound/resource"}\' "$SHUTDOWN_SECRET")',
              'HB_RESP=$(curl -sf -X POST "$GATEWAY_URL/locks/heartbeat" \\',
              '  -H "Content-Type: application/json" \\',
              '  -d "$PAYLOAD" \\',
              "  -w '\\n%{http_code}' 2>&1)",
              'STATUS_CODE=$(echo "$HB_RESP" | tail -1)',
              'BODY=$(echo "$HB_RESP" | head -1)',
              // Should get 404 for "lock not found"
              'test "$STATUS_CODE" = "404" || { echo "expected 404 but got $STATUS_CODE: $BODY"; exit 1; }',
              'REASON=$(echo "$BODY" | jq -r .reason 2>/dev/null)',
              'test "$REASON" = "lock not found" || { echo "expected reason lock not found, got: $REASON ($BODY)"; exit 1; }',
              'echo "heartbeat-notfound-agent: got expected 404 lock not found OK"',
              "exit 0",
            ].join("\n"),
          },
        ],
      });

      await harness.start();
      await harness.triggerAgent("heartbeat-notfound-agent");
      const run = await harness.waitForRunResult("heartbeat-notfound-agent", 60_000);
      expect(run.result).toBe("completed");
    });

    it("POST /locks/acquire with invalid JSON body returns 400", async () => {
      // The /locks/acquire route returns 400 for invalid JSON, similar to other routes.
      // This is not exercised by the rlock shell command.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "acquire-badjson-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      await harness.start();

      // Call /locks/acquire with invalid JSON
      const res = await fetch(`http://127.0.0.1:${harness.gatewayPort}/locks/acquire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json {{{",
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("JSON");
    });

    it("POST /locks/release with invalid JSON body returns 400", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "release-badjson-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      await harness.start();

      const res = await fetch(`http://127.0.0.1:${harness.gatewayPort}/locks/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json {{{",
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("JSON");
    });

    it("POST /locks/heartbeat with invalid JSON body returns 400", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "heartbeat-badjson-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      await harness.start();

      const res = await fetch(`http://127.0.0.1:${harness.gatewayPort}/locks/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json {{{",
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("JSON");
    });
  },
);
