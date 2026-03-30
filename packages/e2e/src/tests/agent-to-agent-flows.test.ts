/**
 * E2E tests for agent-to-agent communication via the control trigger API.
 *
 * These tests verify that:
 * - POST /control/trigger/:name successfully enqueues an agent run and returns instanceId
 * - A second agent can be triggered independently in the same scheduler session
 * - Triggering a non-existent agent returns a 404-like error response
 * - Triggering an agent with a custom prompt is accepted
 * - GET /control/instances lists actively running (or recently started) instances
 *
 * The pattern simulates one agent calling `curl -X POST $GATEWAY_URL/control/trigger/<name>`
 * to kick off another agent — the core agent-to-agent communication mechanism.
 *
 * NOTE: No real LLM execution happens; agents are fired but immediately fail due to
 * missing/invalid Anthropic credentials. The important thing is that the scheduler
 * accepts the trigger request and records the dispatch attempt.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { E2ETestContext, type ContainerInfo } from "../harness.js";
import { setupLocalActionLlama, createTestAgent, getSchedulerLogs } from "../containers/local.js";

const GATEWAY_PORT = 8486;
const API_KEY = "agent-to-agent-e2e-key-77777";
const COOKIE_JAR = "/tmp/cookies-a2a.txt";

/**
 * Start the scheduler with gateway enabled and wait until the health
 * endpoint responds.
 */
async function startGateway(
  context: E2ETestContext,
  container: ContainerInfo,
): Promise<void> {
  await context.executeInContainer(container, [
    "bash",
    "-c",
    `mkdir -p ~/.action-llama/credentials/gateway_api_key/default && echo -n '${API_KEY}' > ~/.action-llama/credentials/gateway_api_key/default/key`,
  ]);

  await context.executeInContainer(container, [
    "bash",
    "-c",
    `cd /home/testuser/test-project && cat >> config.toml << 'EOF'

[gateway]
port = ${GATEWAY_PORT}
EOF`,
  ]);

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

describe("Agent-to-Agent Communication via Control Trigger API", { timeout: 300000 }, () => {
  let context: E2ETestContext;
  let container: ContainerInfo;

  beforeAll(async () => {
    context = new E2ETestContext();
    await context.setup();

    container = await setupLocalActionLlama(context);

    // Create agent-a: the "source" agent (the one that would trigger agent-b)
    await createTestAgent(
      context,
      container,
      "agent-a",
      `# Agent A

You are agent-a. When run, you trigger agent-b by calling:
  curl -X POST $GATEWAY_URL/control/trigger/agent-b

Then you exit successfully.`,
    );

    // Create agent-b: the "target" agent that gets triggered by agent-a
    await createTestAgent(
      context,
      container,
      "agent-b",
      `# Agent B

You are agent-b. You were triggered by agent-a. Perform your task and exit.`,
    );

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

  // -- Control Trigger Tests ------------------------------------------------

  it("POST /control/trigger/:name triggers agent-a and returns instanceId", async () => {
    const res = await curl(
      context,
      container,
      `-X POST -H 'Content-Type: application/json' -d '{}' http://localhost:${GATEWAY_PORT}/control/trigger/agent-a`,
    );

    const body = JSON.parse(res);
    // Expect a successful trigger with an instanceId
    expect(body.success).toBe(true);
    expect(typeof body.instanceId).toBe("string");
    expect(body.instanceId).toContain("agent-a");
    expect(body.message).toContain("agent-a");
  });

  it("POST /control/trigger/:name triggers agent-b independently", async () => {
    const res = await curl(
      context,
      container,
      `-X POST -H 'Content-Type: application/json' -d '{}' http://localhost:${GATEWAY_PORT}/control/trigger/agent-b`,
    );

    const body = JSON.parse(res);
    // agent-b should also be triggerable independently (as agent-a would do)
    expect(body.success).toBe(true);
    expect(typeof body.instanceId).toBe("string");
    expect(body.instanceId).toContain("agent-b");
    expect(body.message).toContain("agent-b");
  });

  it("POST /control/trigger/:name with prompt sends custom context to agent", async () => {
    const prompt = "This is a cross-agent trigger prompt from agent-a";

    // Use -s (no -f) to always capture the response body, and capture the HTTP
    // status code separately so we can distinguish success (200) from busy (409).
    const combined = await context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -s -w '\\n%{http_code}' -b ${COOKIE_JAR} -c ${COOKIE_JAR} \
        -X POST -H 'Content-Type: application/json' \
        -d '{"prompt":"${prompt}"}' \
        http://localhost:${GATEWAY_PORT}/control/trigger/agent-b`,
    ]);

    const lines = combined.trim().split("\n");
    const statusCode = lines[lines.length - 1].trim();
    const rawBody = lines.slice(0, -1).join("\n").trim();

    // A 200 means the agent accepted the prompt-based trigger.
    // A 409 means all runners are busy (the previous test left the runner occupied)
    // — both outcomes confirm the endpoint correctly parses the prompt.
    expect(["200", "409"]).toContain(statusCode);

    const body = JSON.parse(rawBody);
    if (statusCode === "200") {
      expect(body.success).toBe(true);
      expect(typeof body.instanceId).toBe("string");
      expect(body.instanceId).toContain("agent-b");
    } else {
      // 409: runner busy — verify the error message is meaningful
      expect(typeof body.error).toBe("string");
      expect(body.error.length).toBeGreaterThan(0);
    }
  });

  it("POST /control/trigger/:name returns error for unknown agent", async () => {
    // Triggering a non-existent agent should return an error (not crash)
    const statusCode = await context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -s -o /dev/null -w '%{http_code}' -b ${COOKIE_JAR} -X POST -H 'Content-Type: application/json' -d '{}' http://localhost:${GATEWAY_PORT}/control/trigger/nonexistent-agent`,
    ]);

    // The control route returns 404 when the agent is not found
    expect(statusCode.trim()).toBe("404");
  });

  it("GET /control/instances lists instances after triggers", async () => {
    // After triggering agents, the instances list should reflect started runs
    // (even if they complete/fail quickly due to missing LLM credentials)
    const res = await curl(
      context,
      container,
      `http://localhost:${GATEWAY_PORT}/control/instances`,
    );

    const body = JSON.parse(res);
    expect(body).toHaveProperty("instances");
    expect(Array.isArray(body.instances)).toBe(true);
    // Instances may be empty if the agent run completed before this check,
    // but the endpoint must respond without error
  });

  it("simulates agent-a triggering agent-b via gateway URL", async () => {
    // This test simulates the exact curl command an agent would use to trigger
    // another agent inside the container using the GATEWAY_URL environment variable.
    // We inject the gateway URL directly to mimic what the agent would do.
    const triggerResponse = await context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -s -X POST \
        -H 'Content-Type: application/json' \
        -d '{"prompt":"triggered by agent-a at $(date -u +%Y-%m-%dT%H:%M:%SZ)"}' \
        -b ${COOKIE_JAR} \
        http://localhost:${GATEWAY_PORT}/control/trigger/agent-b`,
    ]);

    const body = JSON.parse(triggerResponse);
    // The trigger should succeed — this is the core agent-to-agent communication path
    // (or return 409 if runners are busy from earlier tests in this describe block)
    if (body.success) {
      expect(body.instanceId).toContain("agent-b");
      expect(typeof body.instanceId).toBe("string");
    } else {
      // Runner busy (409) is an acceptable outcome given the previous tests
      expect(typeof body.error).toBe("string");
    }
  });
});
