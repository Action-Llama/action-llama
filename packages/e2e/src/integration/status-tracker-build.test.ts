/**
 * Integration tests: StatusTracker build lifecycle and token usage — no Docker.
 *
 * Tests startBuild/completeBuild methods (used during Docker image build phase),
 * endRun with token usage (exercises addTokenUsage cumulative tracking),
 * and the getSchedulerInfo/setSchedulerInfo round-trip.
 *
 * Covers:
 *   - tui/status-tracker.ts: startBuild(), completeBuild(), endRun() with usage,
 *     getSchedulerInfo(), setSchedulerInfo(), setAgentDescription(), setAgentStatusText()
 *   - shared/usage.ts: addTokenUsage() — indirectly via endRun's cumulative tracking
 */

import { describe, it, expect } from "vitest";
import { StatusTracker } from "@action-llama/action-llama/internals/status-tracker";

describe("status-tracker-build: build lifecycle", { timeout: 10_000 }, () => {
  it("startBuild transitions agent to building state", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("build-agent", 1);

    tracker.startBuild("build-agent", "new agent detected");

    const agent = tracker.getAllAgents().find((a) => a.name === "build-agent")!;
    expect(agent.state).toBe("building");
  });

  it("completeBuild transitions agent back to idle state", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("build-complete-agent", 1);

    tracker.startBuild("build-complete-agent");
    tracker.completeBuild("build-complete-agent");

    const agent = tracker.getAllAgents().find((a) => a.name === "build-complete-agent")!;
    expect(agent.state).toBe("idle");
  });

  it("startBuild on unknown agent is a no-op", () => {
    const tracker = new StatusTracker();
    // Should not throw
    expect(() => tracker.startBuild("nonexistent-agent")).not.toThrow();
  });
});

describe("status-tracker-build: token usage accumulation", { timeout: 10_000 }, () => {
  it("endRun with usage sets lastRunUsage", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("usage-agent", 1);
    tracker.startRun("usage-agent");

    const usage = {
      inputTokens: 100,
      outputTokens: 200,
      cacheReadTokens: 50,
      cacheWriteTokens: 10,
      totalTokens: 360,
      cost: 0.005,
      turnCount: 3,
    };
    tracker.endRun("usage-agent", 2000, undefined, usage);

    const agent = tracker.getAllAgents().find((a) => a.name === "usage-agent")!;
    expect(agent.lastRunUsage?.inputTokens).toBe(100);
    expect(agent.lastRunUsage?.outputTokens).toBe(200);
    expect(agent.lastRunUsage?.cost).toBe(0.005);
  });

  it("endRun accumulates usage in cumulativeUsage across multiple runs", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("cumul-agent", 1);

    const usage1 = {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 150,
      cost: 0.001,
      turnCount: 2,
    };
    const usage2 = {
      inputTokens: 200,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 300,
      cost: 0.002,
      turnCount: 4,
    };

    // First run
    tracker.startRun("cumul-agent");
    tracker.endRun("cumul-agent", 1000, undefined, usage1);

    // Second run
    tracker.startRun("cumul-agent");
    tracker.endRun("cumul-agent", 1500, undefined, usage2);

    const agent = tracker.getAllAgents().find((a) => a.name === "cumul-agent")!;
    // Cumulative should be the sum of both runs
    expect(agent.cumulativeUsage?.inputTokens).toBe(300);
    expect(agent.cumulativeUsage?.outputTokens).toBe(150);
    expect(agent.cumulativeUsage?.cost).toBeCloseTo(0.003);
    expect(agent.cumulativeUsage?.turnCount).toBe(6);
  });
});

describe("status-tracker-build: scheduler info and misc setters", { timeout: 10_000 }, () => {
  it("setSchedulerInfo / getSchedulerInfo round-trip", () => {
    const tracker = new StatusTracker();
    expect(tracker.getSchedulerInfo()).toBeNull();

    const info = { version: "1.2.3", uptime: 3600, paused: false };
    tracker.setSchedulerInfo(info);

    const retrieved = tracker.getSchedulerInfo();
    expect(retrieved?.version).toBe("1.2.3");
    expect(retrieved?.uptime).toBe(3600);
    expect(retrieved?.paused).toBe(false);
  });

  it("setAgentDescription updates agent description", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("desc-agent", 1, "initial description");

    tracker.setAgentDescription("desc-agent", "updated description");

    const agent = tracker.getAllAgents().find((a) => a.name === "desc-agent")!;
    expect(agent.description).toBe("updated description");
  });

  it("setAgentStatusText updates statusText", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("status-text-agent", 1);

    tracker.setAgentStatusText("status-text-agent", "Checking GitHub...");

    const agent = tracker.getAllAgents().find((a) => a.name === "status-text-agent")!;
    expect(agent.statusText).toBe("Checking GitHub...");
  });

  it("setAgentError sets lastError on the agent", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("error-agent", 1);

    tracker.setAgentError("error-agent", "Failed to connect");

    const agent = tracker.getAllAgents().find((a) => a.name === "error-agent")!;
    expect(agent.lastError).toBe("Failed to connect");
  });
});
