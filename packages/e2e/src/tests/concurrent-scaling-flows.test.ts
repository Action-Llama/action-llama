/**
 * E2E tests for agent concurrent scaling.
 *
 * These tests verify that:
 * - An agent configured with `scale = 2` registers that scale in the dashboard
 * - Two simultaneous webhook triggers both get matched (both runners available)
 * - The trigger history records both dispatched events
 * - The control API can update an agent's scale at runtime
 *
 * Uses the "test" webhook provider (no credentials required).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { E2ETestContext, type ContainerInfo } from "../harness.js";
import { setupLocalActionLlama, getSchedulerLogs } from "../containers/local.js";

const GATEWAY_PORT = 8383;
const API_KEY = "concurrent-scaling-e2e-api-key-54321";
const COOKIE_JAR = "/tmp/cookies-scaling.txt";

/**
 * Start the scheduler with gateway enabled and wait until the health
 * endpoint responds.  Returns when the gateway is ready for requests.
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

  // Configure gateway port + test webhook source in config.toml.
  // The "test" provider skips HMAC validation and accepts JSON payloads.
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

  // Start the scheduler in headless mode (starts the gateway)
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

describe("Agent Concurrent Scaling", { timeout: 300000 }, () => {
  let context: E2ETestContext;
  let container: ContainerInfo;

  beforeAll(async () => {
    context = new E2ETestContext();
    await context.setup();

    container = await setupLocalActionLlama(context);

    // Create an agent with scale=2 and a webhook trigger.
    // No schedule — only triggered by webhooks.
    const agentDir = "/home/testuser/test-project/agents/scale-agent";
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
description: "Concurrent scaling test agent"
---

# Scale Test Agent

You are a test agent for verifying concurrent execution scaling.
EOF`,
    ]);

    // Configure agent with scale=2 and a webhook trigger.
    await context.executeInContainer(container, [
      "bash",
      "-c",
      `cat > ${agentDir}/config.toml << 'EOF'
models = ["sonnet"]
credentials = ["github_token", "anthropic_key"]
scale = 2

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

    // Wait for scale-agent to become idle (image built) before running tests.
    // This prevents race conditions where webhooks arrive before the runner pool
    // is set up (which happens after image build completes).
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const res = await curl(
          context,
          container,
          `http://localhost:${GATEWAY_PORT}/api/dashboard/status`,
        );
        const body = JSON.parse(res);
        const agent = body.agents?.find(
          (a: { name: string }) => a.name === "scale-agent",
        );
        if (agent && (agent.state === "idle" || agent.state === "error")) {
          break; // Image built, agent ready
        }
      } catch {
        // not ready yet
      }
    }
  }, 300000);

  afterAll(async () => {
    if (context && container) {
      await stopGateway(context, container);
    }
    if (context) {
      await context.cleanup();
    }
  });

  // -- Scale Configuration --------------------------------------------------

  it("agent status reflects configured scale=2", async () => {
    const res = await curl(
      context,
      container,
      `http://localhost:${GATEWAY_PORT}/api/dashboard/status`,
    );
    const body = JSON.parse(res);

    expect(Array.isArray(body.agents)).toBe(true);
    const agent = body.agents.find((a: { name: string }) => a.name === "scale-agent");
    expect(agent).toBeDefined();
    // The scheduler registers the agent with the configured scale
    expect(agent.scale).toBe(2);
    // Before any triggers the agent should be idle
    expect(agent.state).toBe("idle");
    expect(agent.runningCount).toBe(0);
  });

  // -- Parallel Trigger Dispatch Verification --------------------------------

  it("two consecutive webhook triggers both match the scale-2 agent", async () => {
    // Helper to dispatch a single webhook event
    const dispatchWebhook = (issueNumber: number) => {
      const payload = JSON.stringify({
        event: "issues",
        action: "opened",
        repo: "test-org/test-repo",
        number: issueNumber,
        title: `Concurrent test issue ${issueNumber}`,
        sender: "scale-tester",
      });
      return context.executeInContainer(container, [
        "bash",
        "-c",
        `curl -s -X POST -H 'Content-Type: application/json' -d '${payload.replace(/'/g, "'\\''")}' http://localhost:${GATEWAY_PORT}/webhooks/test 2>/dev/null`,
      ]);
    };

    // Trigger first event — runner 1 should pick it up
    const raw1 = await dispatchWebhook(1001);
    const r1 = JSON.parse(raw1);
    expect(r1.ok).toBe(true);
    expect(r1.matched).toBeGreaterThanOrEqual(1);

    // Trigger second event immediately — runner 2 should pick it up (runner 1 is busy).
    // With scale=2 there are two runners in the pool; both webhooks can be accepted
    // without blocking or dropping either one.
    const raw2 = await dispatchWebhook(1002);
    const r2 = JSON.parse(raw2);
    expect(r2.ok).toBe(true);
    expect(r2.matched).toBeGreaterThanOrEqual(1);
  });

  it("trigger history records both dispatched webhook events", async () => {
    // Wait briefly for the stats store to commit both trigger receipts
    await new Promise((r) => setTimeout(r, 1000));

    // Query all triggers (all=1 to include dead-letters too)
    const statsRes = await curl(
      context,
      container,
      `'http://localhost:${GATEWAY_PORT}/api/stats/triggers?limit=50&offset=0&all=1'`,
    );
    const stats = JSON.parse(statsRes);

    expect(stats).toHaveProperty("triggers");
    expect(stats).toHaveProperty("total");
    expect(Array.isArray(stats.triggers)).toBe(true);
    // Both webhook events should have been recorded in the trigger history
    expect(stats.total).toBeGreaterThanOrEqual(2);

    // Both triggers should reference the scale-agent
    const agentTriggers = stats.triggers.filter(
      (t: { agentName?: string }) => t.agentName === "scale-agent",
    );
    expect(agentTriggers.length).toBeGreaterThanOrEqual(2);
  });

  // -- Runtime Scale Update -------------------------------------------------

  it("control API updates agent scale at runtime", async () => {
    // Update scale-agent from 2 → 3 via the control endpoint
    const res = await context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -sf -b ${COOKIE_JAR} -X POST -H 'Content-Type: application/json' -d '{"scale":3}' http://localhost:${GATEWAY_PORT}/control/agents/scale-agent/scale`,
    ]);
    const body = JSON.parse(res);
    expect(body.success).toBe(true);

    // Wait briefly for the status tracker to update
    await new Promise((r) => setTimeout(r, 500));

    // Verify the scale is now 3 in the status API
    const statusRes = await curl(
      context,
      container,
      `http://localhost:${GATEWAY_PORT}/api/dashboard/status`,
    );
    const status = JSON.parse(statusRes);
    const agent = status.agents.find(
      (a: { name: string }) => a.name === "scale-agent",
    );
    expect(agent).toBeDefined();
    expect(agent.scale).toBe(3);
  });
});
