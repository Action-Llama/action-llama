/**
 * Integration test: cursor-based pagination for agent logs.
 *
 * GET /api/logs/agents/:name?cursor=<token> reads entries forward from
 * the position encoded in the cursor, enabling incremental log tailing.
 * This exercises readEntriesForward() in log-helpers.ts — the forward
 * read path that is distinct from the backward (readLastEntries) path.
 *
 * Test scenarios:
 *   1. Initial request returns entries + cursor (no cursor param)
 *   2. Subsequent request with cursor returns forward-read entries
 *   3. Invalid cursor returns 400
 *
 * Also verifies the per-instance log cursor path:
 *   GET /api/logs/agents/:name/:instanceId?cursor=<token>
 *
 * Covers: control/routes/logs.ts — cursor branch for agent logs +
 *         log-helpers.ts readEntriesForward().
 */

import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)(
  "integration: agent logs cursor-based pagination",
  { timeout: 300_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) await harness.shutdown();
    });

    function logsAPI(h: IntegrationHarness, path: string): Promise<Response> {
      return fetch(`http://127.0.0.1:${h.gatewayPort}${path}`, {
        headers: { Authorization: `Bearer ${h.apiKey}` },
      });
    }

    it("agent logs cursor pagination reads forward from the cursor position", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "cursor-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\necho 'cursor-agent ran'\nexit 0\n",
          },
        ],
      });

      await harness.start();

      // Run the agent to generate logs
      await harness.triggerAgent("cursor-agent");
      await harness.waitForRunResult("cursor-agent", 60_000);

      // Wait for log flush
      await new Promise((r) => setTimeout(r, 500));

      // First request: no cursor → returns entries + cursor (backward read)
      const res1 = await logsAPI(harness, "/api/logs/agents/cursor-agent");
      expect(res1.status).toBe(200);
      const body1 = (await res1.json()) as { entries: unknown[]; cursor: string | null; hasMore: boolean };
      expect(typeof body1.cursor).toBe("string");
      expect(Array.isArray(body1.entries)).toBe(true);

      // Second request: with cursor → reads forward from that position (readEntriesForward)
      const cursor = encodeURIComponent(body1.cursor || "");
      const res2 = await logsAPI(harness, `/api/logs/agents/cursor-agent?cursor=${cursor}`);
      expect(res2.status).toBe(200);
      const body2 = (await res2.json()) as { entries: unknown[]; cursor: string | null; hasMore: boolean };
      expect(Array.isArray(body2.entries)).toBe(true);
      // cursor should still be present (may be same position if no new logs)
      expect(typeof body2.cursor).toBe("string");
    });

    it("agent logs with invalid cursor returns 400", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "cursor-bad-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\necho 'done'\nexit 0\n",
          },
        ],
      });

      await harness.start();

      // No need to run the agent — invalid cursor validation happens before log reading
      const res = await logsAPI(harness, "/api/logs/agents/cursor-bad-agent?cursor=not-valid-cursor");
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/cursor/i);
    });

    it("per-instance agent logs cursor pagination reads forward entries", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "cursor-instance-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\necho 'cursor-instance-agent ran'\nexit 0\n",
          },
        ],
      });

      await harness.start();

      // Run the agent and capture the instanceId
      const runEndPromise = harness.events.waitFor(
        "run:end",
        (e) => e.agentName === "cursor-instance-agent",
        60_000,
      );
      await harness.triggerAgent("cursor-instance-agent");
      const runEnd = await runEndPromise;
      const instanceId = runEnd.instanceId;

      // Wait for log flush
      await new Promise((r) => setTimeout(r, 500));

      // First request: no cursor → backward read
      const res1 = await logsAPI(harness, `/api/logs/agents/cursor-instance-agent/${instanceId}`);
      expect(res1.status).toBe(200);
      const body1 = (await res1.json()) as { entries: unknown[]; cursor: string | null };
      expect(typeof body1.cursor).toBe("string");

      // Second request: with cursor → forward read (readEntriesForward with instanceId filter)
      const cursor = encodeURIComponent(body1.cursor || "");
      const res2 = await logsAPI(
        harness,
        `/api/logs/agents/cursor-instance-agent/${instanceId}?cursor=${cursor}`,
      );
      expect(res2.status).toBe(200);
      const body2 = (await res2.json()) as { entries: unknown[]; cursor: string | null };
      expect(Array.isArray(body2.entries)).toBe(true);
    });
  },
);
