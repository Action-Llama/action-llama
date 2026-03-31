/**
 * Integration test: verify the /locks/list endpoint.
 *
 * The GET /locks/list endpoint is an internal container-to-gateway route
 * that returns all resource locks currently held by the requesting container
 * instance. It is authenticated via the container's SHUTDOWN_SECRET.
 *
 * This endpoint is distinct from /locks/status (which returns all locks
 * across all instances and requires the gateway API key). /locks/list
 * is called by the container itself to check its own locks.
 *
 * Tests:
 *   1. Container acquires lock, /locks/list returns that lock
 *   2. Container releases lock, /locks/list returns empty list
 *   3. GET /locks/list without ?secret=<key> returns 400
 *   4. GET /locks/list with invalid secret returns 403
 *
 * Covers: execution/routes/locks.ts GET /locks/list
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

// Shell snippet that waits until the gateway is reachable inside the container
const WAIT_FOR_GATEWAY = [
  "i=0; while [ $i -lt 30 ]; do",
  '  curl -sf --connect-timeout 1 "$GATEWAY_URL/health" > /dev/null 2>&1 && break',
  "  i=$((i+1)); sleep 0.5",
  "done",
  'if [ -z "$SHUTDOWN_SECRET" ]; then echo "SHUTDOWN_SECRET not set" >&2; exit 99; fi',
].join("\n");

describe.skipIf(!DOCKER)("integration: /locks/list endpoint", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("locks/list returns held lock after rlock, empty after runlock", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "list-lock-agent",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            "set -e",
            WAIT_FOR_GATEWAY,
            "",
            // Acquire a lock
            'ACQUIRE=$(rlock "test://integration-test/list-lock-resource")',
            'OK=$(echo "$ACQUIRE" | jq -r .ok)',
            'test "$OK" = "true" || { echo "rlock failed: $ACQUIRE"; exit 1; }',
            "",
            // Call /locks/list to verify the lock appears
            'LIST=$(curl -sf "$GATEWAY_URL/locks/list?secret=$SHUTDOWN_SECRET")',
            'echo "locks after acquire: $LIST"',
            // Should return a JSON array with at least one entry
            'COUNT=$(echo "$LIST" | jq ". | length" 2>/dev/null)',
            'test "$COUNT" -ge 1 || { echo "expected >=1 lock in list, got: $LIST"; exit 1; }',
            // The lock should contain our resource key
            'FOUND=$(echo "$LIST" | jq -r ".[0].resourceKey" 2>/dev/null)',
            'test "$FOUND" = "test://integration-test/list-lock-resource" || { echo "wrong resourceKey: $FOUND"; exit 1; }',
            "",
            // Release the lock
            'RELEASE=$(runlock "test://integration-test/list-lock-resource")',
            'OK=$(echo "$RELEASE" | jq -r .ok)',
            'test "$OK" = "true" || { echo "runlock failed: $RELEASE"; exit 1; }',
            "",
            // Call /locks/list again — should be empty now
            'LIST2=$(curl -sf "$GATEWAY_URL/locks/list?secret=$SHUTDOWN_SECRET")',
            'echo "locks after release: $LIST2"',
            'COUNT2=$(echo "$LIST2" | jq ". | length" 2>/dev/null)',
            'test "$COUNT2" -eq 0 || { echo "expected 0 locks after release, got: $LIST2"; exit 1; }',
            "",
            'echo "list-lock-agent: locks/list verified OK"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    await harness.triggerAgent("list-lock-agent");
    const run = await harness.waitForRunResult("list-lock-agent");
    expect(run.result).toBe("completed");
  });

  it("GET /locks/list without secret returns 400", async () => {
    // The /locks/list endpoint requires a ?secret= query parameter.
    // Without it, the gateway returns 400 Bad Request.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "list-no-secret-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'ran'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Start harness but also call /locks/list from the test (not the container)
    // This exercises the "missing secret" error path directly

    await harness.triggerAgent("list-no-secret-agent");
    await harness.waitForRunResult("list-no-secret-agent");

    // Call /locks/list without secret — must return 400
    const res = await fetch(
      `http://127.0.0.1:${harness.gatewayPort}/locks/list`,
      // No Authorization header, no ?secret= param
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("secret");
  });

  it("GET /locks/list with invalid secret returns 403", async () => {
    // When an invalid container secret is provided, /locks/list returns 403.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "list-bad-secret-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'ran'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    await harness.triggerAgent("list-bad-secret-agent");
    await harness.waitForRunResult("list-bad-secret-agent");

    // Call /locks/list with a completely invalid secret
    const res = await fetch(
      `http://127.0.0.1:${harness.gatewayPort}/locks/list?secret=completely-invalid-secret-xyz`,
    );
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("secret");
  });
});
