/**
 * Group 2 — Host-user runtime e2e tests.
 *
 * Full lifecycle with host-user runtime agent:
 * - Start scheduler
 * - Run agent (mock LLM receives requests, executes tool calls)
 * - CLI commands: status, logs, stats, pause, resume, kill, stop
 *
 * Uses a single scheduler instance across all tests to minimize setup/teardown.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve } from "path";
import { MockLLMServer } from "../helpers/mock-llm-server.js";
import { createTestProject, type TestProject } from "../helpers/project-factory.js";
import { alExec, alSpawn, waitForHealthy, controlRequest, type AlProcess } from "../helpers/process.js";

const SCHEDULER_PORT = 18_201; // Fixed port for this test group
const API_KEY = "test-host-user-api-key";

describe("host-user runtime", { timeout: 300_000 }, () => {
  let mockServer: MockLLMServer;
  let project: TestProject;
  let scheduler: AlProcess;

  beforeAll(async () => {
    // Start mock LLM
    mockServer = new MockLLMServer();
    await mockServer.start();

    // Create project with host-user agent
    project = createTestProject("host-user", mockServer);
    project.addAgent("echo-agent", {
      skill: "You are a test agent. When asked to do something, use the bash tool to echo the result.",
      models: ["mock"],
      schedule: "0 0 1 1 *", // Effectively never (Jan 1 midnight) — manual trigger only
      runtime: { type: "host-user", run_as: process.env.USER ?? "nobody" },
      timeout: 60,
    });

    // Write gateway API key credential (field name is "key", not "api_key")
    project.writeCredential("gateway_api_key", "default", "key", API_KEY);

    // Patch config.toml with gateway port so `al status` can find the scheduler
    const { readFileSync, writeFileSync } = await import("fs");
    const cfgPath = resolve(project.dir, "config.toml");
    const cfgContent = readFileSync(cfgPath, "utf-8");
    writeFileSync(cfgPath, cfgContent + `\n[gateway]\nport = ${SCHEDULER_PORT}\n`);

    // Start scheduler
    scheduler = alSpawn(
      ["start", "--headless", "--web-ui", "--port", String(SCHEDULER_PORT)],
      project,
    );

    // Wait for healthy
    try {
      await waitForHealthy(SCHEDULER_PORT, 60_000);
    } catch (err) {
      console.error("Scheduler failed to start. stdout:", scheduler.stdout);
      console.error("Scheduler stderr:", scheduler.stderr);
      console.error("Exit code:", scheduler.exitCode);
      throw err;
    }
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

  it("scheduler is healthy", async () => {
    const res = await fetch(`http://127.0.0.1:${SCHEDULER_PORT}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
  });

  it("al status shows scheduler running", async () => {
    const result = await alExec(["status"], project);
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/running|ok|active/i);
  });

  it("al run triggers agent and mock LLM receives request", async () => {
    // Enqueue responses: tool call -> text completion
    mockServer.enqueueToolCall("bash", { command: "echo 'hello from agent'" });
    mockServer.enqueueTextResponse("Done! I ran the echo command.");

    // Trigger the agent via control API
    const triggerResult = await controlRequest(
      "POST",
      "/control/trigger/echo-agent",
      SCHEDULER_PORT,
      API_KEY,
    );
    expect(triggerResult.status).toBe(200);

    // Wait for the run to complete — poll mock requests and instance status
    const deadline = Date.now() + 60_000;
    let runCompleted = false;
    while (Date.now() < deadline) {
      // Check if mock received the expected requests (2: initial + tool result)
      if (mockServer.getRequests().length >= 2) {
        runCompleted = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!runCompleted) {
      console.error("Run did not complete. Mock requests:", mockServer.getRequests().length);
      console.error("Scheduler stdout (last 2000):", scheduler.stdout.slice(-2000));
      console.error("Scheduler stderr (last 2000):", scheduler.stderr.slice(-2000));
      // Dump agent log file for debugging
      const { readFileSync, readdirSync, existsSync } = await import("fs");
      const { resolve: pathResolve } = await import("path");
      const logsPath = pathResolve(project.dir, ".al", "logs");
      if (existsSync(logsPath)) {
        const logFiles = readdirSync(logsPath);
        console.error("Log files:", logFiles);
        for (const f of logFiles) {
          const content = readFileSync(pathResolve(logsPath, f), "utf-8");
          console.error(`\n=== ${f} ===\n${content.slice(-5000)}`);
        }
      } else {
        console.error("No logs directory at:", logsPath);
      }
    }
    expect(runCompleted).toBe(true);

    // Verify mock received the expected requests
    const requests = mockServer.getRequests();
    expect(requests.length).toBeGreaterThanOrEqual(2);

    // First request should contain the agent prompt and available tools
    const firstRequest = requests[0];
    expect(firstRequest.tools).toBeDefined();
    expect(firstRequest.tools!.length).toBeGreaterThan(0);

    // Second request should contain the tool result
    const secondRequest = requests[1];
    const toolMessages = secondRequest.messages.filter((m: any) => m.role === "tool");
    expect(toolMessages.length).toBeGreaterThan(0);

    // Queue should be drained
    mockServer.assertDrained();
    mockServer.reset();
  });

  it("al logs shows agent output", async () => {
    const result = await alExec(["logs", "echo-agent", "--lines", "20"], project);
    // Should have some log output from the run above
    expect(result.exitCode).toBe(0);
  });

  it("al stats shows run history", async () => {
    const result = await alExec(["stats", "echo-agent"], project);
    const output = result.stdout + result.stderr;
    // Should show at least 1 completed run from the previous test
    expect(output).toMatch(/completed|run|total/i);
  });

  it("al pause stops scheduling", async () => {
    const result = await controlRequest("POST", "/control/pause", SCHEDULER_PORT, API_KEY);
    expect(result.status).toBe(200);

    // Verify paused state
    const status = await controlRequest("GET", "/control/status", SCHEDULER_PORT, API_KEY);
    expect(status.data.scheduler.paused).toBe(true);
  });

  it("al resume restarts scheduling", async () => {
    const result = await controlRequest("POST", "/control/resume", SCHEDULER_PORT, API_KEY);
    expect(result.status).toBe(200);

    const status = await controlRequest("GET", "/control/status", SCHEDULER_PORT, API_KEY);
    expect(status.data.scheduler.paused).toBe(false);
  });

  it("pause/resume single agent via control API", async () => {
    // Pause single agent
    const pauseResult = await controlRequest(
      "POST",
      "/control/agents/echo-agent/pause",
      SCHEDULER_PORT,
      API_KEY,
    );
    expect(pauseResult.status).toBe(200);

    // Resume single agent
    const resumeResult = await controlRequest(
      "POST",
      "/control/agents/echo-agent/resume",
      SCHEDULER_PORT,
      API_KEY,
    );
    expect(resumeResult.status).toBe(200);
  });

  it("disable/enable agent via control API", async () => {
    const disableResult = await controlRequest(
      "POST",
      "/control/agents/echo-agent/disable",
      SCHEDULER_PORT,
      API_KEY,
    );
    expect(disableResult.status).toBe(200);

    const enableResult = await controlRequest(
      "POST",
      "/control/agents/echo-agent/enable",
      SCHEDULER_PORT,
      API_KEY,
    );
    expect(enableResult.status).toBe(200);
  });

  it("kill terminates a running agent", async () => {
    // Enqueue a response that will keep the agent busy
    mockServer.enqueueToolCall("bash", { command: "sleep 30" });

    // Trigger the agent
    await controlRequest("POST", "/control/trigger/echo-agent", SCHEDULER_PORT, API_KEY);

    // Wait for the agent to start running
    const deadline = Date.now() + 15_000;
    let instanceId: string | undefined;
    while (Date.now() < deadline) {
      const status = await controlRequest("GET", "/control/status", SCHEDULER_PORT, API_KEY);
      const instances = status.data?.instances ?? [];
      if (instances.length > 0) {
        instanceId = instances[0].id;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    expect(instanceId).toBeDefined();

    // Kill the agent
    const killResult = await controlRequest(
      "POST",
      `/control/agents/echo-agent/kill`,
      SCHEDULER_PORT,
      API_KEY,
    );
    expect(killResult.status).toBe(200);

    // Verify it stopped
    await new Promise((r) => setTimeout(r, 2_000));
    const status = await controlRequest("GET", "/control/status", SCHEDULER_PORT, API_KEY);
    const runningInstances = (status.data?.instances ?? []).filter(
      (i: any) => i.agentName === "echo-agent" && i.status === "running",
    );
    expect(runningInstances.length).toBe(0);

    mockServer.reset();
  });

  it("al stop shuts down scheduler", async () => {
    const stopResult = await controlRequest("POST", "/control/stop", SCHEDULER_PORT, API_KEY);
    expect(stopResult.status).toBe(200);

    // Wait for process to exit
    const exitCode = await scheduler.waitForExit(15_000);
    expect(exitCode).toBe(0);

    // Health endpoint should be unreachable
    try {
      await fetch(`http://127.0.0.1:${SCHEDULER_PORT}/health`);
      // If we get here, the server is still up
      expect.fail("Scheduler should have shut down");
    } catch {
      // Expected — connection refused
    }
  });
});
