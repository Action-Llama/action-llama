/**
 * E2E tests for credential rotation.
 *
 * These tests verify that:
 * - The gateway reads the API key from disk on every auth check (no caching)
 * - After rotating the gateway API key file, the old key is rejected
 * - After rotation, the new key is accepted immediately without restart
 *
 * The scheduler uses `loadGatewayApiKey` (a dynamic provider) as the `apiKey`
 * parameter to the gateway, so the key is re-read on every request.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { E2ETestContext, type ContainerInfo } from "../harness.js";
import { setupLocalActionLlama, createTestAgent, getSchedulerLogs } from "../containers/local.js";

const GATEWAY_PORT = 8383;
const INITIAL_API_KEY = "cred-rotation-e2e-initial-key-abc";
const ROTATED_API_KEY = "cred-rotation-e2e-rotated-key-xyz";

/** Write the gateway API key credential to the container's credential store. */
async function writeApiKey(
  context: E2ETestContext,
  container: ContainerInfo,
  key: string,
): Promise<void> {
  await context.executeInContainer(container, [
    "bash",
    "-c",
    `mkdir -p ~/.action-llama/credentials/gateway_api_key/default && printf '%s' '${key}' > ~/.action-llama/credentials/gateway_api_key/default/key`,
  ]);
}

/**
 * Start the scheduler with gateway enabled and wait until the health
 * endpoint responds. Returns when the gateway is ready.
 */
async function startGateway(
  context: E2ETestContext,
  container: ContainerInfo,
): Promise<void> {
  // Set the gateway port in config.toml
  await context.executeInContainer(container, [
    "bash",
    "-c",
    `cd /home/testuser/test-project && cat >> config.toml << 'EOF'

[gateway]
port = ${GATEWAY_PORT}
EOF`,
  ]);

  // Start the scheduler in headless mode
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

/**
 * Make a Bearer-authenticated request to a protected API endpoint.
 * Returns the HTTP status code as a string.
 */
async function authRequest(
  context: E2ETestContext,
  container: ContainerInfo,
  key: string,
): Promise<string> {
  return context.executeInContainer(container, [
    "bash",
    "-c",
    `curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer ${key}' http://localhost:${GATEWAY_PORT}/api/dashboard/status`,
  ]);
}

// ---------------------------------------------------------------------------

describe("Credential Rotation Flows", { timeout: 300000 }, () => {
  let context: E2ETestContext;
  let container: ContainerInfo;

  beforeAll(async () => {
    context = new E2ETestContext();
    await context.setup();

    container = await setupLocalActionLlama(context);

    // Create a minimal agent so the dashboard has content
    await createTestAgent(
      context,
      container,
      "rotation-test-agent",
      "# Rotation Test Agent\n\nAgent used in credential rotation e2e tests.",
    );

    // Write the initial API key before starting the scheduler
    await writeApiKey(context, container, INITIAL_API_KEY);

    await startGateway(context, container);
  }, 300000);

  afterAll(async () => {
    if (context && container) {
      await stopGateway(context, container);
    }
    if (context) {
      await context.cleanup();
    }
  });

  it("authenticates with the initial API key", async () => {
    const status = await authRequest(context, container, INITIAL_API_KEY);
    expect(status.trim()).toBe("200");
  });

  it("rejects an incorrect API key before rotation", async () => {
    const status = await authRequest(context, container, "wrong-key-before-rotation");
    expect(status.trim()).toBe("401");
  });

  it("rejects old key after credential rotation (no restart)", async () => {
    // Rotate: overwrite the key file with a new value
    await writeApiKey(context, container, ROTATED_API_KEY);

    // Old key should now be rejected — the gateway reads the file on each request
    const status = await authRequest(context, container, INITIAL_API_KEY);
    expect(status.trim()).toBe("401");
  });

  it("accepts new key immediately after rotation (no restart)", async () => {
    // New key should be accepted without restarting the scheduler
    const status = await authRequest(context, container, ROTATED_API_KEY);
    expect(status.trim()).toBe("200");
  });

  it("dashboard status is accessible with rotated key", async () => {
    const res = await context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -sf -H 'Authorization: Bearer ${ROTATED_API_KEY}' http://localhost:${GATEWAY_PORT}/api/dashboard/status`,
    ]);
    const body = JSON.parse(res);
    expect(body).toHaveProperty("agents");
    expect(Array.isArray(body.agents)).toBe(true);

    const agent = body.agents.find((a: { name: string }) => a.name === "rotation-test-agent");
    expect(agent).toBeDefined();
  });
});
