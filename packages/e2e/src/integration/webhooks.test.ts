import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: webhooks", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("triggers agent via POST /webhooks/test", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "webhook-agent",
          webhooks: [{ source: "test-hook" }],
          testScript: [
            "#!/bin/sh",
            "set -e",
            // Verify PROMPT contains webhook context
            'echo "webhook-agent: prompt=$PROMPT"',
            'test -n "$GATEWAY_URL" || exit 1',
            "exit 0",
          ].join("\n"),
        },
      ],
      globalConfig: {
        webhooks: { "test-hook": { type: "test" } },
      },
    });

    await harness.start();

    const res = await harness.sendWebhook({
      source: "test",
      event: "deploy",
      action: "created",
      repo: "acme/app",
      sender: "tester",
      title: "Deploy v1.0",
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.matched).toBeGreaterThanOrEqual(1);

    // Wait for the webhook-triggered run via event bus
    const run = await harness.waitForRunResult("webhook-agent");
    expect(run.result).toBe("completed");
  });

  it("filters webhooks — non-matching events are skipped", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "filtered-agent",
          webhooks: [{ source: "test-hook", events: ["deploy"] }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { "test-hook": { type: "test" } },
      },
    });

    await harness.start();

    // Non-matching event → matched=0
    const res1 = await harness.sendWebhook({
      event: "push",
      repo: "acme/app",
      sender: "tester",
    });
    expect(res1.ok).toBe(true);
    expect((await res1.json()).matched).toBe(0);

    // Matching event → matched≥1
    const res2 = await harness.sendWebhook({
      event: "deploy",
      repo: "acme/app",
      sender: "tester",
    });
    expect(res2.ok).toBe(true);
    expect((await res2.json()).matched).toBeGreaterThanOrEqual(1);
  });

  it("webhook-triggered agent can use al-subagent to trigger another agent", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "webhook-caller",
          webhooks: [{ source: "test-hook" }],
          testScript: [
            "#!/bin/sh",
            // al-subagent — verify exit 0 + ok=true
            "set +e",
            'RESULT=$(echo "triggering responder" | al-subagent responder)',
            "RC=$?",
            "set -e",
            'test "$RC" -eq 0 || { echo "al-subagent exit=$RC: $RESULT"; exit 1; }',
            'OK=$(echo "$RESULT" | jq -r .ok)',
            'test "$OK" = "true" || { echo "al-subagent ok=$OK: $RESULT"; exit 1; }',
            "exit 0",
          ].join("\n"),
        },
        {
          name: "responder",
          schedule: "0 0 31 2 *", // needs schedule or webhook to be valid
          testScript: [
            "#!/bin/sh",
            'echo "responder received call"',
            "exit 0",
          ].join("\n"),
        },
      ],
      globalConfig: {
        webhooks: { "test-hook": { type: "test" } },
      },
    });

    await harness.start();

    // Manually trigger the responder agent since there are no more automatic initial runs
    await harness.triggerAgent("responder");
    
    // Wait for responder's manual run
    await harness.waitForRunResult("responder");

    // Fire webhook
    await harness.sendWebhook({
      event: "test",
      repo: "acme/app",
      sender: "tester",
    });

    // Wait for webhook-caller's run (triggered by webhook)
    const callerRun = await harness.waitForRunResult("webhook-caller");
    expect(callerRun.result).toBe("completed");

    // Wait for responder's triggered run (triggered by webhook-caller via al-subagent)
    const responderRun = await harness.waitForRunResult("responder");
    expect(responderRun.result).toBe("completed");
  });
});
