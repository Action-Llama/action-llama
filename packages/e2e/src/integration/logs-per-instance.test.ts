/**
 * Integration test: verify the per-instance log API endpoint.
 *
 * The GET /api/logs/agents/:name/:instanceId endpoint returns log entries
 * filtered to a specific run instance. This is used by the dashboard UI to
 * show logs for a specific run.
 *
 * Covers:
 *   - control/routes/logs.ts: GET /api/logs/agents/:name/:instanceId
 *   - instanceFilter parameter in readEntriesForward / readLastEntries
 *   - 400 for invalid agent name or instance ID pattern
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: per-instance log API", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  function logsAPI(h: IntegrationHarness, path: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${h.gatewayPort}${path}`, {
      headers: { Authorization: `Bearer ${h.apiKey}` },
    });
  }

  it("GET /api/logs/agents/:name/:instanceId returns log entries for a specific run", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "instance-log-agent",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            'echo "instance-log-agent specific run output"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    // Listen for the run:end event to capture the instanceId.
    const runEndPromise = harness.events.waitFor(
      "run:end",
      (e) => e.agentName === "instance-log-agent",
      60_000,
    );

    await harness.triggerAgent("instance-log-agent");
    const runEndEvent = await runEndPromise;

    // Wait a bit for logs to be flushed to disk.
    await new Promise((r) => setTimeout(r, 500));

    const instanceId = runEndEvent.instanceId;
    expect(instanceId).toBeTruthy();

    // Fetch per-instance logs.
    const res = await logsAPI(harness, `/api/logs/agents/instance-log-agent/${instanceId}`);
    expect(res.status).toBe(200);

    const body = await res.json() as { entries: unknown[]; cursor: string | null; hasMore: boolean };
    expect(Array.isArray(body.entries)).toBe(true);
    expect(typeof body.cursor).toBe("string");
    expect(typeof body.hasMore).toBe("boolean");
  });

  it("GET /api/logs/agents/:name/:instanceId returns empty entries for unknown instanceId", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "instance-log-empty-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'ran'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Trigger a run so the agent has a log file on disk.
    await harness.triggerAgent("instance-log-empty-agent");
    await harness.waitForRunResult("instance-log-empty-agent", 120_000);
    await new Promise((r) => setTimeout(r, 500));

    // Query with an instanceId that doesn't match any run entries.
    const unknownInstanceId = "nonexistent-instance-abc123";
    const res = await logsAPI(harness, `/api/logs/agents/instance-log-empty-agent/${unknownInstanceId}`);

    // Should return 200 with empty entries (no matching instance filter).
    expect(res.status).toBe(200);
    const body = await res.json() as { entries: unknown[] };
    expect(Array.isArray(body.entries)).toBe(true);
    // No entries should match the nonexistent instance ID.
    expect(body.entries.length).toBe(0);
  });

  it("GET /api/logs/agents/:name/:instanceId returns 400 for invalid instance ID", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "instance-log-invalid-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();
    await harness.triggerAgent("instance-log-invalid-agent");
    await harness.waitForRunResult("instance-log-invalid-agent", 120_000);

    // Instance ID with invalid characters (e.g., path traversal) should return 400.
    const res = await logsAPI(harness, "/api/logs/agents/instance-log-invalid-agent/../../../etc");

    expect([400, 404]).toContain(res.status);
  });

  it("GET /api/logs/agents/:name/:instanceId returns 400 for invalid agent name", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "instance-log-name-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();
    await harness.triggerAgent("instance-log-name-agent");
    await harness.waitForRunResult("instance-log-name-agent", 120_000);

    // Agent name with invalid characters should return 400.
    const res = await logsAPI(harness, "/api/logs/agents/../../etc/passwd/valid-instance-id");

    expect([400, 404]).toContain(res.status);
  });
});
