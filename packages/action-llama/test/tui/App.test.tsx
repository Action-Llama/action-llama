import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import App from "../../src/tui/App.js";
import { StatusTracker } from "../../src/tui/status-tracker.js";

vi.mock("../../src/shared/config.js", () => ({
  getProjectScale: vi.fn().mockReturnValue(5),
  updateProjectScale: vi.fn(),
  updateAgentRuntimeField: vi.fn(),
}));

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

  it("renders header with paused state", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 1,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: true,
    });

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    expect(output).toContain("Scheduler paused");
  });

  it("renders header with dashboard url", () => {
    const tracker = new StatusTracker();
    tracker.setSchedulerInfo({
      mode: "docker",
      gatewayPort: 8080,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
      dashboardUrl: "https://app.actionllama.com/dashboard",
    });

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    expect(output).toContain("Dashboard: https://app.actionllama.com/dashboard");
  });

  it("renders header with project name", () => {
    const tracker = new StatusTracker();
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
      projectName: "my-cool-project",
    });

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    expect(output).toContain("my-cool-project");
  });

  it("renders header with disabled agent count", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.registerAgent("reviewer");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });
    tracker.disableAgent("reviewer");

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    expect(output).toContain("disabled");
  });

  it("renders agent row with last run timing info", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    // Use completeRun which sets lastRunAt and lastRunDuration
    tracker.completeRun("dev", 45000); // 45 seconds

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    // Should show last run timing
    expect(output).toContain("Last:");
    expect(output).toContain("45s");
  });

  it("renders agent row with last run duration in minutes", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    // 2 minutes 5 seconds = 125000 ms
    tracker.completeRun("dev", 125000);

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    expect(output).toContain("2m5s");
  });

  it("renders agent row with last run duration in exact minutes (no seconds)", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    // Exactly 3 minutes = 180000 ms
    tracker.completeRun("dev", 180000);

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    expect(output).toContain("3m");
    // Should NOT have trailing seconds for exact minutes
    expect(output).not.toContain("3m0s");
  });

  it("renders agent row with last run time as hours ago when run was long ago", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    tracker.completeRun("dev", 1000);

    // Mock Date.now() to be 2 hours after the run completed
    const originalNow = Date.now;
    Date.now = () => originalNow() + 2 * 60 * 60 * 1000;

    try {
      instance = render(<App statusTracker={tracker} />);
      const output = instance.lastFrame()!;

      expect(output).toContain("h ago");
    } finally {
      Date.now = originalNow;
    }
  });

  it("renders agent row with last run time as minutes ago", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    tracker.completeRun("dev", 1000);

    // Mock Date.now() to be 5 minutes after the run
    const originalNow = Date.now;
    Date.now = () => originalNow() + 5 * 60 * 1000;

    try {
      instance = render(<App statusTracker={tracker} />);
      const output = instance.lastFrame()!;

      expect(output).toContain("m ago");
    } finally {
      Date.now = originalNow;
    }
  });

  it("renders agent row with next run time in seconds", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    // Next run in 30 seconds
    const nextRun = new Date(Date.now() + 30 * 1000);
    tracker.setNextRunAt("dev", nextRun);

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    // "Next:" label is present (time value may wrap to next line due to terminal width)
    expect(output).toContain("Next:");
    // Should show a seconds value somewhere in the output
    expect(output).toMatch(/\d+s/);
  });

  it("renders agent row with next run time in minutes", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    // Next run in 10 minutes - use a range check since exact timing may vary
    const nextRun = new Date(Date.now() + 10 * 60 * 1000);
    tracker.setNextRunAt("dev", nextRun);

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    expect(output).toContain("Next:");
    // Should show some minutes value (9m or 10m depending on timing)
    expect(output).toMatch(/\d+m/);
  });

  it("renders agent row with next run time as 'now' when time has passed", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    // Next run in the past
    const pastRun = new Date(Date.now() - 5000);
    tracker.setNextRunAt("dev", pastRun);

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    expect(output).toContain("Next:");
    // "now" may appear on same or next line depending on terminal wrap
    expect(output).toContain("now");
  });

  it("renders agent row with token usage and cost", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    tracker.endRun("dev", 10000, undefined, {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 1500,
      cost: 0.0123,
    });

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    expect(output).toContain("1,500tok");
    expect(output).toContain("$0.0123");
  });

  it("renders agent row with task url", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    tracker.startRun("dev");
    tracker.setTaskUrl("dev", "https://console.cloud.google.com/run/task/123");

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    expect(output).toContain("Logs:");
    expect(output).toContain("console.cloud.google.com");
  });

  it("renders agent row with building state", () => {
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
    });

    tracker.setAgentState("dev", "building");
    tracker.setAgentStatusText("dev", "Step 2/5: RUN npm ci");

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    expect(output).toContain("Building");
    expect(output).toContain("Step 2/5");
  });

  it("renders agent row with selected highlight", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.registerAgent("reviewer");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    // First agent should be selected (index 0)
    expect(output).toContain("▶");
    expect(output).toContain("dev");
  });

  it("renders disabled agent label", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    tracker.disableAgent("dev");

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    expect(output).toContain("Disabled");
  });

  it("renders recent activity with formatted timestamp", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    tracker.addLogLine("dev", "completed task successfully");

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    expect(output).toContain("Recent:");
    expect(output).toContain("[dev]");
    // Should contain time format HH:MM:SS
    expect(output).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("renders footer with project-config view mode hint", async () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    instance = render(<App statusTracker={tracker} projectPath="/tmp/project" />);

    // Press 'c' to open project config
    instance.stdin.write("c");
    await new Promise((r) => setTimeout(r, 50));

    const output = instance.lastFrame()!;
    expect(output).toContain("Adjust value");
    expect(output).toContain("Esc: Back");
  });

  it("renders project config view with scale controls", async () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    instance = render(<App statusTracker={tracker} projectPath="/tmp/project" />);

    // Press 'c' to open project config
    instance.stdin.write("c");
    await new Promise((r) => setTimeout(r, 50));

    const output = instance.lastFrame()!;
    expect(output).toContain("Project Configuration");
    expect(output).toContain("Project Scale");
  });

  it("closes project config on Escape", async () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    instance = render(<App statusTracker={tracker} projectPath="/tmp/project" />);

    // Open project config
    instance.stdin.write("c");
    await new Promise((r) => setTimeout(r, 50));

    // Verify we're in project config
    expect(instance.lastFrame()!).toContain("Project Configuration");

    // Press Escape to go back
    instance.stdin.write("\u001B");
    await new Promise((r) => setTimeout(r, 50));

    const output = instance.lastFrame()!;
    // Should be back at main view
    expect(output).toContain("Enable/Disable");
    expect(output).not.toContain("Project Configuration");
  });

  it("renders agent config view for selected agent", async () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    instance = render(<App statusTracker={tracker} projectPath="/tmp/project" />);

    // Press 'a' to open agent config
    instance.stdin.write("a");
    await new Promise((r) => setTimeout(r, 50));

    const output = instance.lastFrame()!;
    expect(output).toContain("Agent Configuration");
    expect(output).toContain("dev");
    expect(output).toContain("Agent Scale");
  });

  it("renders footer with agent-config view mode hint", async () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    instance = render(<App statusTracker={tracker} projectPath="/tmp/project" />);

    // Press 'a' to open agent config
    instance.stdin.write("a");
    await new Promise((r) => setTimeout(r, 50));

    const output = instance.lastFrame()!;
    expect(output).toContain("Esc: Back");
    expect(output).toContain("Adjust value");
  });

  it("closes agent config on Escape", async () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    instance = render(<App statusTracker={tracker} projectPath="/tmp/project" />);

    // Open agent config
    instance.stdin.write("a");
    await new Promise((r) => setTimeout(r, 50));

    expect(instance.lastFrame()!).toContain("Agent Configuration");

    // Press Escape to go back
    instance.stdin.write("\u001B");
    await new Promise((r) => setTimeout(r, 50));

    const output = instance.lastFrame()!;
    expect(output).toContain("Enable/Disable");
    expect(output).not.toContain("Agent Configuration");
  });

  it("navigates agents with arrow keys", async () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.registerAgent("reviewer");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    instance = render(<App statusTracker={tracker} />);

    // Initially first agent is selected
    let output = instance.lastFrame()!;
    expect(output).toContain("▶");

    // Press down arrow
    instance.stdin.write("\u001B[B"); // Down arrow
    await new Promise((r) => setTimeout(r, 50));

    output = instance.lastFrame()!;
    expect(output).toContain("▶");
    // Reviewer should now be selected
    expect(output).toContain("reviewer");
  });

  it("toggles agent enabled/disabled with space key", async () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    instance = render(<App statusTracker={tracker} />);

    // Initially enabled
    let output = instance.lastFrame()!;
    expect(output).toContain("Enabled");

    // Press space to disable
    instance.stdin.write(" ");
    await new Promise((r) => setTimeout(r, 50));

    output = instance.lastFrame()!;
    expect(output).toContain("Disabled");

    // Press space again to re-enable
    instance.stdin.write(" ");
    await new Promise((r) => setTimeout(r, 50));

    output = instance.lastFrame()!;
    expect(output).toContain("Enabled");
  });

  it("does not open project config without projectPath", async () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    // No projectPath provided
    instance = render(<App statusTracker={tracker} />);

    // Press 'c' - should NOT open project config
    instance.stdin.write("c");
    await new Promise((r) => setTimeout(r, 50));

    const output = instance.lastFrame()!;
    expect(output).not.toContain("Project Configuration");
    expect(output).toContain("Ctrl+C: Stop");
  });

  it("saves project scale and returns to main view", async () => {
    const { updateProjectScale } = await import("../../src/shared/config.js");

    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    instance = render(<App statusTracker={tracker} projectPath="/tmp/project" />);

    // Open project config
    instance.stdin.write("c");
    await new Promise((r) => setTimeout(r, 50));
    expect(instance.lastFrame()!).toContain("Project Configuration");

    // Press Enter to save
    instance.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 100));

    const output = instance.lastFrame()!;
    // Should have returned to main view
    expect(output).toContain("Enable/Disable");
    expect(updateProjectScale).toHaveBeenCalledWith("/tmp/project", 5);
  });

  it("saves agent scale and returns to main view", async () => {
    const { updateAgentRuntimeField } = await import("../../src/shared/config.js");

    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    instance = render(<App statusTracker={tracker} projectPath="/tmp/project" />);

    // Open agent config
    instance.stdin.write("a");
    await new Promise((r) => setTimeout(r, 50));
    expect(instance.lastFrame()!).toContain("Agent Configuration");

    // Press Enter to save
    instance.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 100));

    const output = instance.lastFrame()!;
    // Should have returned to main view
    expect(output).toContain("Enable/Disable");
    expect(updateAgentRuntimeField).toHaveBeenCalledWith("/tmp/project", "dev", "scale", 1);
  });

  it("increases project scale with up arrow in config", async () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    instance = render(<App statusTracker={tracker} projectPath="/tmp/project" />);

    // Open project config
    instance.stdin.write("c");
    await new Promise((r) => setTimeout(r, 50));

    // Press up arrow to increase scale
    instance.stdin.write("\u001B[A"); // Up arrow
    await new Promise((r) => setTimeout(r, 50));

    const output = instance.lastFrame()!;
    expect(output).toContain("modified");
  });

  it("decreases project scale with down arrow in config", async () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    instance = render(<App statusTracker={tracker} projectPath="/tmp/project" />);

    // Open project config
    instance.stdin.write("c");
    await new Promise((r) => setTimeout(r, 50));

    // Press down arrow to try to decrease scale (but initial is 5, so goes to 4)
    instance.stdin.write("\u001B[B"); // Down arrow
    await new Promise((r) => setTimeout(r, 50));

    const output = instance.lastFrame()!;
    expect(output).toContain("modified");
  });

  it("shows error when project scale save fails", async () => {
    const { updateProjectScale } = await import("../../src/shared/config.js");
    vi.mocked(updateProjectScale).mockImplementationOnce(() => {
      throw new Error("Permission denied");
    });

    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    instance = render(<App statusTracker={tracker} projectPath="/tmp/project" />);

    // Open project config
    instance.stdin.write("c");
    await new Promise((r) => setTimeout(r, 50));

    // Press Enter to save (will fail)
    instance.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 100));

    const output = instance.lastFrame()!;
    expect(output).toContain("Error");
    expect(output).toContain("Permission denied");
  });

  it("navigates up with up arrow in main view", async () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.registerAgent("reviewer");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    instance = render(<App statusTracker={tracker} />);

    // Press down to select reviewer, then up to go back to dev
    instance.stdin.write("\u001B[B"); // Down arrow
    await new Promise((r) => setTimeout(r, 50));

    instance.stdin.write("\u001B[A"); // Up arrow
    await new Promise((r) => setTimeout(r, 50));

    const output = instance.lastFrame()!;
    // After going down then up, dev should be selected again (selection wraps back)
    expect(output).toContain("▶");
    expect(output).toContain("dev");
  });

  it("increases agent scale with up arrow in agent config view", async () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    instance = render(<App statusTracker={tracker} projectPath="/tmp/project" />);

    // Open agent config
    instance.stdin.write("a");
    await new Promise((r) => setTimeout(r, 50));

    expect(instance.lastFrame()!).toContain("Agent Configuration");

    // Press up arrow to increase scale
    instance.stdin.write("\u001B[A"); // Up arrow
    await new Promise((r) => setTimeout(r, 50));

    // Scale should have increased from default (modified indicator should appear)
    const output = instance.lastFrame()!;
    expect(output).toContain("Agent Configuration");
    expect(output).toContain("modified");
  });

  it("decreases agent scale with down arrow in agent config view", async () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    instance = render(<App statusTracker={tracker} projectPath="/tmp/project" />);

    // Open agent config
    instance.stdin.write("a");
    await new Promise((r) => setTimeout(r, 50));

    // Press up twice to get scale > 1, then down once
    instance.stdin.write("\u001B[A"); // Up arrow
    await new Promise((r) => setTimeout(r, 50));
    instance.stdin.write("\u001B[A"); // Up arrow again
    await new Promise((r) => setTimeout(r, 50));
    instance.stdin.write("\u001B[B"); // Down arrow
    await new Promise((r) => setTimeout(r, 50));

    const output = instance.lastFrame()!;
    expect(output).toContain("Agent Configuration");
    // Scale was increased then decreased, should still show modified
    expect(output).toContain("modified");
  });

  it("shows error when agent scale save fails", async () => {
    const { updateAgentRuntimeField } = await import("../../src/shared/config.js");
    vi.mocked(updateAgentRuntimeField).mockImplementationOnce(() => {
      throw new Error("Agent config save failed");
    });

    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    instance = render(<App statusTracker={tracker} projectPath="/tmp/project" />);

    // Open agent config
    instance.stdin.write("a");
    await new Promise((r) => setTimeout(r, 50));

    // Press Enter to save (will fail)
    instance.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 100));

    const output = instance.lastFrame()!;
    expect(output).toContain("Error");
    expect(output).toContain("Agent config save failed");
  });

  it("renders nothing in header when scheduler info is null", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    // Do NOT call setSchedulerInfo — info stays null

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    // Without info, the Header component returns null — no Action Llama header
    expect(output).not.toContain("Action Llama");
  });

  it("renders agent row with null last run time (formatRelativeTime null path)", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });
    // Agent with no last run — lastRunEnd and lastDuration are null

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;
    // Should render without error; dev agent is shown in idle/waiting state
    expect(output).toContain("dev");
  });

  it("fires the setInterval tick callback when timer advances", async () => {
    // Use fake timers so we can advance time without waiting 1000ms
    vi.useFakeTimers();
    try {
      const tracker = new StatusTracker();
      tracker.registerAgent("dev");
      tracker.setSchedulerInfo({
        mode: "host",
        gatewayPort: null,
        cronJobCount: 1,
        webhooksActive: false,
        webhookUrls: [],
        startedAt: new Date(),
        paused: false,
      });

      instance = render(<App statusTracker={tracker} />);

      // Advance past the 1000ms tick interval — exercises `() => setTick((t) => t + 1)`
      await vi.advanceTimersByTimeAsync(1100);

      // Component should still render correctly after tick state update
      expect(instance.lastFrame()!).toContain("dev");
    } finally {
      vi.useRealTimers();
    }
  });

  it("handles getProjectScale error gracefully in loadProjectScale effect", async () => {
    const { getProjectScale } = await import("../../src/shared/config.js");
    // Make the first call throw to exercise the catch block (line 411)
    vi.mocked(getProjectScale).mockImplementationOnce(() => {
      throw new Error("config read error");
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    instance = render(<App statusTracker={tracker} projectPath="/tmp/project" />);
    // Wait for the async loadProjectScale effect to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to load project scale:",
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });
});
