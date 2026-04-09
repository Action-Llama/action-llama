/**
 * Group 3 — Web UI / gateway dashboard e2e tests.
 *
 * Tests authentication flows (login, logout, session cookies),
 * control API operations, and dashboard/log endpoints.
 *
 * Uses a single scheduler instance across all tests to minimize setup/teardown.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MockLLMServer } from "../helpers/mock-llm-server.js";
import { createTestProject, type TestProject } from "../helpers/project-factory.js";
import { alSpawn, waitForHealthy, controlRequest, type AlProcess } from "../helpers/process.js";

const SCHEDULER_PORT = 18_202;
const API_KEY = "test-web-ui-api-key";

const BASE = `http://127.0.0.1:${SCHEDULER_PORT}`;

describe("web-ui", { timeout: 300_000 }, () => {
  let mockServer: MockLLMServer;
  let project: TestProject;
  let scheduler: AlProcess;

  beforeAll(async () => {
    mockServer = new MockLLMServer();
    await mockServer.start();

    project = createTestProject("web-ui", mockServer);
    project.addAgent("echo-agent", {
      skill: "You are a test agent. When asked to do something, use the bash tool to echo the result.",
      models: ["mock"],
      schedule: "0 0 1 1 *", // Effectively never — manual trigger only
      runtime: { type: "host-user", run_as: process.env.USER ?? "nobody" },
      timeout: 60,
    });

    project.writeCredential("gateway_api_key", "default", "key", API_KEY);

    scheduler = alSpawn(
      ["start", "--headless", "--web-ui", "--port", String(SCHEDULER_PORT)],
      project,
    );

    await waitForHealthy(SCHEDULER_PORT, 60_000);
  }, 120_000);

  afterAll(async () => {
    if (scheduler?.exitCode === null) {
      scheduler.kill("SIGTERM");
      await scheduler.waitForExit(15_000).catch(() => {
        scheduler.kill("SIGKILL");
      });
    }
    project?.cleanup();
    await mockServer?.stop();
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------------

  describe("authentication", () => {
    it("unauthenticated GET /api/auth/check returns 401", async () => {
      const res = await fetch(`${BASE}/api/auth/check`);
      expect(res.status).toBe(401);
    });

    it("unauthenticated GET /control/status returns 401", async () => {
      const res = await fetch(`${BASE}/control/status`);
      expect(res.status).toBe(401);
    });

    it("POST /api/auth/login with valid key returns 200 + set-cookie", async () => {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: API_KEY }),
      });

      expect(res.status).toBe(200);

      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain("al_session");
    });

    it("GET /api/auth/check with session cookie returns 200", async () => {
      // Login to get cookie
      const loginRes = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: API_KEY }),
      });
      const setCookie = loginRes.headers.get("set-cookie") ?? "";
      const cookie = setCookie.split(";")[0]; // Extract "al_session=<value>"

      // Use cookie for auth check
      const checkRes = await fetch(`${BASE}/api/auth/check`, {
        headers: { Cookie: cookie },
      });
      expect(checkRes.status).toBe(200);
    });

    it("POST /api/auth/logout clears session", async () => {
      // Login first
      const loginRes = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: API_KEY }),
      });
      const setCookie = loginRes.headers.get("set-cookie") ?? "";
      const cookie = setCookie.split(";")[0];

      // Logout
      const logoutRes = await fetch(`${BASE}/api/auth/logout`, {
        method: "POST",
        headers: { Cookie: cookie },
      });
      expect(logoutRes.status).toBe(200);

      // Session cookie should be cleared — extract new set-cookie
      const logoutSetCookie = logoutRes.headers.get("set-cookie") ?? "";
      // Typically the server clears by setting max-age=0 or expires in the past
      expect(logoutSetCookie).toContain("al_session");

      // Verify the old cookie no longer works
      const checkRes = await fetch(`${BASE}/api/auth/check`, {
        headers: { Cookie: cookie },
      });
      expect(checkRes.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  // Control operations (Authorization header)
  // ---------------------------------------------------------------------------

  describe("control operations", () => {
    it("GET /control/status returns agent info", async () => {
      const result = await controlRequest("GET", "/control/status", SCHEDULER_PORT, API_KEY);
      expect(result.status).toBe(200);
      expect(result.data).toBeDefined();
      // Should include agents array or object with echo-agent
      const agents = result.data.agents ?? [];
      const agentNames = agents.map((a: any) => a.name ?? a.agentName);
      expect(agentNames).toContain("echo-agent");
    });

    it("POST /control/trigger/:name runs agent", async () => {
      mockServer.enqueueToolCall("bash", { command: "echo 'web-ui test'" });
      mockServer.enqueueTextResponse("Done! Web UI trigger test complete.");

      const triggerResult = await controlRequest(
        "POST",
        "/control/trigger/echo-agent",
        SCHEDULER_PORT,
        API_KEY,
      );
      expect(triggerResult.status).toBe(200);

      // Wait for the run to complete
      const deadline = Date.now() + 60_000;
      let runCompleted = false;
      while (Date.now() < deadline) {
        const status = await controlRequest("GET", "/control/status", SCHEDULER_PORT, API_KEY);
        const instances = status.data?.instances ?? [];
        if (mockServer.getRequests().length >= 2 && instances.length === 0) {
          runCompleted = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }

      expect(runCompleted).toBe(true);
      mockServer.assertDrained();
      mockServer.reset();
    });

    it("POST /control/pause returns 200 and scheduler is paused", async () => {
      const result = await controlRequest("POST", "/control/pause", SCHEDULER_PORT, API_KEY);
      expect(result.status).toBe(200);

      const status = await controlRequest("GET", "/control/status", SCHEDULER_PORT, API_KEY);
      expect(status.data.paused).toBe(true);
    });

    it("POST /control/resume returns 200 and scheduler is unpaused", async () => {
      const result = await controlRequest("POST", "/control/resume", SCHEDULER_PORT, API_KEY);
      expect(result.status).toBe(200);

      const status = await controlRequest("GET", "/control/status", SCHEDULER_PORT, API_KEY);
      expect(status.data.paused).toBe(false);
    });

    it("POST /control/agents/:name/disable returns 200", async () => {
      const result = await controlRequest(
        "POST",
        "/control/agents/echo-agent/disable",
        SCHEDULER_PORT,
        API_KEY,
      );
      expect(result.status).toBe(200);
    });

    it("POST /control/agents/:name/enable returns 200", async () => {
      const result = await controlRequest(
        "POST",
        "/control/agents/echo-agent/enable",
        SCHEDULER_PORT,
        API_KEY,
      );
      expect(result.status).toBe(200);
    });

    it("GET /control/instances lists running instances", async () => {
      // Enqueue a slow response to keep the agent busy
      mockServer.enqueueToolCall("bash", { command: "sleep 30" });

      // Trigger agent
      await controlRequest("POST", "/control/trigger/echo-agent", SCHEDULER_PORT, API_KEY);

      // Wait for the agent instance to appear
      const deadline = Date.now() + 15_000;
      let instances: any[] = [];
      while (Date.now() < deadline) {
        const status = await controlRequest("GET", "/control/status", SCHEDULER_PORT, API_KEY);
        instances = status.data?.instances ?? [];
        if (instances.length > 0) break;
        await new Promise((r) => setTimeout(r, 200));
      }

      expect(instances.length).toBeGreaterThan(0);
      expect(instances[0].agentName ?? instances[0].name).toBe("echo-agent");

      // Kill the running agent to clean up
      await controlRequest("POST", "/control/agents/echo-agent/kill", SCHEDULER_PORT, API_KEY);
      await new Promise((r) => setTimeout(r, 2_000));
      mockServer.reset();
    });
  });

  // ---------------------------------------------------------------------------
  // Dashboard & logs
  // ---------------------------------------------------------------------------

  describe("dashboard & logs", () => {
    it("GET /dashboard serves HTML", async () => {
      const res = await fetch(`${BASE}/dashboard`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      });
      expect(res.status).toBe(200);
      const contentType = res.headers.get("content-type") ?? "";
      expect(contentType).toContain("text/html");
    });

    it("GET /api/logs/echo-agent returns JSON array", async () => {
      const res = await fetch(`${BASE}/api/logs/echo-agent`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      });
      expect(res.status).toBe(200);
      const contentType = res.headers.get("content-type") ?? "";
      expect(contentType).toContain("json");
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
    });

    it("GET /api/stats/summary returns JSON with counts", async () => {
      const res = await fetch(`${BASE}/api/stats/summary`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      });
      expect(res.status).toBe(200);
      const contentType = res.headers.get("content-type") ?? "";
      expect(contentType).toContain("json");
      const data = await res.json();
      expect(data).toBeDefined();
      expect(typeof data).toBe("object");
    });
  });
});
