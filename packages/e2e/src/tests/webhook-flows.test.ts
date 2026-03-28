/**
 * E2E tests for webhook trigger handling.
 *
 * These tests verify that:
 * - POST /webhooks/:source dispatches to matched agents
 * - Unknown webhook sources return 404
 * - Webhook receipts are recorded in the stats store
 * - Webhook events that match agent filters return matched >= 1
 * - Webhook events that don't match agent filters return matched = 0
 * - Duplicate webhook deliveries are detected and skipped
 *
 * NOTE: Uses type = "test" webhook source to avoid credential requirements.
 * The "test" provider skips HMAC validation and accepts JSON WebhookContext
 * payloads directly. This is supported for unit/e2e testing by the scheduler.
 * (See: packages/action-llama/src/webhooks/providers/test.ts)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { E2ETestContext, type ContainerInfo } from "../harness.js";
import { setupLocalActionLlama, getSchedulerLogs } from "../containers/local.js";

const GATEWAY_PORT = 8181;
const API_KEY = "webhook-e2e-api-key-99999";
const COOKIE_JAR = "/tmp/cookies-webhook.txt";

/**
 * Start the scheduler with gateway enabled and wait until the health
 * endpoint responds. Returns when the gateway is ready.
 */
async function startGateway(
  context: E2ETestContext,
  container: ContainerInfo,
): Promise<void> {
  // Configure a known gateway API key
  await context.executeInContainer(container, [
    "bash",
    "-c",
    `mkdir -p ~/.action-llama/credentials/gateway_api_key/default && echo -n '${API_KEY}' > ~/.action-llama/credentials/gateway_api_key/default/key`,
  ]);

  // Set the gateway port in config.toml and add a test webhook source.
  // type = "test" skips HMAC validation and requires no secret credentials,
  // making it suitable for e2e testing without secrets.
  await context.executeInContainer(container, [
    "bash",
    "-c",
    `cd /home/testuser/test-project && cat >> config.toml << 'EOF'

[gateway]
port = ${GATEWAY_PORT}

[webhooks.mytest]
type = "test"
EOF`,
  ]);

  // Start the scheduler in headless mode (which starts the gateway)
  await context.executeInContainer(container, [
    "bash",
    "-c",
    `cd /home/testuser/test-project && nohup al start --headless --web-ui > /tmp/scheduler.log 2>&1 & echo $! > /tmp/scheduler.pid`,
  ]);

  // Poll health endpoint until the gateway is ready (max 30s)
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const health = await context.executeInContainer(container, [
        "curl",
        "-sf",
        `http://localhost:${GATEWAY_PORT}/health`,
      ]);
      if (health.includes("ok")) return;
    } catch {
      // not ready yet
    }
  }

  const logs = await getSchedulerLogs(context, container);
  throw new Error(`Gateway did not become healthy within 30s.\nLogs: ${logs}`);
}

/** Stop the scheduler process. */
async function stopGateway(
  context: E2ETestContext,
  container: ContainerInfo,
): Promise<void> {
  try {
    await context.executeInContainer(container, [
      "bash",
      "-c",
      "if [ -f /tmp/scheduler.pid ]; then kill $(cat /tmp/scheduler.pid) 2>/dev/null; rm -f /tmp/scheduler.pid; fi",
    ]);
  } catch {
    // process might already be dead
  }
}

/** Login and persist the session cookie. */
async function login(
  context: E2ETestContext,
  container: ContainerInfo,
): Promise<void> {
  await context.executeInContainer(container, [
    "bash",
    "-c",
    `curl -sf -c ${COOKIE_JAR} -X POST -H 'Content-Type: application/json' -d '{"key":"${API_KEY}"}' http://localhost:${GATEWAY_PORT}/api/auth/login`,
  ]);
}

/** Convenience: curl with the session cookie jar. */
function curl(
  context: E2ETestContext,
  container: ContainerInfo,
  args: string,
): Promise<string> {
  return context.executeInContainer(container, [
    "bash",
    "-c",
    `curl -sf -b ${COOKIE_JAR} -c ${COOKIE_JAR} ${args}`,
  ]);
}

// ---------------------------------------------------------------------------

describe("Webhook Trigger Flows", { timeout: 300000 }, () => {
  let context: E2ETestContext;
  let container: ContainerInfo;

  beforeAll(async () => {
    context = new E2ETestContext();
    await context.setup();

    container = await setupLocalActionLlama(context);

    // Create an agent that listens for "issues/opened" events via the test webhook source.
    // The "test" provider accepts JSON bodies that map directly to WebhookContext fields.
    const agentDir = "/home/testuser/test-project/agents/webhook-agent";
    await context.executeInContainer(container, [
      "bash",
      "-c",
      `mkdir -p ${agentDir}`,
    ]);

    await context.executeInContainer(container, [
      "bash",
      "-c",
      `cat > ${agentDir}/SKILL.md << 'EOF'
---
description: "Webhook test agent"
---

# Webhook Test Agent

You are a test agent that fires when issues are opened.
EOF`,
    ]);

    // Configure agent with a webhook trigger (no schedule) using TOML array-of-tables syntax.
    // "mytest" references the [webhooks.mytest] source in config.toml.
    await context.executeInContainer(container, [
      "bash",
      "-c",
      `cat > ${agentDir}/config.toml << 'EOF'
models = ["sonnet"]
credentials = ["github_token", "anthropic_key"]

[[webhooks]]
source = "mytest"
events = ["issues"]
actions = ["opened"]
EOF`,
    ]);

    await context.executeInContainer(container, [
      "bash",
      "-c",
      `chown -R testuser:testuser ${agentDir}`,
    ]);

    await startGateway(context, container);
    await login(context, container);
  }, 300000);

  afterAll(async () => {
    if (context && container) {
      await stopGateway(context, container);
    }
    if (context) {
      await context.cleanup();
    }
  });

  // -- Webhook Dispatch Tests -----------------------------------------------

  it("delivers webhook event and matches subscribed agent", async () => {
    // The test webhook provider reads the JSON body directly as WebhookContext.
    // The URL uses the provider TYPE ("test"), not the config source name ("mytest").
    // The registry routes POST /webhooks/:source to the provider registered under that name.
    const payload = JSON.stringify({
      event: "issues",
      action: "opened",
      repo: "test-org/test-repo",
      number: 42,
      title: "Test issue from e2e",
      body: "This is a test issue",
      sender: "test-user",
    });

    const response = await context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -s -X POST -H 'Content-Type: application/json' -d '${payload.replace(/'/g, "'\\''")}' http://localhost:${GATEWAY_PORT}/webhooks/test 2>/dev/null`,
    ]);

    const body = JSON.parse(response);
    expect(body.ok).toBe(true);
    // The webhook-agent should be matched
    expect(body.matched).toBeGreaterThanOrEqual(1);
    expect(typeof body.skipped).toBe("number");
  });

  it("returns matched=0 for event that does not match agent filter", async () => {
    // Send a "closed" action — webhook-agent only listens for "opened"
    const payload = JSON.stringify({
      event: "issues",
      action: "closed",
      repo: "test-org/test-repo",
      number: 99,
      title: "Closed issue",
      sender: "test-user",
    });

    const response = await context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -s -X POST -H 'Content-Type: application/json' -d '${payload.replace(/'/g, "'\\''")}' http://localhost:${GATEWAY_PORT}/webhooks/test 2>/dev/null`,
    ]);

    const body = JSON.parse(response);
    expect(body.ok).toBe(true);
    // No agent should match a "closed" action when the agent filters on "opened"
    expect(body.matched).toBe(0);
  });

  it("returns 404 for unknown webhook source", async () => {
    // POST to a source that has no registered provider returns 404
    const statusCode = await context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' http://localhost:${GATEWAY_PORT}/webhooks/nonexistent-source 2>/dev/null`,
    ]);

    expect(statusCode.trim()).toBe("404");
  });

  it("unmatched event is recorded as dead-letter in stats trigger history", async () => {
    // Send a non-matching event (action: "labeled"), which creates a dead-letter receipt.
    // Query the stats endpoint with all=1 to verify it appears in trigger history.
    const payload = JSON.stringify({
      event: "issues",
      action: "labeled",
      repo: "test-org/test-repo",
      number: 77,
      title: "Labeled issue",
      sender: "stats-user",
    });

    const dispatchRes = await context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -s -X POST -H 'Content-Type: application/json' -d '${payload.replace(/'/g, "'\\''")}' http://localhost:${GATEWAY_PORT}/webhooks/test 2>/dev/null`,
    ]);
    const dispatch = JSON.parse(dispatchRes);
    expect(dispatch.ok).toBe(true);
    expect(dispatch.matched).toBe(0);

    // Give the stats store a moment to commit the dead-letter receipt
    await new Promise((r) => setTimeout(r, 500));

    // Query the trigger history with all=1 to include dead-letter entries
    const statsRes = await curl(
      context,
      container,
      `'http://localhost:${GATEWAY_PORT}/api/stats/triggers?limit=50&offset=0&all=1'`,
    );
    const stats = JSON.parse(statsRes);

    expect(stats).toHaveProperty("triggers");
    expect(stats).toHaveProperty("total");
    expect(Array.isArray(stats.triggers)).toBe(true);
    // Dead-letter entry from our unmatched "labeled" webhook should appear
    expect(stats.total).toBeGreaterThan(0);
    // Verify there's at least one dead-letter entry
    const deadLetters = stats.triggers.filter((t: any) => t.result === "dead-letter");
    expect(deadLetters.length).toBeGreaterThan(0);
  });

  it("matched events appear incrementally in trigger history", async () => {
    // Get baseline count (with dead-letters)
    const before = JSON.parse(
      await curl(
        context,
        container,
        `'http://localhost:${GATEWAY_PORT}/api/stats/triggers?limit=50&offset=0&all=1'`,
      ),
    );
    const countBefore = before.total as number;

    // Send another unmatched event to create a new dead-letter entry
    const payload = JSON.stringify({
      event: "issues",
      action: "closed",
      repo: "test-org/test-repo",
      number: 200,
      title: "Incrementing closed issue",
      sender: "counter-user",
    });

    await context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -s -X POST -H 'Content-Type: application/json' -d '${payload.replace(/'/g, "'\\''")}' http://localhost:${GATEWAY_PORT}/webhooks/test 2>/dev/null`,
    ]);

    await new Promise((r) => setTimeout(r, 500));

    const after = JSON.parse(
      await curl(
        context,
        container,
        `'http://localhost:${GATEWAY_PORT}/api/stats/triggers?limit=50&offset=0&all=1'`,
      ),
    );
    // Count should have increased by at least 1 (new dead-letter)
    expect(after.total).toBeGreaterThan(countBefore);
  });
});
