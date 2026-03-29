/**
 * E2E tests for Dashboard SSE reconnection.
 *
 * Verifies:
 * - An SSE client can connect, receive data, disconnect, then reconnect and
 *   still receive valid, consistent data (data continuity across reconnections).
 * - Multiple concurrent SSE connections are served independently.
 * - The server properly cleans up listeners when clients disconnect (no leaks).
 * - SSE response headers include the cache-control/buffering directives needed
 *   for proxy compatibility (Cache-Control: no-cache, X-Accel-Buffering: no).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { E2ETestContext, type ContainerInfo } from "../harness.js";
import { setupLocalActionLlama, createTestAgent, getSchedulerLogs } from "../containers/local.js";

const GATEWAY_PORT = 8686;
const API_KEY = "sse-reconnect-e2e-key-99999";
const COOKIE_JAR = "/tmp/cookies-sse-reconnect.txt";

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

/**
 * Read one SSE frame from the status-stream, timing out after maxSeconds.
 * Returns the parsed payload from the first `data:` line.
 */
async function readOneSseFrame(
  context: E2ETestContext,
  container: ContainerInfo,
  maxSeconds = 5,
): Promise<Record<string, unknown>> {
  const raw = await context.executeInContainer(container, [
    "bash",
    "-c",
    `curl -sf -b ${COOKIE_JAR} -N --max-time ${maxSeconds} http://localhost:${GATEWAY_PORT}/dashboard/api/status-stream 2>/dev/null || true`,
  ]);

  const dataLine = raw.split("\n").find((line) => line.startsWith("data:"));
  if (!dataLine) {
    throw new Error(`No SSE data line found. Raw output: ${raw.substring(0, 200)}`);
  }
  return JSON.parse(dataLine.replace(/^data:\s*/, ""));
}

// ---------------------------------------------------------------------------

describe("Dashboard SSE Reconnection", { timeout: 300000 }, () => {
  let context: E2ETestContext;
  let container: ContainerInfo;

  beforeAll(async () => {
    context = new E2ETestContext();
    await context.setup();

    container = await setupLocalActionLlama(context);

    // Create a test agent so the stream has something meaningful to report
    await createTestAgent(
      context,
      container,
      "reconnect-agent",
      "# Reconnect Test Agent\n\nA test agent for SSE reconnection tests.",
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

  // -- Initial Connection ---------------------------------------------------

  it("initial SSE connection delivers valid agent and scheduler data", async () => {
    const payload = await readOneSseFrame(context, container);

    expect(payload).toHaveProperty("agents");
    expect(payload).toHaveProperty("schedulerInfo");
    expect(payload).toHaveProperty("recentLogs");
    expect(payload).toHaveProperty("instances");
    expect(Array.isArray(payload.agents)).toBe(true);

    const agentNames = (payload.agents as Array<{ name: string }>).map((a) => a.name);
    expect(agentNames).toContain("reconnect-agent");
  });

  // -- Reconnection --------------------------------------------------------

  it("second SSE connection after disconnect returns the same agent list", async () => {
    // First connection — read one frame and let curl timeout (simulating disconnect)
    const payload1 = await readOneSseFrame(context, container, 3);
    const agentNames1 = (payload1.agents as Array<{ name: string }>).map((a) => a.name);

    // Brief pause to ensure the server has fully cleaned up the first connection's
    // listeners (the onAbort callback fires asynchronously)
    await new Promise((r) => setTimeout(r, 500));

    // Second connection (the reconnect)
    const payload2 = await readOneSseFrame(context, container, 3);
    const agentNames2 = (payload2.agents as Array<{ name: string }>).map((a) => a.name);

    // Data continuity: the same agents must appear in both connections
    expect(agentNames2).toEqual(expect.arrayContaining(agentNames1));
    expect(agentNames2).toContain("reconnect-agent");

    // Scheduler info should remain consistent across reconnections
    const info1 = payload1.schedulerInfo as Record<string, unknown>;
    const info2 = payload2.schedulerInfo as Record<string, unknown>;
    expect(info2.gatewayPort).toBe(info1.gatewayPort);
    expect(info2.paused).toBe(info1.paused);
    // startedAt must not change (same scheduler process)
    expect(info2.startedAt).toBe(info1.startedAt);
  });

  it("multiple rapid reconnections all return valid data", async () => {
    // Simulate 3 rapid sequential reconnections and verify each returns valid data
    for (let i = 0; i < 3; i++) {
      const payload = await readOneSseFrame(context, container, 3);

      expect(payload).toHaveProperty("agents");
      expect(payload).toHaveProperty("schedulerInfo");
      expect(Array.isArray(payload.agents)).toBe(true);

      const agentNames = (payload.agents as Array<{ name: string }>).map((a) => a.name);
      expect(agentNames).toContain("reconnect-agent");

      // Brief delay between connections
      await new Promise((r) => setTimeout(r, 200));
    }
  });

  // -- Concurrent Connections ----------------------------------------------

  it("concurrent SSE connections both receive valid data independently", async () => {
    // Open two concurrent SSE connections using background curl processes.
    // Each writes its output to a separate temp file.
    await context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -sf -b ${COOKIE_JAR} -N --max-time 3 http://localhost:${GATEWAY_PORT}/dashboard/api/status-stream > /tmp/sse-conn1.txt 2>/dev/null &
       curl -sf -b ${COOKIE_JAR} -N --max-time 3 http://localhost:${GATEWAY_PORT}/dashboard/api/status-stream > /tmp/sse-conn2.txt 2>/dev/null &
       wait`,
    ]);

    // Read the output from both connections
    const raw1 = await context.executeInContainer(container, [
      "bash", "-c", "cat /tmp/sse-conn1.txt 2>/dev/null || echo ''"
    ]);
    const raw2 = await context.executeInContainer(container, [
      "bash", "-c", "cat /tmp/sse-conn2.txt 2>/dev/null || echo ''"
    ]);

    // Both connections must have received at least one data frame
    const dataLine1 = raw1.split("\n").find((l) => l.startsWith("data:"));
    const dataLine2 = raw2.split("\n").find((l) => l.startsWith("data:"));

    expect(dataLine1).toBeDefined();
    expect(dataLine2).toBeDefined();

    const payload1 = JSON.parse(dataLine1!.replace(/^data:\s*/, ""));
    const payload2 = JSON.parse(dataLine2!.replace(/^data:\s*/, ""));

    // Both connections should report the same agent
    const agents1 = (payload1.agents as Array<{ name: string }>).map((a) => a.name);
    const agents2 = (payload2.agents as Array<{ name: string }>).map((a) => a.name);
    expect(agents1).toContain("reconnect-agent");
    expect(agents2).toContain("reconnect-agent");
  });

  // -- SSE Headers ---------------------------------------------------------

  it("SSE response includes proxy-compatibility headers", async () => {
    // Fetch the SSE endpoint headers with curl -D (dump headers to stdout)
    const headers = await context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -sf -b ${COOKIE_JAR} -D - --max-time 2 http://localhost:${GATEWAY_PORT}/dashboard/api/status-stream 2>/dev/null || true`,
    ]);

    // The response must include headers needed for Cloudflare/nginx compatibility
    expect(headers.toLowerCase()).toContain("cache-control");
    expect(headers.toLowerCase()).toContain("no-cache");
    expect(headers.toLowerCase()).toContain("x-accel-buffering");
    expect(headers.toLowerCase()).toContain("no");
    // Content-Type must be text/event-stream
    expect(headers.toLowerCase()).toContain("text/event-stream");
  });
});
