/**
 * Integration test: verify the logs API returns log entries after agent runs.
 *
 * The scheduler writes structured JSON logs to .al/logs/<name>-<date>.log.
 * These are exposed via:
 *   GET /api/logs/scheduler        — scheduler process logs
 *   GET /api/logs/agents/:name     — per-agent logs (all instances)
 *
 * Both endpoints are protected by the gateway API key.
 *
 * Covers: log API routes (not previously tested by integration tests),
 *   including the ?after and ?before timestamp filtering parameters.
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: logs API", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  /**
   * Helper to fetch a logs API endpoint with the harness API key.
   */
  async function logsAPI(h: IntegrationHarness, path: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${h.gatewayPort}${path}`, {
      headers: {
        Authorization: `Bearer ${h.apiKey}`,
      },
    });
  }

  it("scheduler logs endpoint returns entries after scheduler starts", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "logs-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'logs-agent ran'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Run an agent to generate some log entries
    await harness.triggerAgent("logs-agent");
    await harness.waitForRunResult("logs-agent");

    // Give pino a moment to flush to disk
    await new Promise((r) => setTimeout(r, 1_000));

    // Query scheduler logs
    const res = await logsAPI(harness, "/api/logs/scheduler");
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body).toHaveProperty("entries");
    expect(body).toHaveProperty("cursor");
    expect(Array.isArray(body.entries)).toBe(true);

    // Scheduler should have written some log lines
    expect(body.entries.length).toBeGreaterThan(0);

    // Each entry should have basic log fields
    const entry = body.entries[0];
    expect(entry).toHaveProperty("level");
    expect(entry).toHaveProperty("time");
    expect(entry).toHaveProperty("msg");
  });

  it("agent logs endpoint returns entries after agent runs", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "agent-log-test",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            'echo "agent-log-test: hello from test script"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    await harness.triggerAgent("agent-log-test");
    await harness.waitForRunResult("agent-log-test");

    // Give pino a moment to flush
    await new Promise((r) => setTimeout(r, 1_000));

    const res = await logsAPI(harness, "/api/logs/agents/agent-log-test");
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body).toHaveProperty("entries");
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries.length).toBeGreaterThan(0);

    // Verify entries are from the correct agent
    const hasAgentName = body.entries.some(
      (e: any) => e.msg?.includes("agent-log-test") || e.agent === "agent-log-test"
    );
    expect(hasAgentName).toBe(true);
  });

  it("agent logs endpoint returns 400 for invalid agent name", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "valid-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Try an agent name with invalid characters (path traversal attempt)
    const res = await logsAPI(harness, "/api/logs/agents/../etc/passwd");
    // Either 400 (rejected) or 404 (not found) is acceptable
    expect([400, 404].includes(res.status)).toBe(true);
  });

  it("logs endpoint supports cursor-based pagination", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "paginated-log-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Run the agent to generate logs
    await harness.triggerAgent("paginated-log-agent");
    await harness.waitForRunResult("paginated-log-agent");

    await new Promise((r) => setTimeout(r, 1_000));

    // First page
    const res1 = await logsAPI(harness, "/api/logs/scheduler?lines=5");
    expect(res1.ok).toBe(true);
    const body1 = await res1.json();
    expect(body1).toHaveProperty("cursor");

    // Second page using cursor — should be valid (may be empty if no more entries)
    const cursor = encodeURIComponent(body1.cursor || "");
    if (cursor) {
      const res2 = await logsAPI(harness, `/api/logs/scheduler?cursor=${cursor}`);
      expect(res2.ok).toBe(true);
      const body2 = await res2.json();
      expect(body2).toHaveProperty("entries");
      expect(Array.isArray(body2.entries)).toBe(true);
    }
  });

  it("logs ?after parameter filters out entries older than the given timestamp", async () => {
    // Fetch scheduler logs with ?after set to a timestamp far in the future.
    // All existing log entries have timestamps from the past, so they should
    // all be excluded and the endpoint should return an empty entries array.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "after-filter-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'after-filter-agent ran'\nexit 0\n",
        },
      ],
    });

    await harness.start();
    await harness.triggerAgent("after-filter-agent");
    await harness.waitForRunResult("after-filter-agent");

    await new Promise((r) => setTimeout(r, 1_000));

    // Use a timestamp far in the future (year 2099) as the 'after' cutoff.
    // No log entries should have timestamps after this point.
    const futureTimestamp = new Date("2099-01-01").getTime();
    const res = await logsAPI(harness, `/api/logs/scheduler?after=${futureTimestamp}`);
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body).toHaveProperty("entries");
    expect(Array.isArray(body.entries)).toBe(true);
    // All entries are from the past, so nothing should match
    expect(body.entries).toHaveLength(0);
  });

  it("logs ?before parameter filters out entries newer than the given timestamp", async () => {
    // Fetch scheduler logs with ?before set to epoch 0 (1970-01-01T00:00:00Z).
    // All log entries are from the present era (timestamps > 0), so they should
    // all be excluded and the endpoint should return an empty entries array.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "before-filter-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'before-filter-agent ran'\nexit 0\n",
        },
      ],
    });

    await harness.start();
    await harness.triggerAgent("before-filter-agent");
    await harness.waitForRunResult("before-filter-agent");

    await new Promise((r) => setTimeout(r, 1_000));

    // Use epoch 0 as the 'before' cutoff.
    // All log entries have timestamps well after epoch 0, so none should match.
    const res = await logsAPI(harness, "/api/logs/scheduler?before=0");
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body).toHaveProperty("entries");
    expect(Array.isArray(body.entries)).toBe(true);
    // All entries have time > 0, so none should be "before" epoch 0
    expect(body.entries).toHaveLength(0);
  });

  it("logs endpoint returns 400 for invalid (malformed) cursor", async () => {
    // The cursor parameter must be a valid base64url-encoded string in the
    // format "date:offsets". If the cursor cannot be decoded correctly,
    // the endpoint should return 400 with { error: "Invalid cursor" }.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "invalid-cursor-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Send an invalid cursor that cannot be decoded to the expected format
    // "not-a-valid-cursor" is base64url characters but decodes to garbage
    const res = await logsAPI(harness, "/api/logs/scheduler?cursor=not-a-valid-cursor-format");
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toContain("cursor");
  });
});
