/**
 * E2E tests for scheduler pause and resume functionality.
 *
 * These tests verify that:
 * - POST /control/pause pauses the scheduler (new webhook triggers are skipped)
 * - GET /control/status reflects paused=true after pause
 * - Webhook events delivered while paused are skipped (matched=0, skipped>=1)
 * - POST /control/resume resumes the scheduler
 * - GET /control/status reflects paused=false after resume
 * - Webhook events delivered after resume are matched again
 *
 * NOTE: Uses type = "test" webhook source to avoid credential requirements.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { E2ETestContext, type ContainerInfo } from "../harness.js";
import { setupLocalActionLlama, getSchedulerLogs } from "../containers/local.js";

const GATEWAY_PORT = 8484;
const API_KEY = "scheduler-pause-e2e-key-77777";
const COOKIE_JAR = "/tmp/cookies-pause-resume.txt";

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

[webhooks.pausetest]
type = "test"
EOF`,
  ]);

  await context.executeInContainer(container, [
    "bash",
    "-c",
    `cd /home/testuser/test-project && nohup al start --headless --web-ui > /tmp/scheduler.log 2>&1 & echo $! > /tmp/scheduler.pid`,
  ]);

  // Poll until healthy (max 30s)
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

describe("Scheduler Pause and Resume", { timeout: 300000 }, () => {
  let context: E2ETestContext;
  let container: ContainerInfo;

  beforeAll(async () => {
    context = new E2ETestContext();
    await context.setup();

    container = await setupLocalActionLlama(context);

    // Create an agent with a webhook trigger
    const agentDir = "/home/testuser/test-project/agents/pause-test-agent";
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
description: "Pause/resume test agent"
---

# Pause Test Agent

Test agent for verifying scheduler pause and resume behavior.
EOF`,
    ]);

    await context.executeInContainer(container, [
      "bash",
      "-c",
      `cat > ${agentDir}/config.toml << 'EOF'
models = ["sonnet"]
credentials = ["github_token", "anthropic_key"]

[[webhooks]]
source = "pausetest"
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

    // Login to get session cookie
    await context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -sf -c ${COOKIE_JAR} -X POST -H 'Content-Type: application/json' -d '{"key":"${API_KEY}"}' http://localhost:${GATEWAY_PORT}/api/auth/login`,
    ]);

    // Wait for the agent to become idle (image built) before running tests.
    // This ensures the runner pool is set up and webhooks can be dispatched.
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
          (a: { name: string }) => a.name === "pause-test-agent",
        );
        if (agent && (agent.state === "idle" || agent.state === "error")) {
          break;
        }
      } catch {
        // not ready yet
      }
    }
  }, 300000);

  afterAll(async () => {
    if (context && container) {
      // Resume the scheduler before cleanup in case a test left it paused
      try {
        await context.executeInContainer(container, [
          "bash",
          "-c",
          `curl -sf -b ${COOKIE_JAR} -X POST http://localhost:${GATEWAY_PORT}/control/resume 2>/dev/null || true`,
        ]);
      } catch {
        // ignore
      }
      await stopGateway(context, container);
    }
    if (context) {
      await context.cleanup();
    }
  });

  // Helper: dispatch a webhook event to the test provider
  function dispatchWebhook(issueNumber: number): Promise<string> {
    const payload = JSON.stringify({
      event: "issues",
      action: "opened",
      repo: "test-org/pause-repo",
      number: issueNumber,
      title: `Pause test issue ${issueNumber}`,
      sender: "pause-tester",
    });
    return context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -s -X POST -H 'Content-Type: application/json' -d '${payload.replace(/'/g, "'\\''")}' http://localhost:${GATEWAY_PORT}/webhooks/test 2>/dev/null`,
    ]);
  }

  // -- Pre-pause baseline ---------------------------------------------------

  it("webhook is matched before scheduler is paused", async () => {
    const raw = await dispatchWebhook(1);
    const body = JSON.parse(raw);

    expect(body.ok).toBe(true);
    // Before pausing, the agent should match the webhook
    expect(body.matched).toBeGreaterThanOrEqual(1);
  });

  it("control status reports scheduler is not paused initially", async () => {
    const raw = await curl(
      context,
      container,
      `http://localhost:${GATEWAY_PORT}/control/status`,
    );
    const body = JSON.parse(raw);

    expect(body).toHaveProperty("scheduler");
    // Should not be paused at startup
    expect(body.scheduler.paused).toBe(false);
  });

  // -- Pause -----------------------------------------------------------------

  it("POST /control/pause pauses the scheduler", async () => {
    const raw = await context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -sf -b ${COOKIE_JAR} -X POST http://localhost:${GATEWAY_PORT}/control/pause 2>/dev/null`,
    ]);
    const body = JSON.parse(raw);

    expect(body.success).toBe(true);
    expect(body.message).toMatch(/paused/i);
  });

  it("control status reports scheduler is paused after pause", async () => {
    // Brief pause for the status tracker to reflect the new state
    await new Promise((r) => setTimeout(r, 200));

    const raw = await curl(
      context,
      container,
      `http://localhost:${GATEWAY_PORT}/control/status`,
    );
    const body = JSON.parse(raw);

    expect(body).toHaveProperty("scheduler");
    expect(body.scheduler.paused).toBe(true);
  });

  it("webhook event delivered while paused is skipped (not dispatched to agent)", async () => {
    // The scheduler is paused: the trigger callback returns false → skipped
    const raw = await dispatchWebhook(2);
    const body = JSON.parse(raw);

    expect(body.ok).toBe(true);
    // The agent matched the filter but the scheduler rejected the dispatch
    expect(body.matched).toBe(0);
    expect(body.skipped).toBeGreaterThanOrEqual(1);
  });

  // -- Resume ----------------------------------------------------------------

  it("POST /control/resume resumes the scheduler", async () => {
    const raw = await context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -sf -b ${COOKIE_JAR} -X POST http://localhost:${GATEWAY_PORT}/control/resume 2>/dev/null`,
    ]);
    const body = JSON.parse(raw);

    expect(body.success).toBe(true);
    expect(body.message).toMatch(/resumed/i);
  });

  it("control status reports scheduler is no longer paused after resume", async () => {
    await new Promise((r) => setTimeout(r, 200));

    const raw = await curl(
      context,
      container,
      `http://localhost:${GATEWAY_PORT}/control/status`,
    );
    const body = JSON.parse(raw);

    expect(body).toHaveProperty("scheduler");
    expect(body.scheduler.paused).toBe(false);
  });

  it("webhook event delivered after resume is matched again", async () => {
    const raw = await dispatchWebhook(3);
    const body = JSON.parse(raw);

    expect(body.ok).toBe(true);
    // After resume, the agent should match again
    expect(body.matched).toBeGreaterThanOrEqual(1);
  });

  // -- Dead-letter verification ----------------------------------------------

  it("skipped-while-paused webhook appears in trigger history as dead-letter", async () => {
    // Give the stats store a moment to commit the dead-letter receipt
    await new Promise((r) => setTimeout(r, 500));

    const statsRes = await curl(
      context,
      container,
      `'http://localhost:${GATEWAY_PORT}/api/stats/triggers?limit=50&offset=0&all=1'`,
    );
    const stats = JSON.parse(statsRes);

    expect(Array.isArray(stats.triggers)).toBe(true);
    expect(stats.total).toBeGreaterThan(0);

    // There should be at least one dead-letter entry (from the paused dispatch)
    const deadLetters = stats.triggers.filter((t: any) => t.result === "dead-letter");
    expect(deadLetters.length).toBeGreaterThan(0);
  });
});
