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
      brokerPort: 8080,
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
    expect(output).toContain("Broker: :8080");
    expect(output).toContain("Webhooks: active");
  });

  it("renders agent rows with state", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.registerAgent("reviewer");
    tracker.setSchedulerInfo({
      mode: "host",
      brokerPort: null,
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
      brokerPort: null,
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
      brokerPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
    });

    instance = render(<App statusTracker={tracker} />);
    const output = instance.lastFrame()!;

    expect(output).toContain("Ctrl+C to stop");
  });

  it("updates when tracker emits events", async () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setSchedulerInfo({
      mode: "host",
      brokerPort: null,
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
