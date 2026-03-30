/**
 * E2E tests for webhook trigger handling.
 *
 * These tests verify that:
 * - POST /webhooks/:source dispatches to matched agents
 * - Duplicate webhook delivery IDs (x-github-delivery) are deduplicated
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

// ---------------------------------------------------------------------------
// Webhook Event Filtering: event-type and repo-based filter tests
// ---------------------------------------------------------------------------

const FILTER_PORT = 8183;
const FILTER_API_KEY = "webhook-filter-e2e-key-33333";
const FILTER_COOKIE = "/tmp/cookies-webhook-filter.txt";

describe("Webhook Event Filtering", { timeout: 300000 }, () => {
  let filterCtx: E2ETestContext;
  let filterContainer: ContainerInfo;

  beforeAll(async () => {
    filterCtx = new E2ETestContext();
    await filterCtx.setup();

    filterContainer = await setupLocalActionLlama(filterCtx);

    // Set API key and gateway config
    await filterCtx.executeInContainer(filterContainer, [
      "bash",
      "-c",
      `mkdir -p ~/.action-llama/credentials/gateway_api_key/default && echo -n '${FILTER_API_KEY}' > ~/.action-llama/credentials/gateway_api_key/default/key`,
    ]);

    await filterCtx.executeInContainer(filterContainer, [
      "bash",
      "-c",
      `cd /home/testuser/test-project && cat >> config.toml << 'EOF'

[gateway]
port = ${FILTER_PORT}

[webhooks.filtertest]
type = "test"
EOF`,
    ]);

    // Agent: listens for "issues" events from a specific repo only.
    // This lets us test that:
    //   - wrong event type ("push") does NOT match
    //   - correct event from the wrong repo does NOT match
    //   - correct event from the allowed repo DOES match
    const agentDir = "/home/testuser/test-project/agents/repo-filter-agent";
    await filterCtx.executeInContainer(filterContainer, [
      "bash",
      "-c",
      `mkdir -p ${agentDir}`,
    ]);

    await filterCtx.executeInContainer(filterContainer, [
      "bash",
      "-c",
      `cat > ${agentDir}/SKILL.md << 'EOF'
---
description: "Repo-filtered webhook test agent"
---

# Repo Filter Agent

Fires only for issues events from the allowed repo.
EOF`,
    ]);

    await filterCtx.executeInContainer(filterContainer, [
      "bash",
      "-c",
      `cat > ${agentDir}/config.toml << 'EOF'
models = ["sonnet"]
credentials = ["github_token", "anthropic_key"]

[[webhooks]]
source = "filtertest"
events = ["issues"]
repos = ["test-org/allowed-repo"]
EOF`,
    ]);

    await filterCtx.executeInContainer(filterContainer, [
      "bash",
      "-c",
      `chown -R testuser:testuser ${agentDir}`,
    ]);

    // Start gateway
    await filterCtx.executeInContainer(filterContainer, [
      "bash",
      "-c",
      `cd /home/testuser/test-project && nohup al start --headless --web-ui > /tmp/filter-scheduler.log 2>&1 & echo $! > /tmp/filter-scheduler.pid`,
    ]);

    // Poll until healthy
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const health = await filterCtx.executeInContainer(filterContainer, [
          "curl",
          "-sf",
          `http://localhost:${FILTER_PORT}/health`,
        ]);
        if (health.includes("ok")) break;
      } catch {
        // not ready yet
      }
      if (i === 29) {
        const logs = await getSchedulerLogs(filterCtx, filterContainer);
        throw new Error(`Filter gateway did not become healthy within 30s.\nLogs: ${logs}`);
      }
    }

    // Login
    await filterCtx.executeInContainer(filterContainer, [
      "bash",
      "-c",
      `curl -sf -c ${FILTER_COOKIE} -X POST -H 'Content-Type: application/json' -d '{"key":"${FILTER_API_KEY}"}' http://localhost:${FILTER_PORT}/api/auth/login`,
    ]);
  }, 300000);

  afterAll(async () => {
    if (filterCtx && filterContainer) {
      try {
        await filterCtx.executeInContainer(filterContainer, [
          "bash",
          "-c",
          "if [ -f /tmp/filter-scheduler.pid ]; then kill $(cat /tmp/filter-scheduler.pid) 2>/dev/null; rm -f /tmp/filter-scheduler.pid; fi",
        ]);
      } catch {
        // process might already be dead
      }
    }
    if (filterCtx) await filterCtx.cleanup();
  });

  function filterCurl(args: string): Promise<string> {
    return filterCtx.executeInContainer(filterContainer, [
      "bash",
      "-c",
      `curl -sf -b ${FILTER_COOKIE} -c ${FILTER_COOKIE} ${args}`,
    ]);
  }

  it("matches agent when event type and repo both satisfy filters", async () => {
    const payload = JSON.stringify({
      event: "issues",
      action: "opened",
      repo: "test-org/allowed-repo",
      number: 1,
      title: "Allowed repo issue",
      sender: "user-a",
    });

    const response = await filterCtx.executeInContainer(filterContainer, [
      "bash",
      "-c",
      `curl -s -X POST -H 'Content-Type: application/json' -d '${payload.replace(/'/g, "'\\''")}' http://localhost:${FILTER_PORT}/webhooks/test 2>/dev/null`,
    ]);

    const body = JSON.parse(response);
    expect(body.ok).toBe(true);
    // repo-filter-agent should match: correct event type + correct repo
    expect(body.matched).toBeGreaterThanOrEqual(1);
  });

  it("returns matched=0 when event type does not satisfy the filter", async () => {
    // "push" is not in the agent's events=["issues"] filter
    const payload = JSON.stringify({
      event: "push",
      repo: "test-org/allowed-repo",
      sender: "user-b",
    });

    const response = await filterCtx.executeInContainer(filterContainer, [
      "bash",
      "-c",
      `curl -s -X POST -H 'Content-Type: application/json' -d '${payload.replace(/'/g, "'\\''")}' http://localhost:${FILTER_PORT}/webhooks/test 2>/dev/null`,
    ]);

    const body = JSON.parse(response);
    expect(body.ok).toBe(true);
    // Event type "push" does not match the "issues" filter → no agent matched
    expect(body.matched).toBe(0);
  });

  it("returns matched=0 when repo does not satisfy the repos filter", async () => {
    // event type matches ("issues") but repo does not match allowed-repo
    const payload = JSON.stringify({
      event: "issues",
      action: "opened",
      repo: "other-org/different-repo",
      number: 2,
      title: "Issue from the wrong repo",
      sender: "user-c",
    });

    const response = await filterCtx.executeInContainer(filterContainer, [
      "bash",
      "-c",
      `curl -s -X POST -H 'Content-Type: application/json' -d '${payload.replace(/'/g, "'\\''")}' http://localhost:${FILTER_PORT}/webhooks/test 2>/dev/null`,
    ]);

    const body = JSON.parse(response);
    expect(body.ok).toBe(true);
    // Repo "other-org/different-repo" is not in repos=["test-org/allowed-repo"] → no match
    expect(body.matched).toBe(0);
  });

  it("unmatched event-type webhook is stored as dead-letter receipt", async () => {
    // Send a non-matching event type ("pull_request")
    const payload = JSON.stringify({
      event: "pull_request",
      action: "opened",
      repo: "test-org/allowed-repo",
      number: 10,
      sender: "user-d",
    });

    await filterCtx.executeInContainer(filterContainer, [
      "bash",
      "-c",
      `curl -s -X POST -H 'Content-Type: application/json' -d '${payload.replace(/'/g, "'\\''")}' http://localhost:${FILTER_PORT}/webhooks/test 2>/dev/null`,
    ]);

    // Brief pause for stats store commit
    await new Promise((r) => setTimeout(r, 500));

    // Verify it appears in trigger history as a dead-letter
    const statsRes = await filterCurl(
      `'http://localhost:${FILTER_PORT}/api/stats/triggers?limit=50&offset=0&all=1'`,
    );
    const stats = JSON.parse(statsRes);

    expect(Array.isArray(stats.triggers)).toBe(true);
    expect(stats.total).toBeGreaterThan(0);
    const deadLetters = stats.triggers.filter((t: any) => t.result === "dead-letter");
    expect(deadLetters.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Webhook retry/deduplication: duplicate delivery IDs are rejected
// ---------------------------------------------------------------------------

const DEDUP_PORT = 8285;
const DEDUP_API_KEY = "webhook-dedup-e2e-key-55555";
const DEDUP_COOKIE = "/tmp/cookies-webhook-dedup.txt";

describe("Webhook Retry/Deduplication", { timeout: 300000 }, () => {
  let dedupCtx: E2ETestContext;
  let dedupContainer: ContainerInfo;

  beforeAll(async () => {
    dedupCtx = new E2ETestContext();
    await dedupCtx.setup();

    dedupContainer = await setupLocalActionLlama(dedupCtx);

    // Configure gateway API key
    await dedupCtx.executeInContainer(dedupContainer, [
      "bash",
      "-c",
      `mkdir -p ~/.action-llama/credentials/gateway_api_key/default && echo -n '${DEDUP_API_KEY}' > ~/.action-llama/credentials/gateway_api_key/default/key`,
    ]);

    // Register a GitHub webhook source named "github" (source name must match the
    // provider type so that webhookConfigs["github"] resolves allowUnsigned=true at
    // dispatch time). The GitHub provider implements getDeliveryId() which reads the
    // x-github-delivery header — enabling dedup checks in the route handler.
    await dedupCtx.executeInContainer(dedupContainer, [
      "bash",
      "-c",
      `cd /home/testuser/test-project && cat >> config.toml << 'EOF'

[gateway]
port = ${DEDUP_PORT}

[webhooks.github]
type = "github"
allowUnsigned = true
EOF`,
    ]);

    // Create a minimal agent that subscribes to "issues" events from the github source.
    // We need at least one bound agent so the gateway has something to dispatch to.
    const agentDir = "/home/testuser/test-project/agents/dedup-test-agent";
    await dedupCtx.executeInContainer(dedupContainer, [
      "bash",
      "-c",
      `mkdir -p ${agentDir}`,
    ]);

    await dedupCtx.executeInContainer(dedupContainer, [
      "bash",
      "-c",
      `cat > ${agentDir}/SKILL.md << 'EOF'
---
description: "Deduplication test agent"
---

# Dedup Test Agent

You are a test agent used to verify webhook deduplication.
EOF`,
    ]);

    await dedupCtx.executeInContainer(dedupContainer, [
      "bash",
      "-c",
      `cat > ${agentDir}/config.toml << 'EOF'
models = ["sonnet"]
credentials = ["github_token", "anthropic_key"]

[[webhooks]]
source = "github"
events = ["issues"]
actions = ["opened"]
EOF`,
    ]);

    await dedupCtx.executeInContainer(dedupContainer, [
      "bash",
      "-c",
      `chown -R testuser:testuser ${agentDir}`,
    ]);

    // Start the scheduler/gateway
    await dedupCtx.executeInContainer(dedupContainer, [
      "bash",
      "-c",
      `cd /home/testuser/test-project && nohup al start --headless --web-ui > /tmp/dedup-scheduler.log 2>&1 & echo $! > /tmp/dedup-scheduler.pid`,
    ]);

    // Poll until the health endpoint responds
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const health = await dedupCtx.executeInContainer(dedupContainer, [
          "curl",
          "-sf",
          `http://localhost:${DEDUP_PORT}/health`,
        ]);
        if (health.includes("ok")) break;
      } catch {
        // not ready yet
      }
      if (i === 29) {
        const logs = await dedupCtx.executeInContainer(dedupContainer, [
          "cat",
          "/tmp/dedup-scheduler.log",
        ]).catch(() => "no logs");
        throw new Error(`Dedup gateway did not become healthy within 30s.\nLogs: ${logs}`);
      }
    }

    // Login for authenticated API calls
    await dedupCtx.executeInContainer(dedupContainer, [
      "bash",
      "-c",
      `curl -sf -c ${DEDUP_COOKIE} -X POST -H 'Content-Type: application/json' -d '{"key":"${DEDUP_API_KEY}"}' http://localhost:${DEDUP_PORT}/api/auth/login`,
    ]);
  }, 300000);

  afterAll(async () => {
    if (dedupCtx && dedupContainer) {
      try {
        await dedupCtx.executeInContainer(dedupContainer, [
          "bash",
          "-c",
          "if [ -f /tmp/dedup-scheduler.pid ]; then kill $(cat /tmp/dedup-scheduler.pid) 2>/dev/null; rm -f /tmp/dedup-scheduler.pid; fi",
        ]);
      } catch {
        // process might already be dead
      }
    }
    if (dedupCtx) await dedupCtx.cleanup();
  }, 120000);

  it("first delivery with a unique x-github-delivery ID is accepted", async () => {
    // Build a valid GitHub issues.opened payload
    const deliveryId = `dedup-e2e-first-${Date.now()}`;
    const payload = JSON.stringify({
      action: "opened",
      issue: {
        number: 1,
        title: "First delivery",
        body: "First issue body",
        user: { login: "user-a" },
        html_url: "https://github.com/test-org/test-repo/issues/1",
      },
      repository: { full_name: "test-org/test-repo" },
      sender: { login: "user-a" },
    });

    const response = await dedupCtx.executeInContainer(dedupContainer, [
      "bash",
      "-c",
      `curl -s -X POST \
        -H 'Content-Type: application/json' \
        -H 'X-GitHub-Event: issues' \
        -H 'X-GitHub-Delivery: ${deliveryId}' \
        -d '${payload.replace(/'/g, "'\\''")}' \
        http://localhost:${DEDUP_PORT}/webhooks/github 2>/dev/null`,
    ]);

    const body = JSON.parse(response);
    // First delivery must succeed — ok=true and duplicate flag must not be set.
    // matched may be 0 if the agent is not yet running (the agent waits for its next
    // cron trigger), but the receipt must be stored so a subsequent replay is deduplicated.
    expect(body.ok).toBe(true);
    expect(body.duplicate).not.toBe(true);
    expect(typeof body.matched).toBe("number");
  });

  it("second delivery with the same x-github-delivery ID is rejected as duplicate", async () => {
    // Use a fixed delivery ID so we can guarantee reuse across two requests.
    const deliveryId = `dedup-e2e-dup-${Date.now()}`;
    const payload = JSON.stringify({
      action: "opened",
      issue: {
        number: 2,
        title: "Duplicate delivery test",
        body: "Duplicate body",
        user: { login: "user-b" },
        html_url: "https://github.com/test-org/test-repo/issues/2",
      },
      repository: { full_name: "test-org/test-repo" },
      sender: { login: "user-b" },
    });

    const curlCmd = `curl -s -X POST \
      -H 'Content-Type: application/json' \
      -H 'X-GitHub-Event: issues' \
      -H 'X-GitHub-Delivery: ${deliveryId}' \
      -d '${payload.replace(/'/g, "'\\''")}' \
      http://localhost:${DEDUP_PORT}/webhooks/github 2>/dev/null`;

    // First delivery — must succeed
    const firstRaw = await dedupCtx.executeInContainer(dedupContainer, [
      "bash",
      "-c",
      curlCmd,
    ]);
    const first = JSON.parse(firstRaw);
    expect(first.ok).toBe(true);
    expect(first.duplicate).not.toBe(true);

    // Second delivery with identical x-github-delivery ID — must be deduplicated
    const secondRaw = await dedupCtx.executeInContainer(dedupContainer, [
      "bash",
      "-c",
      curlCmd,
    ]);
    const second = JSON.parse(secondRaw);

    // The scheduler should detect the duplicate receipt and skip dispatch
    expect(second.ok).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(second.matched).toBe(0);
    expect(second.skipped).toBe(0);
  });

  it("two different delivery IDs are both accepted independently", async () => {
    const ts = Date.now();
    const payload = JSON.stringify({
      action: "opened",
      issue: {
        number: 3,
        title: "Unique delivery",
        body: "body",
        user: { login: "user-c" },
        html_url: "https://github.com/test-org/test-repo/issues/3",
      },
      repository: { full_name: "test-org/test-repo" },
      sender: { login: "user-c" },
    });

    const sendWithId = async (id: string) =>
      dedupCtx.executeInContainer(dedupContainer, [
        "bash",
        "-c",
        `curl -s -X POST \
          -H 'Content-Type: application/json' \
          -H 'X-GitHub-Event: issues' \
          -H 'X-GitHub-Delivery: ${id}' \
          -d '${payload.replace(/'/g, "'\\''")}' \
          http://localhost:${DEDUP_PORT}/webhooks/github 2>/dev/null`,
      ]);

    const [rawA, rawB] = await Promise.all([
      sendWithId(`dedup-e2e-unique-a-${ts}`),
      sendWithId(`dedup-e2e-unique-b-${ts}`),
    ]);

    const a = JSON.parse(rawA);
    const b = JSON.parse(rawB);

    // Both unique delivery IDs should be accepted
    expect(a.ok).toBe(true);
    expect(a.duplicate).not.toBe(true);

    expect(b.ok).toBe(true);
    expect(b.duplicate).not.toBe(true);
  });
});
