/**
 * Browser smoke tests — verify the frontend can actually connect to the
 * backend API/SSE when served through the gateway.
 *
 * These exist because curl-based API tests pass even when the frontend
 * is broken (e.g. SSE endpoint unreachable from the SPA, routing issues,
 * static asset serving failures).
 *
 * Uses Playwright as a library inside vitest, running a real headless
 * browser on the host against the Docker container's exposed gateway port.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { E2ETestContext, type ContainerInfo } from "../harness.js";
import { createTestAgent, getSchedulerLogs } from "../containers/local.js";

const GATEWAY_PORT = 8080;
const API_KEY = "test-e2e-browser-key-12345";

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
    `cd /home/testuser/test-project && nohup al start --headless --web-ui --expose > /tmp/scheduler.log 2>&1 & echo $! > /tmp/scheduler.pid`,
  ]);

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const health = await context.executeInContainer(container, [
        "curl", "-sf", `http://localhost:${GATEWAY_PORT}/health`,
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
      "bash", "-c",
      "if [ -f /tmp/scheduler.pid ]; then kill $(cat /tmp/scheduler.pid) 2>/dev/null; rm -f /tmp/scheduler.pid; fi",
    ]);
  } catch {
    // already dead
  }
}

// ---------------------------------------------------------------------------

describe("Browser UI Smoke Tests", { timeout: 300000 }, () => {
  let context: E2ETestContext;
  let container: ContainerInfo;
  let browser: Browser;
  let baseURL: string;

  beforeAll(async () => {
    context = new E2ETestContext();
    await context.setup();

    // Create container with gateway port exposed to the host
    container = await context.createLocalActionLlamaContainer({
      exposePorts: [`${GATEWAY_PORT}/tcp`],
    });

    // Set up project structure
    await context.executeInContainer(container, [
      "mkdir", "-p", "/home/testuser/test-project",
    ]);
    await context.executeInContainer(container, [
      "bash", "-c", `cat > /home/testuser/test-project/config.toml << 'EOF'
[models.sonnet]
provider = "anthropic"
model = "claude-3-5-sonnet-20241022"
authType = "api_key"
EOF`,
    ]);
    await context.executeInContainer(container, [
      "bash", "-c",
      "mkdir -p ~/.action-llama/credentials/github_token/default && echo 'mock-token' > ~/.action-llama/credentials/github_token/default/token",
    ]);
    await context.executeInContainer(container, [
      "bash", "-c",
      "mkdir -p ~/.action-llama/credentials/anthropic_key/default && echo 'mock-key' > ~/.action-llama/credentials/anthropic_key/default/token",
    ]);

    await createTestAgent(context, container, "echo-agent", "# Echo Agent\n\nTest agent for browser smoke tests.");
    await startGateway(context, container);

    const hostPort = container.mappedPorts?.[`${GATEWAY_PORT}/tcp`];
    if (!hostPort) {
      throw new Error("Gateway port not mapped to host — cannot run browser tests");
    }
    baseURL = `http://127.0.0.1:${hostPort}`;

    browser = await chromium.launch({ headless: true });
  }, 300000);

  afterAll(async () => {
    if (browser) await browser.close();
    if (context && container) await stopGateway(context, container);
    if (context) await context.cleanup();
  });

  // -- Smoke: frontend serves and connects to backend ----------------------

  it("login page serves the SPA with the React root", async () => {
    const page = await browser.newPage();
    try {
      const response = await page.goto(`${baseURL}/login`);
      expect(response?.status()).toBe(200);

      // The SPA loaded — React root is present
      const root = await page.locator("#root").count();
      expect(root).toBe(1);

      // Login form rendered (not a blank page or error)
      await page.waitForSelector("input#key", { timeout: 10000 });
      await page.waitForSelector('button[type="submit"]', { timeout: 5000 });
    } finally {
      await page.close();
    }
  });

  it("login with valid key redirects to dashboard", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${baseURL}/login`);
      await page.waitForSelector("input#key", { timeout: 10000 });
      await page.fill("input#key", API_KEY);
      await page.click('button[type="submit"]');
      await page.waitForURL("**/dashboard", { timeout: 10000 });
      expect(page.url()).toContain("/dashboard");
    } finally {
      await page.close();
    }
  });

  it("dashboard SSE connects — 'Connected' indicator visible", async () => {
    const page = await browser.newPage();
    try {
      // Log in
      await page.goto(`${baseURL}/login`);
      await page.waitForSelector("input#key", { timeout: 10000 });
      await page.fill("input#key", API_KEY);
      await page.click('button[type="submit"]');
      await page.waitForURL("**/dashboard", { timeout: 10000 });

      // THIS is the critical smoke test: the SSE stream must connect.
      // If the frontend can't reach /dashboard/api/status-stream, this fails.
      // The connected indicator is now a <span class="bg-green-500"> (green circle) for connected.
      // "Disconnected" uses bg-red-500. Match on the green background class to verify connection.
      await page.waitForSelector("span.bg-green-500", { timeout: 15000 });
      // Verify the element has a title attribute indicating connection status
      const title = await page.locator("span.bg-green-500").first().getAttribute("title");
      expect(title).toBe("Connected");
    } finally {
      await page.close();
    }
  });

  it("dashboard populates agent list from SSE data", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${baseURL}/login`);
      await page.waitForSelector("input#key", { timeout: 10000 });
      await page.fill("input#key", API_KEY);
      await page.click('button[type="submit"]');
      await page.waitForURL("**/dashboard", { timeout: 10000 });

      // Agent data arrives via SSE — echo-agent should appear
      await page.waitForSelector("text=echo-agent", { timeout: 15000 });
      const agentVisible = await page.locator("text=echo-agent").first().isVisible();
      expect(agentVisible).toBe(true);

      // Agent state should show (idle, since nothing is running)
      await page.waitForSelector("text=idle", { timeout: 5000 });
    } finally {
      await page.close();
    }
  });

  it("agent detail page loads via client-side navigation", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${baseURL}/login`);
      await page.waitForSelector("input#key", { timeout: 10000 });
      await page.fill("input#key", API_KEY);
      await page.click('button[type="submit"]');
      await page.waitForURL("**/dashboard", { timeout: 10000 });

      // Wait for agent link to appear in the table, then click through
      const agentLink = page.locator('a[href="/dashboard/agents/echo-agent"]');
      await agentLink.first().waitFor({ state: "visible", timeout: 15000 });
      await agentLink.first().click();
      await page.waitForURL("**/dashboard/agents/echo-agent", { timeout: 10000 });

      // Wait for the agent detail page heading to update
      await page.waitForFunction(
        () => document.querySelector("h1")?.textContent?.includes("echo-agent"),
        { timeout: 10000 },
      );
    } finally {
      await page.close();
    }
  });

  it("agent detail page loads via direct URL (SPA history fallback)", async () => {
    const page = await browser.newPage();
    try {
      // Log in first
      await page.goto(`${baseURL}/login`);
      await page.waitForSelector("input#key", { timeout: 10000 });
      await page.fill("input#key", API_KEY);
      await page.click('button[type="submit"]');
      await page.waitForURL("**/dashboard", { timeout: 10000 });

      // Navigate directly to a deep SPA route — this tests that the
      // gateway correctly serves index.html for unknown paths (SPA fallback).
      // This is the exact scenario that caused the production 404 bug.
      await page.goto(`${baseURL}/dashboard/agents/echo-agent`);
      await page.waitForSelector("h1", { timeout: 10000 });

      const heading = await page.locator("h1").textContent();
      expect(heading).toContain("echo-agent");
    } finally {
      await page.close();
    }
  });
});
