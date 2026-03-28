/**
 * E2E tests for stats and usage tracking.
 *
 * These tests verify that:
 * - GET /api/stats/agents/:name/runs returns paginated run records with correct schema
 * - GET /api/stats/agents/:name/runs/:instanceId returns { run: null } for unknown IDs
 * - GET /api/stats/webhooks/:receiptId returns a stored dead-letter webhook receipt
 * - GET /api/stats/triggers?all=1 includes dead-letter entries immediately after dispatch
 * - Trigger history totals increase after each webhook delivery
 * - GET /api/logs/scheduler returns scheduler log entries with cursor-based pagination
 * - GET /api/logs/agents/:name returns correct schema even when the agent has not run
 * - GET /api/logs/agents/:name returns 400 for invalid agent names
 *
 * NOTE: Uses type = "test" webhook source to avoid credential requirements.
 * Dead-letter receipts are created synchronously (no agent run needed), so
 * these tests do not require agents to complete execution.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { E2ETestContext, type ContainerInfo } from "../harness.js";
import { setupLocalActionLlama, getSchedulerLogs } from "../containers/local.js";

const GATEWAY_PORT = 8585;
const API_KEY = "stats-tracking-e2e-key-11111";
const COOKIE_JAR = "/tmp/cookies-stats-tracking.txt";

/** Start the scheduler with gateway and wait until health endpoint responds. */
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

[webhooks.statstest]
type = "test"
EOF`,
  ]);

  await context.executeInContainer(container, [
    "bash",
    "-c",
    `cd /home/testuser/test-project && nohup al start --headless --web-ui > /tmp/scheduler.log 2>&1 & echo $! > /tmp/scheduler.pid`,
  ]);

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

/** Authenticated curl helper. */
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

/** Login and persist session cookie. */
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

/** Dispatch a webhook payload to the test endpoint. */
function dispatchWebhook(
  context: E2ETestContext,
  container: ContainerInfo,
  payload: object,
): Promise<string> {
  const json = JSON.stringify(payload).replace(/'/g, "'\\''");
  return context.executeInContainer(container, [
    "bash",
    "-c",
    `curl -s -X POST -H 'Content-Type: application/json' -d '${json}' http://localhost:${GATEWAY_PORT}/webhooks/test 2>/dev/null`,
  ]);
}

// ---------------------------------------------------------------------------

describe("Stats and Usage Tracking", { timeout: 300000 }, () => {
  let context: E2ETestContext;
  let container: ContainerInfo;

  beforeAll(async () => {
    context = new E2ETestContext();
    await context.setup();

    container = await setupLocalActionLlama(context);

    // Create a webhook-triggered agent for stats testing.
    // It listens for issues/opened events only — so "closed" events become dead-letters.
    const agentDir = "/home/testuser/test-project/agents/stats-agent";
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
description: "Stats tracking test agent"
---

# Stats Test Agent

You are a test agent for verifying stats and usage tracking.
EOF`,
    ]);

    await context.executeInContainer(container, [
      "bash",
      "-c",
      `cat > ${agentDir}/config.toml << 'EOF'
models = ["sonnet"]
credentials = ["github_token", "anthropic_key"]

[[webhooks]]
source = "statstest"
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

  // -- Agent Runs Endpoint --------------------------------------------------

  it("GET /api/stats/agents/:name/runs returns correct schema when no runs exist", async () => {
    const res = await curl(
      context,
      container,
      `http://localhost:${GATEWAY_PORT}/api/stats/agents/stats-agent/runs?page=1&limit=10`,
    );
    const body = JSON.parse(res);

    expect(body).toHaveProperty("runs");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("page");
    expect(body).toHaveProperty("limit");
    expect(Array.isArray(body.runs)).toBe(true);
    // No runs have completed yet — table should be empty
    expect(body.total).toBe(0);
    expect(body.runs.length).toBe(0);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(10);
  });

  it("GET /api/stats/agents/:name/runs respects limit and page parameters", async () => {
    // Wrap URL in single quotes to prevent shell from interpreting '&' as a job separator
    const res = await curl(
      context,
      container,
      `'http://localhost:${GATEWAY_PORT}/api/stats/agents/stats-agent/runs?page=2&limit=5'`,
    );
    const body = JSON.parse(res);

    expect(body).toHaveProperty("runs");
    expect(body).toHaveProperty("page");
    expect(body).toHaveProperty("limit");
    // Page and limit must reflect the request parameters
    expect(body.page).toBe(2);
    expect(body.limit).toBe(5);
    expect(Array.isArray(body.runs)).toBe(true);
  });

  it("GET /api/stats/agents/:name/runs/:instanceId returns { run: null } for unknown ID", async () => {
    const res = await curl(
      context,
      container,
      `http://localhost:${GATEWAY_PORT}/api/stats/agents/stats-agent/runs/unknown-instance-id-12345`,
    );
    const body = JSON.parse(res);

    // When the run is not found, the API returns { run: null }
    expect(body).toHaveProperty("run");
    expect(body.run).toBeNull();
  });

  // -- Dead-Letter Receipts and Trigger History ----------------------------

  it("dispatching an unmatched webhook creates a dead-letter trigger entry", async () => {
    // "closed" action does not match stats-agent (which only listens for "opened").
    // This immediately creates a dead-letter receipt in the stats store.
    const raw = await dispatchWebhook(context, container, {
      event: "issues",
      action: "closed",
      repo: "test-org/stats-repo",
      number: 50,
      title: "Closed issue (should not match)",
      sender: "stats-tester",
    });

    const body = JSON.parse(raw);
    expect(body.ok).toBe(true);
    // stats-agent only listens for "opened" → no agents matched
    expect(body.matched).toBe(0);

    // Give the stats store a moment to commit the dead-letter receipt
    await new Promise((r) => setTimeout(r, 500));

    // Query trigger history with all=1 to include dead-letters
    const histRes = await curl(
      context,
      container,
      `'http://localhost:${GATEWAY_PORT}/api/stats/triggers?limit=50&offset=0&all=1'`,
    );
    const hist = JSON.parse(histRes);

    expect(Array.isArray(hist.triggers)).toBe(true);
    expect(hist.total).toBeGreaterThan(0);

    // There must be at least one dead-letter entry
    const deadLetters = hist.triggers.filter(
      (t: { result: string }) => t.result === "dead-letter",
    );
    expect(deadLetters.length).toBeGreaterThan(0);

    // Each dead-letter entry in the trigger history must have a webhookReceiptId
    for (const dl of deadLetters) {
      expect(typeof dl.webhookReceiptId).toBe("string");
      expect(dl.webhookReceiptId.length).toBeGreaterThan(0);
    }
  });

  it("GET /api/stats/webhooks/:receiptId returns the stored dead-letter receipt", async () => {
    // First dispatch another dead-letter event to ensure we have a fresh receipt
    const raw = await dispatchWebhook(context, container, {
      event: "issues",
      action: "closed",
      repo: "test-org/stats-repo",
      number: 51,
      title: "Another closed issue",
      sender: "receipt-tester",
    });

    const dispatch = JSON.parse(raw);
    expect(dispatch.ok).toBe(true);
    expect(dispatch.matched).toBe(0);

    await new Promise((r) => setTimeout(r, 500));

    // Retrieve the trigger history to get the receipt ID
    const histRes = await curl(
      context,
      container,
      `'http://localhost:${GATEWAY_PORT}/api/stats/triggers?limit=10&offset=0&all=1'`,
    );
    const hist = JSON.parse(histRes);

    const deadLetters = hist.triggers.filter(
      (t: { result: string; webhookReceiptId: string | null }) =>
        t.result === "dead-letter" && t.webhookReceiptId,
    );
    expect(deadLetters.length).toBeGreaterThan(0);

    // Use the most recent dead-letter receipt ID
    const receiptId = deadLetters[0].webhookReceiptId as string;

    // Look up the receipt by ID
    const receiptRes = await curl(
      context,
      container,
      `http://localhost:${GATEWAY_PORT}/api/stats/webhooks/${receiptId}`,
    );
    const receiptBody = JSON.parse(receiptRes);

    expect(receiptBody).toHaveProperty("receipt");
    expect(receiptBody.receipt).not.toBeNull();
    expect(receiptBody.receipt.id).toBe(receiptId);
    // Dead-letter receipts have status "dead-letter"
    expect(receiptBody.receipt.status).toBe("dead-letter");
  });

  it("GET /api/stats/webhooks/:receiptId returns 404 for unknown ID", async () => {
    // Unknown receipt returns 404
    const statusCode = await context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -s -o /dev/null -w '%{http_code}' -b ${COOKIE_JAR} http://localhost:${GATEWAY_PORT}/api/stats/webhooks/no-such-receipt-id`,
    ]);
    expect(statusCode.trim()).toBe("404");
  });

  // -- Trigger Count Increases After Events ---------------------------------

  it("trigger history total increases after each webhook delivery", async () => {
    // Record current total (with dead-letters)
    const before = JSON.parse(
      await curl(
        context,
        container,
        `'http://localhost:${GATEWAY_PORT}/api/stats/triggers?limit=50&offset=0&all=1'`,
      ),
    );
    const countBefore = before.total as number;

    // Dispatch another unmatched event to create a new dead-letter
    await dispatchWebhook(context, container, {
      event: "issues",
      action: "labeled",
      repo: "test-org/stats-repo",
      number: 99,
      title: "Labeled issue — creates new dead-letter",
      sender: "counter-tester",
    });

    await new Promise((r) => setTimeout(r, 500));

    const after = JSON.parse(
      await curl(
        context,
        container,
        `'http://localhost:${GATEWAY_PORT}/api/stats/triggers?limit=50&offset=0&all=1'`,
      ),
    );

    // Total should have increased by at least 1
    expect(after.total).toBeGreaterThan(countBefore);
  });

  // -- Log API Endpoints ----------------------------------------------------

  it("GET /api/logs/scheduler returns entries with cursor after scheduler starts", async () => {
    // Wait briefly to ensure the scheduler has written some log entries
    await new Promise((r) => setTimeout(r, 2000));

    const res = await curl(
      context,
      container,
      `http://localhost:${GATEWAY_PORT}/api/logs/scheduler?lines=50`,
    );
    const body = JSON.parse(res);

    // Verify response structure
    expect(body).toHaveProperty("entries");
    expect(body).toHaveProperty("cursor");
    expect(body).toHaveProperty("hasMore");
    expect(Array.isArray(body.entries)).toBe(true);
    // Scheduler should have written at least one log entry (e.g., "Starting scheduler...")
    expect(body.entries.length).toBeGreaterThan(0);

    // Each entry must have the required structured log fields
    const entry = body.entries[0];
    expect(entry).toHaveProperty("level");
    expect(entry).toHaveProperty("time");
    expect(entry).toHaveProperty("msg");
    expect(typeof entry.level).toBe("number");
    expect(typeof entry.time).toBe("number");
    expect(typeof entry.msg).toBe("string");
  });

  it("GET /api/logs/scheduler cursor-based pagination returns new entries", async () => {
    // First fetch to get a cursor
    const firstRes = await curl(
      context,
      container,
      `http://localhost:${GATEWAY_PORT}/api/logs/scheduler?lines=10`,
    );
    const firstBody = JSON.parse(firstRes);

    expect(firstBody).toHaveProperty("cursor");
    expect(typeof firstBody.cursor).toBe("string");

    // Use the cursor to poll for newer entries (may be empty if no new logs)
    const cursorEncoded = encodeURIComponent(firstBody.cursor);
    const pollRes = await curl(
      context,
      container,
      `"http://localhost:${GATEWAY_PORT}/api/logs/scheduler?lines=10&cursor=${cursorEncoded}"`,
    );
    const pollBody = JSON.parse(pollRes);

    // Cursor-based response must have the correct structure
    expect(pollBody).toHaveProperty("entries");
    expect(pollBody).toHaveProperty("cursor");
    expect(pollBody).toHaveProperty("hasMore");
    expect(Array.isArray(pollBody.entries)).toBe(true);
    // hasMore must be a boolean
    expect(typeof pollBody.hasMore).toBe("boolean");
  });

  it("GET /api/logs/agents/:name returns correct schema even if no agent ran", async () => {
    const res = await curl(
      context,
      container,
      `http://localhost:${GATEWAY_PORT}/api/logs/agents/stats-agent?lines=50`,
    );
    const body = JSON.parse(res);

    // Response must have correct structure regardless of whether agent ran
    expect(body).toHaveProperty("entries");
    expect(body).toHaveProperty("cursor");
    expect(body).toHaveProperty("hasMore");
    expect(Array.isArray(body.entries)).toBe(true);
    expect(typeof body.hasMore).toBe("boolean");
  });

  it("GET /api/logs/agents/:name with invalid name returns 400", async () => {
    // Agent names with special chars (spaces, slashes) are blocked by SAFE_AGENT_NAME
    // We use URL encoding so the request reaches the server
    const statusCode = await context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -s -o /dev/null -w '%{http_code}' -b ${COOKIE_JAR} "http://localhost:${GATEWAY_PORT}/api/logs/agents/invalid%20name"`,
    ]);
    expect(statusCode.trim()).toBe("400");
  });

  it("GET /api/logs/scheduler with invalid cursor returns 400", async () => {
    const statusCode = await context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -s -o /dev/null -w '%{http_code}' -b ${COOKIE_JAR} "http://localhost:${GATEWAY_PORT}/api/logs/scheduler?cursor=not-a-valid-cursor"`,
    ]);
    expect(statusCode.trim()).toBe("400");
  });
});
