/**
 * Integration test: verify stats/activity filtering by triggerType=agent.
 *
 * When an agent is triggered by another agent via al-subagent, the stats store
 * records the run with triggerType="agent" and triggerSource=<callerAgentName>.
 * The /api/stats/activity endpoint should return these rows when filtering by
 * ?triggerType=agent.
 *
 * Also verifies that /api/stats/triggers and /api/stats/activity include the
 * triggerSource (caller agent name) for agent-triggered runs.
 *
 * Covers:
 *   - control/routes/stats.ts: activity endpoint ?triggerType=agent filter
 *   - stats/store.ts: trigger_type="agent" query path
 *   - execution/execution.ts: recording agent-triggered run with trigger source
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)(
  "integration: stats for agent-triggered runs",
  { timeout: 300_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) await harness.shutdown();
    });

    function statsAPI(h: IntegrationHarness, path: string): Promise<Response> {
      return fetch(`http://127.0.0.1:${h.gatewayPort}${path}`, {
        headers: { Authorization: `Bearer ${h.apiKey}` },
      });
    }

    it("activity?triggerType=agent returns agent-triggered callee runs with triggerSource", async () => {
      // Agent A (caller) triggers Agent B (callee) via al-subagent.
      // The activity endpoint should return the callee's run with:
      //   - triggerType = "agent"
      //   - triggerSource = "agent-stats-caller" (the caller's name)
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "agent-stats-caller",
            schedule: "0 0 31 2 *",
            testScript: [
              "#!/bin/sh",
              "set +e",
              'RESULT=$(echo "go" | al-subagent agent-stats-callee)',
              "RC=$?",
              "set -e",
              'test "$RC" -eq 0 || { echo "al-subagent exit=$RC"; exit 1; }',
              'CALL_ID=$(echo "$RESULT" | jq -r .callId)',
              "set +e",
              'al-subagent-wait "$CALL_ID" --timeout 60',
              "WAIT_RC=$?",
              "set -e",
              'test "$WAIT_RC" -eq 0 || { echo "al-subagent-wait exit=$WAIT_RC"; exit 1; }',
              "exit 0",
            ].join("\n"),
          },
          {
            name: "agent-stats-callee",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\necho 'callee ran'\nexit 0\n",
          },
        ],
      });

      await harness.start();

      // Trigger the caller which will subagent the callee
      await harness.triggerAgent("agent-stats-caller");

      const callerResult = await harness.waitForRunResult("agent-stats-caller", 120_000);
      expect(callerResult.result).toBe("completed");
      const calleeResult = await harness.waitForRunResult("agent-stats-callee", 60_000);
      expect(calleeResult.result).toBe("completed");

      // Brief wait for stats to be persisted
      await new Promise((r) => setTimeout(r, 500));

      // Verify activity?triggerType=agent returns the callee's agent-triggered run
      const actRes = await statsAPI(
        harness,
        "/api/stats/activity?agent=agent-stats-callee&triggerType=agent",
      );
      expect(actRes.status).toBe(200);
      const actBody = await actRes.json() as { rows: Array<Record<string, unknown>>; total: number };
      expect(actBody.total).toBeGreaterThanOrEqual(1);

      const row = actBody.rows[0]!;
      expect(row.triggerType).toBe("agent");
      // triggerSource should be the caller's agent name
      expect(row.triggerSource).toBe("agent-stats-caller");
      expect(row.result).toBe("completed");
    });

    it("triggers?triggerType=agent filters to agent-triggered runs only", async () => {
      // The /api/stats/triggers endpoint with ?triggerType=agent should only
      // return runs where the trigger was another agent.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "agent-trigger-caller",
            schedule: "0 0 31 2 *",
            testScript: [
              "#!/bin/sh",
              "set +e",
              'RESULT=$(echo "go" | al-subagent agent-trigger-worker)',
              "RC=$?",
              "set -e",
              'test "$RC" -eq 0 || { echo "al-subagent exit=$RC"; exit 1; }',
              'CALL_ID=$(echo "$RESULT" | jq -r .callId)',
              "set +e",
              'al-subagent-wait "$CALL_ID" --timeout 60',
              "WAIT_RC=$?",
              "set -e",
              'test "$WAIT_RC" -eq 0 || { echo "al-subagent-wait exit=$WAIT_RC"; exit 1; }',
              "exit 0",
            ].join("\n"),
          },
          {
            name: "agent-trigger-worker",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\necho 'worker ran'\nexit 0\n",
          },
        ],
      });

      await harness.start();

      await harness.triggerAgent("agent-trigger-caller");

      await harness.waitForRunResult("agent-trigger-caller", 120_000);
      await harness.waitForRunResult("agent-trigger-worker", 60_000);

      await new Promise((r) => setTimeout(r, 500));

      // Fetch triggers filtered by triggerType=agent (should get the worker's run)
      const triggerRes = await statsAPI(
        harness,
        "/api/stats/triggers?triggerType=agent&agent=agent-trigger-worker",
      );
      expect(triggerRes.status).toBe(200);
      const triggerBody = await triggerRes.json() as { triggers: Array<Record<string, unknown>>; total: number };
      expect(triggerBody.total).toBeGreaterThanOrEqual(1);

      const trigger = triggerBody.triggers[0]!;
      expect(trigger.triggerType).toBe("agent");
      // triggerSource should be the caller's name
      expect(trigger.triggerSource).toBe("agent-trigger-caller");
    });
  },
);
