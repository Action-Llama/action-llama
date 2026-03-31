/**
 * Integration test: verify the grep parameter in the logs API.
 *
 * The GET /api/logs/agents/:name endpoint supports a `grep` query parameter
 * that filters log entries by a regex pattern. This is used by the dashboard
 * to search through agent logs.
 *
 * Also tests the `lines` parameter for controlling page size.
 *
 * Covers:
 *   - control/routes/logs.ts: grep regex filtering (grepRe)
 *   - Invalid grep pattern returns 400
 *   - lines parameter controls result count
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: logs API grep and lines parameters", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  function logsAPI(h: IntegrationHarness, path: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${h.gatewayPort}${path}`, {
      headers: { Authorization: `Bearer ${h.apiKey}` },
    });
  }

  it("grep parameter filters log entries matching a pattern", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "grep-log-agent",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            // Emit distinct log messages that we can later filter by
            'echo "UNIQUE_MARKER_12345 test output"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    await harness.triggerAgent("grep-log-agent");
    await harness.waitForRunResult("grep-log-agent", 120_000);

    // Wait for logs to be flushed
    await new Promise((r) => setTimeout(r, 500));

    // Query with a grep pattern that should match some entries (agent-related logs)
    const matchRes = await logsAPI(
      harness,
      "/api/logs/agents/grep-log-agent?grep=grep-log-agent",
    );
    expect(matchRes.status).toBe(200);
    const matchBody = await matchRes.json() as { entries: unknown[] };
    expect(Array.isArray(matchBody.entries)).toBe(true);

    // Query with a pattern that should match nothing
    const noMatchRes = await logsAPI(
      harness,
      "/api/logs/agents/grep-log-agent?grep=NONEXISTENT_UNIQUE_PATTERN_XYZ789",
    );
    expect(noMatchRes.status).toBe(200);
    const noMatchBody = await noMatchRes.json() as { entries: unknown[] };
    expect(Array.isArray(noMatchBody.entries)).toBe(true);
    expect(noMatchBody.entries.length).toBe(0);
  });

  it("invalid grep regex returns 400", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "grep-invalid-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'ran'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    await harness.triggerAgent("grep-invalid-agent");
    await harness.waitForRunResult("grep-invalid-agent", 120_000);
    await new Promise((r) => setTimeout(r, 500));

    // Submit an invalid regex pattern
    const res = await logsAPI(
      harness,
      "/api/logs/agents/grep-invalid-agent?grep=%5B+invalid+regex",
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("grep");
  });

  it("lines parameter controls the number of log entries returned", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "lines-log-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'ran'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Run twice to create more log entries
    for (let i = 0; i < 2; i++) {
      await harness.triggerAgent("lines-log-agent");
      await harness.waitForRunResult("lines-log-agent", 120_000);
    }
    await new Promise((r) => setTimeout(r, 500));

    // Query with lines=3: should return at most 3 entries
    const res = await logsAPI(harness, "/api/logs/agents/lines-log-agent?lines=3");
    expect(res.status).toBe(200);
    const body = await res.json() as { entries: unknown[]; hasMore: boolean };
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries.length).toBeLessThanOrEqual(3);
    expect(typeof body.hasMore).toBe("boolean");
  });
});
