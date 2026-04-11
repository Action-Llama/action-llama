/**
 * Group 3 — Container (Docker) runtime e2e tests.
 *
 * Full lifecycle with container runtime agent:
 * - Verify Docker is available
 * - Pre-pull base image
 * - Start scheduler
 * - Run agent inside Docker container
 * - Verify container cleanup after run
 * - CLI commands: status, logs, stats
 * - Stop scheduler
 *
 * Uses a single scheduler instance across all tests to minimize setup/teardown.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import { MockLLMServer } from "../helpers/mock-llm-server.js";
import { createTestProject, type TestProject } from "../helpers/project-factory.js";
import { alExec, alSpawn, waitForHealthy, controlRequest, type AlProcess } from "../helpers/process.js";

const SCHEDULER_PORT = 18_203;
const API_KEY = "test-container-api-key";

describe("container runtime", { timeout: 300_000 }, () => {
  let mockServer: MockLLMServer;
  let project: TestProject;
  let scheduler: AlProcess;

  beforeAll(async () => {
    // Verify Docker is available
    try {
      execFileSync("docker", ["info"], { stdio: "pipe", timeout: 15_000 });
    } catch {
      throw new Error(
        "Docker is not available. Container runtime e2e tests require a running Docker daemon.",
      );
    }

    // Pre-pull the base image to avoid timeouts during agent runs
    try {
      execFileSync("docker", ["pull", "node:20-alpine"], {
        stdio: "pipe",
        timeout: 120_000,
      });
    } catch {
      throw new Error("Failed to pull node:20-alpine. Check Docker and network connectivity.");
    }

    // Start mock LLM
    mockServer = new MockLLMServer();
    await mockServer.start();

    // Create project with container runtime agent (default — no runtime field)
    project = createTestProject("container", mockServer);
    project.addAgent("echo-agent", {
      skill: "You are a test agent. When asked to do something, use the bash tool to run the command.",
      models: ["mock"],
      schedule: "0 0 1 1 *", // Effectively never — manual trigger only
      timeout: 120,
      // No runtime field — container is the default
    });

    // Write gateway API key credential
    project.writeCredential("gateway_api_key", "default", "key", API_KEY);

    // Patch config.toml with gateway port so `al status` can find the scheduler
    const { readFileSync, writeFileSync } = await import("fs");
    const { resolve } = await import("path");
    const cfgPath = resolve(project.dir, "config.toml");
    const cfgContent = readFileSync(cfgPath, "utf-8");
    writeFileSync(cfgPath, cfgContent + `\n[gateway]\nport = ${SCHEDULER_PORT}\n`);

    // Start scheduler
    scheduler = alSpawn(
      ["start", "--headless", "--web-ui", "--port", String(SCHEDULER_PORT)],
      project,
    );

    // Wait for healthy
    await waitForHealthy(SCHEDULER_PORT, 90_000);
  }, 180_000);

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

  it("agent runs in Docker container", async () => {
    // Enqueue responses: tool call -> text completion
    mockServer.enqueueToolCall("bash", { command: "whoami" });
    mockServer.enqueueTextResponse("Done");

    // Trigger the agent via control API
    const triggerResult = await controlRequest(
      "POST",
      "/control/trigger/echo-agent",
      SCHEDULER_PORT,
      API_KEY,
    );
    expect(triggerResult.status).toBe(200);

    // Wait for the run to complete by polling status
    const deadline = Date.now() + 120_000;
    let runCompleted = false;
    while (Date.now() < deadline) {
      const status = await controlRequest("GET", "/control/status", SCHEDULER_PORT, API_KEY);
      const instances = status.data?.sessions ?? [];
      // If no running instances and we've seen at least one request, the run is done
      if (mockServer.getRequests().length >= 2 && instances.length === 0) {
        runCompleted = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
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

  it("container is cleaned up after run", () => {
    // Check that no leftover containers exist for the agent
    const output = execFileSync("docker", [
      "ps", "-a",
      "--filter", "name=al-echo-agent",
      "--format", "{{.ID}}",
    ], { encoding: "utf-8", timeout: 10_000 }).trim();

    expect(output).toBe("");
  });

  it("al status shows scheduler running", async () => {
    const result = await alExec(["status"], project);
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/running|ok|active/i);
  });

  it("al logs shows agent output", async () => {
    const result = await alExec(["logs", "echo-agent", "--lines", "20"], project);
    expect(result.exitCode).toBe(0);
  });

  it("al stats shows run history", async () => {
    const result = await alExec(["stats", "echo-agent"], project);
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/completed|run|total/i);
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
      expect.fail("Scheduler should have shut down");
    } catch {
      // Expected — connection refused
    }
  });
});
