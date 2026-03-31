/**
 * Integration test: verify dashboard API enrichment for agent-triggered runs.
 *
 * When agent A triggers agent B via al-subagent, the stats store records a
 * call edge. The dashboard API uses this to enrich the instance detail and
 * trigger detail endpoints with caller information (parentEdge / callerAgent).
 *
 * Tests:
 *   1. GET /api/dashboard/agents/:name/instances/:id for a run triggered by
 *      another agent includes a parentEdge with caller info.
 *   2. GET /api/dashboard/triggers/:instanceId for an agent-triggered run
 *      includes callerAgent, callerInstance, and callDepth fields.
 *
 * Covers:
 *   - stats/store.ts: queryCallEdgeByTargetInstance (previously untested via e2e)
 *   - control/routes/dashboard-api.ts: agent trigger enrichment paths
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)(
  "integration: dashboard API for agent-triggered runs",
  { timeout: 300_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) await harness.shutdown();
    });

    function gatewayFetch(h: IntegrationHarness, path: string): Promise<Response> {
      return fetch(`http://127.0.0.1:${h.gatewayPort}${path}`, {
        headers: { Authorization: `Bearer ${h.apiKey}` },
      });
    }

    it("dashboard instance detail shows parentEdge for agent-triggered callee run", async () => {
      // Agent A (caller) triggers Agent B (callee) via al-subagent.
      // After both complete, GET /api/dashboard/agents/callee/instances/:id should
      // include a parentEdge with the caller's agent name and instance.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "dashboard-caller",
            schedule: "0 0 31 2 *",
            testScript: [
              "#!/bin/sh",
              "set +e",
              'RESULT=$(echo "go" | al-subagent dashboard-callee)',
              "RC=$?",
              "set -e",
              'test "$RC" -eq 0 || { echo "al-subagent exit=$RC: $RESULT"; exit 1; }',
              'OK=$(echo "$RESULT" | jq -r .ok)',
              'test "$OK" = "true" || { echo "al-subagent ok=$OK: $RESULT"; exit 1; }',
              'CALL_ID=$(echo "$RESULT" | jq -r .callId)',
              "set +e",
              'al-subagent-wait "$CALL_ID" --timeout 60',
              "WAIT_RC=$?",
              "set -e",
              'test "$WAIT_RC" -eq 0 || { echo "al-subagent-wait failed: $WAIT_RC"; exit 1; }',
              'echo "dashboard-caller: callee completed OK"',
              "exit 0",
            ].join("\n"),
          },
          {
            name: "dashboard-callee",
            schedule: "0 0 31 2 *",
            testScript: [
              "#!/bin/sh",
              'echo "dashboard-callee ran"',
              "exit 0",
            ].join("\n"),
          },
        ],
      });

      await harness.start();

      // Trigger the caller which will subagent the callee
      await harness.triggerAgent("dashboard-caller");

      // Wait for both caller and callee to complete
      const callerRun = await harness.waitForRunResult("dashboard-caller", 120_000);
      expect(callerRun.result).toBe("completed");
      // Callee should also complete (triggered by caller via al-subagent)
      const calleeRun = await harness.waitForRunResult("dashboard-callee", 60_000);
      expect(calleeRun.result).toBe("completed");

      // Find the callee's instanceId from stats
      const runsRes = await gatewayFetch(harness, "/api/stats/agents/dashboard-callee/runs");
      expect(runsRes.ok).toBe(true);
      const runsBody = (await runsRes.json()) as { runs: Array<Record<string, unknown>>; total: number };
      expect(runsBody.total).toBeGreaterThanOrEqual(1);

      const calleeRun0 = runsBody.runs[0]!;
      const calleeInstanceId = (calleeRun0.instanceId ?? calleeRun0.instance_id) as string | undefined;
      expect(calleeInstanceId).toBeDefined();
      if (!calleeInstanceId) return;

      // Fetch callee instance detail from the dashboard endpoint
      const detailRes = await gatewayFetch(
        harness,
        `/api/dashboard/agents/dashboard-callee/instances/${calleeInstanceId}`,
      );
      expect(detailRes.ok).toBe(true);
      const detailBody = (await detailRes.json()) as {
        run: Record<string, unknown> | null;
        parentEdge?: { caller_agent: string; caller_instance: string } | null;
      };

      // The run should exist (callee ran)
      expect(detailBody.run).not.toBeNull();

      // parentEdge should be present with caller info
      expect(detailBody.parentEdge).toBeDefined();
      expect(detailBody.parentEdge).not.toBeNull();
      if (detailBody.parentEdge) {
        expect(detailBody.parentEdge.caller_agent).toBe("dashboard-caller");
        expect(typeof detailBody.parentEdge.caller_instance).toBe("string");
      }
    });

    it("dashboard triggers/:instanceId shows callerAgent for agent-triggered run", async () => {
      // GET /api/dashboard/triggers/:instanceId for an agent-triggered run
      // should include callerAgent, callerInstance, and callDepth fields.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "trigger-caller",
            schedule: "0 0 31 2 *",
            testScript: [
              "#!/bin/sh",
              "set +e",
              'RESULT=$(echo "go" | al-subagent trigger-worker)',
              "RC=$?",
              "set -e",
              'test "$RC" -eq 0 || { echo "al-subagent exit=$RC: $RESULT"; exit 1; }',
              'CALL_ID=$(echo "$RESULT" | jq -r .callId)',
              "set +e",
              'al-subagent-wait "$CALL_ID" --timeout 60',
              "WAIT_RC=$?",
              "set -e",
              'test "$WAIT_RC" -eq 0 || { echo "al-subagent-wait failed: $WAIT_RC"; exit 1; }',
              "exit 0",
            ].join("\n"),
          },
          {
            name: "trigger-worker",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\necho 'trigger-worker ran'\nexit 0\n",
          },
        ],
      });

      await harness.start();

      await harness.triggerAgent("trigger-caller");

      const callerResult = await harness.waitForRunResult("trigger-caller", 120_000);
      expect(callerResult.result).toBe("completed");
      const workerResult = await harness.waitForRunResult("trigger-worker", 60_000);
      expect(workerResult.result).toBe("completed");

      // Get worker's instanceId
      const runsRes = await gatewayFetch(harness, "/api/stats/agents/trigger-worker/runs");
      expect(runsRes.ok).toBe(true);
      const runsBody = (await runsRes.json()) as { runs: Array<Record<string, unknown>>; total: number };
      expect(runsBody.total).toBeGreaterThanOrEqual(1);

      const workerRun = runsBody.runs[0]!;
      const workerInstanceId = (workerRun.instanceId ?? workerRun.instance_id) as string | undefined;
      expect(workerInstanceId).toBeDefined();
      if (!workerInstanceId) return;

      // Fetch trigger details for the worker's run
      const triggerRes = await gatewayFetch(harness, `/api/dashboard/triggers/${workerInstanceId}`);
      expect(triggerRes.ok).toBe(true);
      const triggerBody = (await triggerRes.json()) as {
        trigger: {
          instanceId: string;
          agentName: string;
          triggerType: string;
          callerAgent?: string;
          callerInstance?: string;
          callDepth?: number;
        } | null;
      };

      expect(triggerBody.trigger).not.toBeNull();
      if (triggerBody.trigger) {
        expect(triggerBody.trigger.agentName).toBe("trigger-worker");
        // Trigger type should be "agent" since it was triggered by al-subagent
        expect(triggerBody.trigger.triggerType).toBe("agent");
        // callerAgent should identify the calling agent
        expect(triggerBody.trigger.callerAgent).toBe("trigger-caller");
        expect(typeof triggerBody.trigger.callerInstance).toBe("string");
        expect(typeof triggerBody.trigger.callDepth).toBe("number");
        expect(triggerBody.trigger.callDepth).toBe(1);
      }
    });
  },
);
