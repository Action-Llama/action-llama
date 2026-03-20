import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import App from "../../src/tui/App.js";
import { StatusTracker } from "../../src/tui/status-tracker.js";

describe("App TUI", () => {
  let instance: ReturnType<typeof render> | null = null;

  afterEach(() => {
    instance?.unmount();
    instance = null;
  });

  it("renders header with scheduler info", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "docker",
      gatewayPort: 8080,
      cronJobCount: 3,
      webhooksActive: true,
      webhookUrls: ["http://localhost:8080/webhooks/github"],
      startedAt: new Date(),
    });

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    expect(output).toContain("Action Llama");
    expect(output).toContain("Docker mode");
    expect(output).toContain("1 agent");
    expect(output).toContain("3 cron jobs");
    expect(output).toContain("Gateway: :8080");
    expect(output).toContain("Webhooks: active");
  });

  it("renders agent rows with state", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.registerAgent("reviewer");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 2,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
    });

    tracker.setAgentState("dev", "running");
    tracker.setAgentStatusText("dev", "Implementing issue #42");

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    expect(output).toContain("dev");
    expect(output).toContain("Running");
    expect(output).toContain("Implementing issue #42");
    expect(output).toContain("reviewer");
    expect(output).toContain("Idle");
  });

  it("renders recent activity", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 1,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
    });

    tracker.addLogLine("dev", "dequeue-issue completed");

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    expect(output).toContain("Recent:");
    expect(output).toContain("[dev]");
    expect(output).toContain("dequeue-issue completed");
  });

  it("renders footer", () => {
    const tracker = new StatusTracker();
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
    });

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    expect(output).toContain("Ctrl+C: Stop");
  });

  it("renders error state with detail", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 1,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
    });

    tracker.completeRun("dev", 5000, "$ gh pr list — Resource not accessible by personal access token");

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    expect(output).toContain("Error");
    expect(output).toContain("Resource not accessible");
  });

  it("shows scale info for scaled agents when running", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev", 3);
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 1,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
    });

    tracker.startRun("dev");
    tracker.startRun("dev");

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    expect(output).toContain("Running 2/3");
  });

  it("shows scale multiplier for idle scaled agents", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev", 3);
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 1,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
    });

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    expect(output).toContain("Idle (\u00d73)");
  });

  it("shows plain state for scale=1 agents", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 1,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
    });

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    expect(output).toContain("Idle");
    expect(output).not.toContain("\u00d7");
  });

  it("renders initializing view during image builds", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.registerAgent("reviewer");
    tracker.setSchedulerInfo({
      mode: "docker",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
      initializing: true,
    });

    tracker.setAgentState("dev", "building");
    tracker.setAgentStatusText("dev", "Step 3/5: RUN npm install");

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    expect(output).toContain("Initializing");
    expect(output).toContain("dev");
    expect(output).toContain("Step 3/5: RUN npm install");
    expect(output).toContain("reviewer");
    expect(output).toContain("Building Docker images");
    // Should NOT show the running view elements
    expect(output).not.toContain("Enable/Disable");
    expect(output).not.toContain("cron job");
  });

  it("renders initializing view with base image status", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "docker",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
      initializing: true,
    });

    tracker.setBaseImageStatus("Step 2/8: RUN npm ci");

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    expect(output).toContain("Base image");
    expect(output).toContain("Step 2/8: RUN npm ci");
  });

  it("switches from initializing to running view", async () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "docker",
      gatewayPort: 8080,
      cronJobCount: 1,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
      initializing: true,
    });

    instance = render(<App statusTracker={tracker} />);

    let output = instance.lastFrame()!;
    expect(output).toContain("Initializing");
    expect(output).not.toContain("Enable/Disable");

    // Transition to running
    tracker.setSchedulerInfo({
      mode: "docker",
      gatewayPort: 8080,
      cronJobCount: 1,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
      initializing: false,
    });

    await new Promise((r) => setTimeout(r, 50));

    output = instance.lastFrame()!;
    expect(output).not.toContain("Initializing");
    expect(output).toContain("Docker mode");
    expect(output).toContain("Enable/Disable");
  });

  it("updates when tracker emits events", async () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 1,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
    });

    instance = render(<App statusTracker={tracker} />);

    // Initially idle
    let output = instance.lastFrame()!;
    expect(output).toContain("Idle");

    // Change state
    tracker.setAgentState("dev", "running");

    // Wait a tick for React to process the state update
    await new Promise((r) => setTimeout(r, 50));

    output = instance.lastFrame()!;
    expect(output).toContain("Running");
  });
});
