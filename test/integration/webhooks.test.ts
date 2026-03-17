import { describe, it, expect, afterEach, beforeAll } from "vitest";
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
          testScript: `#!/bin/bash\necho "webhook triggered"\nexit 0\n`,
        },
      ],
      globalConfig: {
        webhooks: {
          "test-hook": { type: "test" },
        },
      },
    });

    await harness.start();
    // Wait for image builds to complete (initial run won't happen since no schedule)
    await harness.waitForSettle(5000);

    const res = await harness.sendWebhook({
      source: "test",
      event: "test-event",
      repo: "acme/app",
      sender: "tester",
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.matched).toBeGreaterThanOrEqual(1);

    // Wait for agent to complete
    await harness.waitForAgentRun("webhook-agent");
    expect(harness.getRunnerPool("webhook-agent")?.hasRunningJobs).toBe(false);
  });

  it("filters webhooks by event type", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "filtered-agent",
          webhooks: [{ source: "test-hook", events: ["deploy"] }],
          testScript: `#!/bin/bash\nexit 0\n`,
        },
      ],
      globalConfig: {
        webhooks: {
          "test-hook": { type: "test" },
        },
      },
    });

    await harness.start();
    await harness.waitForSettle(5000);

    // Send a non-matching event
    const res1 = await harness.sendWebhook({
      source: "test",
      event: "push",
      repo: "acme/app",
      sender: "tester",
    });
    expect(res1.ok).toBe(true);
    const body1 = await res1.json();
    expect(body1.matched).toBe(0);

    // Send a matching event
    const res2 = await harness.sendWebhook({
      source: "test",
      event: "deploy",
      repo: "acme/app",
      sender: "tester",
    });
    expect(res2.ok).toBe(true);
    const body2 = await res2.json();
    expect(body2.matched).toBeGreaterThanOrEqual(1);
  });
});
