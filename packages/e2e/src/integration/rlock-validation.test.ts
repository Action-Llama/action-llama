/**
 * Integration test: rlock/runlock URI validation.
 *
 * Tests that the rlock/runlock/rlock-heartbeat commands correctly reject
 * resource keys that are not valid URIs, returning exit code 4 (HTTP 400).
 *
 * The lock store and lock routes both validate that resource keys are valid
 * URIs with a recognizable scheme (e.g., github://, file://, https://).
 * Plain strings, relative paths, and other non-URI formats must be rejected.
 *
 * Exit code reference (from _http-exit):
 *   0 = acquired (HTTP 200)
 *   1 = conflict (HTTP 409)
 *   4 = bad request (HTTP 400) — server rejected the request format
 *   6 = unreachable (curl 000) — gateway not reachable
 *
 * Covers: execution/lock-store.ts validateResourceKey()
 *         execution/routes/locks.ts URI validation in acquire/release/heartbeat
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

// Shell snippet: wait until the gateway proxy is reachable
const WAIT_FOR_GATEWAY = [
  "i=0; while [ $i -lt 30 ]; do",
  '  curl -sf --connect-timeout 1 "$GATEWAY_URL/health" > /dev/null 2>&1 && break',
  "  i=$((i+1)); sleep 0.5",
  "done",
  'if [ -z "$SHUTDOWN_SECRET" ]; then echo "SHUTDOWN_SECRET not set" >&2; exit 99; fi',
].join("\n");

describe.skipIf(!DOCKER)("integration: rlock URI validation", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("rlock with plain string (no URI scheme) returns exit 4 (bad request)", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "rlock-plain-string",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            WAIT_FOR_GATEWAY,
            "",
            "# Try rlock with a plain string (not a URI)",
            "set +e",
            'RESULT=$(rlock "not-a-valid-uri")',
            "RC=$?",
            "set -e",
            "",
            "# Should exit 4 (HTTP 400 bad request)",
            'test "$RC" -eq 4 || { echo "expected exit 4, got RC=$RC: $RESULT"; exit 1; }',
            "",
            "# Response should have ok=false",
            'OK=$(echo "$RESULT" | jq -r .ok 2>/dev/null || echo "null")',
            'test "$OK" = "false" || { echo "expected ok=false, got $OK: $RESULT"; exit 1; }',
            "",
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    await harness.triggerAgent("rlock-plain-string");
    const run = await harness.waitForRunResult("rlock-plain-string");
    expect(run.result).toBe("completed");
  });

  it("rlock with space-containing string returns exit 4 (bad request)", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "rlock-spaces",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            WAIT_FOR_GATEWAY,
            "",
            "# Try rlock with a string that contains spaces (definitely not a URI)",
            "set +e",
            "RESULT=$(rlock \"resource with spaces\")",
            "RC=$?",
            "set -e",
            "",
            "# Should exit 4 (HTTP 400 bad request) since spaces make it invalid",
            'test "$RC" -eq 4 || { echo "expected exit 4, got RC=$RC: $RESULT"; exit 1; }',
            "",
            'OK=$(echo "$RESULT" | jq -r .ok 2>/dev/null || echo "null")',
            'test "$OK" = "false" || { echo "expected ok=false, got $OK: $RESULT"; exit 1; }',
            "",
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    await harness.triggerAgent("rlock-spaces");
    const run = await harness.waitForRunResult("rlock-spaces");
    expect(run.result).toBe("completed");
  });

  it("runlock with invalid URI returns exit 4 (bad request)", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "runlock-invalid-uri",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            WAIT_FOR_GATEWAY,
            "",
            "# Try runlock with a plain string (not a URI)",
            "set +e",
            'RESULT=$(runlock "just-a-string")',
            "RC=$?",
            "set -e",
            "",
            "# Should exit 4 (HTTP 400 bad request)",
            'test "$RC" -eq 4 || { echo "expected exit 4, got RC=$RC: $RESULT"; exit 1; }',
            "",
            'OK=$(echo "$RESULT" | jq -r .ok 2>/dev/null || echo "null")',
            'test "$OK" = "false" || { echo "expected ok=false, got $OK: $RESULT"; exit 1; }',
            "",
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    await harness.triggerAgent("runlock-invalid-uri");
    const run = await harness.waitForRunResult("runlock-invalid-uri");
    expect(run.result).toBe("completed");
  });

  it("rlock-heartbeat with invalid URI returns exit 4 (bad request)", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "rlock-hb-invalid-uri",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            WAIT_FOR_GATEWAY,
            "",
            "# Try rlock-heartbeat with a plain string",
            "set +e",
            'RESULT=$(rlock-heartbeat "not-a-uri")',
            "RC=$?",
            "set -e",
            "",
            "# Should exit 4 (HTTP 400 bad request)",
            'test "$RC" -eq 4 || { echo "expected exit 4, got RC=$RC: $RESULT"; exit 1; }',
            "",
            'OK=$(echo "$RESULT" | jq -r .ok 2>/dev/null || echo "null")',
            'test "$OK" = "false" || { echo "expected ok=false, got $OK: $RESULT"; exit 1; }',
            "",
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    await harness.triggerAgent("rlock-hb-invalid-uri");
    const run = await harness.waitForRunResult("rlock-hb-invalid-uri");
    expect(run.result).toBe("completed");
  });

  it("rlock with valid URI succeeds normally after invalid-URI attempts", async () => {
    // Verify that the lock system is healthy after invalid-URI rejections
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "rlock-valid-after-invalid",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            "set -e",
            WAIT_FOR_GATEWAY,
            "",
            "# First try an invalid URI (expected to fail with exit 4)",
            "set +e",
            'rlock "not-a-uri"',
            "BAD_RC=$?",
            "set -e",
            'test "$BAD_RC" -eq 4 || { echo "expected exit 4 for bad URI, got $BAD_RC"; exit 1; }',
            "",
            "# Now acquire a valid URI lock",
            'RESULT=$(rlock "test://valid-uri-after-invalid/resource-1")',
            "",
            '# Verify ok=true',
            'OK=$(echo "$RESULT" | jq -r .ok)',
            'test "$OK" = "true" || { echo "valid lock failed: $RESULT"; exit 1; }',
            "",
            "# Release the lock",
            'runlock "test://valid-uri-after-invalid/resource-1"',
            "",
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    const lockAcquire = harness.events.waitFor(
      "lock",
      (e) => e.action === "acquire" && e.ok && e.resourceKey === "test://valid-uri-after-invalid/resource-1",
      60_000,
    );

    await harness.triggerAgent("rlock-valid-after-invalid");

    const [lockEvent, run] = await Promise.all([
      lockAcquire,
      harness.waitForRunResult("rlock-valid-after-invalid"),
    ]);

    expect(lockEvent.ok).toBe(true);
    expect(run.result).toBe("completed");
  });
});
