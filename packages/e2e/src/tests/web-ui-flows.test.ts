import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { E2ETestContext, type ContainerInfo } from "../harness.js";
import { setupLocalActionLlama, createTestAgent, getSchedulerLogs } from "../containers/local.js";

const GATEWAY_PORT = 8080;
const API_KEY = "test-e2e-api-key-12345";
const COOKIE_JAR = "/tmp/cookies.txt";

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

  // Set the gateway port in config.toml
  await context.executeInContainer(container, [
    "bash",
    "-c",
    `cd /home/testuser/test-project && cat >> config.toml << 'EOF'

[gateway]
port = ${GATEWAY_PORT}
EOF`,
  ]);

  // Start the scheduler in headless mode (which starts the gateway)
  await context.executeInContainer(container, [
    "bash",
    "-c",
    `cd /home/testuser/test-project && nohup al start --headless > /tmp/scheduler.log 2>&1 & echo $! > /tmp/scheduler.pid`,
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

// ---------------------------------------------------------------------------

describe("Web UI Flows", { timeout: 300000 }, () => {
  // Manage our own context — one container for the entire describe block
  let context: E2ETestContext;
  let container: ContainerInfo;

  beforeAll(async () => {
    context = new E2ETestContext();
    await context.setup();

    container = await setupLocalActionLlama(context);

    // Create a test agent so the dashboard has something to show
    await createTestAgent(
      context,
      container,
      "echo-agent",
      "# Echo Agent\n\nA test agent for E2E web UI tests.",
    );

    await startGateway(context, container);
    await login(context, container);
  });

  afterAll(async () => {
    if (context && container) {
      await stopGateway(context, container);
    }
    if (context) {
      await context.cleanup();
    }
  });

  // -- Health & Auth --------------------------------------------------------

  it("health endpoint returns ok", async () => {
    const res = await curl(context, container, `http://localhost:${GATEWAY_PORT}/health`);
    expect(res).toContain("ok");
  });

  it("auth check succeeds with valid session", async () => {
    const res = await curl(context, container, `http://localhost:${GATEWAY_PORT}/api/auth/check`);
    const body = JSON.parse(res);
    expect(body.authenticated).toBe(true);
  });

  it("rejects unauthenticated requests to protected routes", async () => {
    // curl without the cookie jar → should get 401
    const result = await context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -s -o /dev/null -w '%{http_code}' http://localhost:${GATEWAY_PORT}/api/dashboard/status`,
    ]);
    expect(result.trim()).toBe("401");
  });

  // -- SSE Status Stream ----------------------------------------------------

  it("SSE status-stream connects and returns agent data", async () => {
    // Read a single SSE frame (timeout after 5s)
    const raw = await context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -sf -b ${COOKIE_JAR} -N --max-time 5 http://localhost:${GATEWAY_PORT}/dashboard/api/status-stream 2>/dev/null || true`,
    ]);

    // The first SSE message should contain agent data as JSON
    // SSE format: "data: {...}\n\n"
    const dataLine = raw
      .split("\n")
      .find((line) => line.startsWith("data:"));
    expect(dataLine).toBeDefined();

    const payload = JSON.parse(dataLine!.replace(/^data:\s*/, ""));
    expect(payload).toHaveProperty("agents");
    expect(payload).toHaveProperty("schedulerInfo");
    expect(payload).toHaveProperty("recentLogs");
    expect(payload).toHaveProperty("instances");
    expect(Array.isArray(payload.agents)).toBe(true);

    // Our test agent should be in the list
    const agentNames = payload.agents.map((a: { name: string }) => a.name);
    expect(agentNames).toContain("echo-agent");
  });

  it("SSE stream contains valid scheduler info", async () => {
    const raw = await context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -sf -b ${COOKIE_JAR} -N --max-time 5 http://localhost:${GATEWAY_PORT}/dashboard/api/status-stream 2>/dev/null || true`,
    ]);

    const dataLine = raw
      .split("\n")
      .find((line) => line.startsWith("data:"));
    const payload = JSON.parse(dataLine!.replace(/^data:\s*/, ""));

    const info = payload.schedulerInfo;
    expect(info).not.toBeNull();
    expect(info.gatewayPort).toBe(GATEWAY_PORT);
    expect(info.paused).toBe(false);
    expect(info.startedAt).toBeDefined();
  });

  // -- Dashboard JSON API ---------------------------------------------------

  it("GET /api/dashboard/status returns agents and scheduler info", async () => {
    const res = await curl(context, container, `http://localhost:${GATEWAY_PORT}/api/dashboard/status`);
    const body = JSON.parse(res);

    expect(body).toHaveProperty("agents");
    expect(body).toHaveProperty("schedulerInfo");
    expect(body).toHaveProperty("recentLogs");
    expect(Array.isArray(body.agents)).toBe(true);

    const agent = body.agents.find((a: { name: string }) => a.name === "echo-agent");
    expect(agent).toBeDefined();
    expect(agent.state).toBe("idle");
    expect(agent.enabled).toBe(true);
  });

  it("GET /api/dashboard/agents/:name returns agent detail", async () => {
    const res = await curl(
      context,
      container,
      `http://localhost:${GATEWAY_PORT}/api/dashboard/agents/echo-agent`,
    );
    const body = JSON.parse(res);

    expect(body).toHaveProperty("agent");
    expect(body).toHaveProperty("agentConfig");
    expect(body.agent.name).toBe("echo-agent");
    expect(body.agentConfig).toHaveProperty("credentials");
    expect(body.agentConfig).toHaveProperty("models");
  });

  it("GET /api/dashboard/agents/:name/skill returns SKILL.md", async () => {
    const res = await curl(
      context,
      container,
      `http://localhost:${GATEWAY_PORT}/api/dashboard/agents/echo-agent/skill`,
    );
    const body = JSON.parse(res);

    expect(body).toHaveProperty("body");
    expect(body.body).toContain("Echo Agent");
  });

  it("GET /api/dashboard/config returns project config", async () => {
    const res = await curl(
      context,
      container,
      `http://localhost:${GATEWAY_PORT}/api/dashboard/config`,
    );
    const body = JSON.parse(res);

    expect(body).toHaveProperty("gatewayPort");
    expect(body.gatewayPort).toBe(GATEWAY_PORT);
  });

  // -- Control Operations ---------------------------------------------------

  it("POST /control/pause pauses the scheduler", async () => {
    const res = await curl(
      context,
      container,
      `-X POST http://localhost:${GATEWAY_PORT}/control/pause`,
    );
    const body = JSON.parse(res);
    expect(body.success).toBe(true);

    // Verify paused state via status API
    const status = JSON.parse(
      await curl(context, container, `http://localhost:${GATEWAY_PORT}/api/dashboard/status`),
    );
    expect(status.schedulerInfo.paused).toBe(true);
  });

  it("POST /control/resume resumes the scheduler", async () => {
    const res = await curl(
      context,
      container,
      `-X POST http://localhost:${GATEWAY_PORT}/control/resume`,
    );
    const body = JSON.parse(res);
    expect(body.success).toBe(true);

    const status = JSON.parse(
      await curl(context, container, `http://localhost:${GATEWAY_PORT}/api/dashboard/status`),
    );
    expect(status.schedulerInfo.paused).toBe(false);
  });

  it("POST /control/agents/:name/disable disables an agent", async () => {
    const res = await curl(
      context,
      container,
      `-X POST http://localhost:${GATEWAY_PORT}/control/agents/echo-agent/disable`,
    );
    const body = JSON.parse(res);
    expect(body.success).toBe(true);

    const status = JSON.parse(
      await curl(context, container, `http://localhost:${GATEWAY_PORT}/api/dashboard/status`),
    );
    const agent = status.agents.find((a: { name: string }) => a.name === "echo-agent");
    expect(agent.enabled).toBe(false);
  });

  it("POST /control/agents/:name/enable re-enables an agent", async () => {
    const res = await curl(
      context,
      container,
      `-X POST http://localhost:${GATEWAY_PORT}/control/agents/echo-agent/enable`,
    );
    const body = JSON.parse(res);
    expect(body.success).toBe(true);

    const status = JSON.parse(
      await curl(context, container, `http://localhost:${GATEWAY_PORT}/api/dashboard/status`),
    );
    const agent = status.agents.find((a: { name: string }) => a.name === "echo-agent");
    expect(agent.enabled).toBe(true);
  });

  // -- Trigger History & Stats ----------------------------------------------

  it("GET /api/stats/triggers returns trigger history", async () => {
    const res = await curl(
      context,
      container,
      `http://localhost:${GATEWAY_PORT}/api/stats/triggers?limit=10\\&offset=0\\&all=0`,
    );
    const body = JSON.parse(res);

    expect(body).toHaveProperty("triggers");
    expect(body).toHaveProperty("total");
    expect(Array.isArray(body.triggers)).toBe(true);
  });

  // -- Frontend Serving -----------------------------------------------------

  it("GET /dashboard serves the SPA index.html", async () => {
    const res = await context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -sf -b ${COOKIE_JAR} http://localhost:${GATEWAY_PORT}/dashboard`,
    ]);

    // The SPA index.html should contain the React root mount point
    expect(res).toContain("<!DOCTYPE html");
    expect(res).toContain("id=\"root\"");
  });

  it("GET / redirects to /dashboard", async () => {
    const statusCode = await context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -s -o /dev/null -w '%{http_code}' -b ${COOKIE_JAR} http://localhost:${GATEWAY_PORT}/`,
    ]);
    // Hono redirect returns 302
    expect(["301", "302"]).toContain(statusCode.trim());
  });

  it("GET /login serves the SPA for the login page", async () => {
    // Login page should be accessible without auth
    const res = await context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -sf http://localhost:${GATEWAY_PORT}/login`,
    ]);

    expect(res).toContain("<!DOCTYPE html");
    expect(res).toContain("id=\"root\"");
  });
});
