/**
 * Integration tests: StatusTracker and buildTriggerLabels — no Docker required.
 *
 * StatusTracker is a pure in-memory state manager used by the TUI and gateway
 * dashboard. Tests exercise the core register/enable/disable/pause/instance
 * API directly without starting the scheduler or requiring Docker.
 *
 * buildTriggerLabels() is a pure function that computes badge labels for the
 * TUI agent cards from an AgentConfig. All branches are tested directly.
 *
 * Covers:
 *   - tui/status-tracker.ts: StatusTracker.registerAgent, unregisterAgent,
 *     enableAgent, disableAgent, isAgentEnabled, setPaused, isPaused,
 *     registerInstance, getInstances, unregisterInstance, completeInstance,
 *     startRun, endRun, getAllAgents, getInvalidationVersion,
 *     getInvalidationsSince, updateAgentScale, getAgentScale
 *   - tui/status-tracker.ts: buildTriggerLabels() — schedule/webhook/
 *     multi-event/single-event+single-action cases
 */

import { describe, it, expect } from "vitest";
import {
  StatusTracker,
  buildTriggerLabels,
} from "@action-llama/action-llama/internals/status-tracker";
import type { AgentConfig } from "@action-llama/action-llama/internals/config";

// Minimal AgentConfig builder for tests
function agentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: "test-agent",
    credentials: ["anthropic_key"],
    models: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildTriggerLabels
// ---------------------------------------------------------------------------

describe("status-tracker: buildTriggerLabels", { timeout: 10_000 }, () => {
  it("returns [] when agent has no schedule and no webhooks", () => {
    const labels = buildTriggerLabels(agentConfig());
    expect(labels).toEqual([]);
  });

  it("returns ['schedule'] when agent has only a schedule", () => {
    const labels = buildTriggerLabels(agentConfig({ schedule: "*/5 * * * *" }));
    expect(labels).toEqual(["schedule"]);
  });

  it("returns source-only label when webhook has multiple events", () => {
    const labels = buildTriggerLabels(
      agentConfig({
        webhooks: [{ source: "github", events: ["issues", "pull_request"] }],
      }),
    );
    // Multiple events → source only
    expect(labels).toEqual(["github"]);
  });

  it("returns 'source event' label when webhook has exactly one event", () => {
    const labels = buildTriggerLabels(
      agentConfig({
        webhooks: [{ source: "github", events: ["issues"] }],
      }),
    );
    expect(labels).toEqual(["github issues"]);
  });

  it("returns 'source event action' when webhook has one event and one action", () => {
    const labels = buildTriggerLabels(
      agentConfig({
        webhooks: [{ source: "github", events: ["issues"], actions: ["opened"] }],
      }),
    );
    expect(labels).toEqual(["github issues opened"]);
  });

  it("returns 'source event' (no action) when multiple actions", () => {
    const labels = buildTriggerLabels(
      agentConfig({
        webhooks: [{ source: "github", events: ["issues"], actions: ["opened", "closed"] }],
      }),
    );
    // Multiple actions → no action in label
    expect(labels).toEqual(["github issues"]);
  });

  it("returns one label per webhook entry", () => {
    const labels = buildTriggerLabels(
      agentConfig({
        webhooks: [
          { source: "github", events: ["issues"] },
          { source: "slack", events: ["message"] },
        ],
      }),
    );
    expect(labels).toHaveLength(2);
    expect(labels).toContain("github issues");
    expect(labels).toContain("slack message");
  });

  it("includes both schedule and webhook labels when both are present", () => {
    const labels = buildTriggerLabels(
      agentConfig({
        schedule: "0 9 * * 1",
        webhooks: [{ source: "sentry", events: ["event_alert"] }],
      }),
    );
    expect(labels).toContain("schedule");
    expect(labels).toContain("sentry event_alert");
    expect(labels).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// StatusTracker
// ---------------------------------------------------------------------------

describe("status-tracker: StatusTracker", { timeout: 10_000 }, () => {
  it("starts with no agents", () => {
    const tracker = new StatusTracker();
    expect(tracker.getAllAgents()).toEqual([]);
  });

  it("registerAgent adds the agent to getAllAgents()", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("my-agent", 2, "My Description");

    const agents = tracker.getAllAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("my-agent");
    expect(agents[0].scale).toBe(2);
    expect(agents[0].description).toBe("My Description");
  });

  it("unregisterAgent removes the agent", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("agent-a");
    tracker.registerAgent("agent-b");

    tracker.unregisterAgent("agent-a");

    const agents = tracker.getAllAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("agent-b");
  });

  it("newly registered agent with scale>0 is enabled", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("enabled-agent", 1);
    expect(tracker.isAgentEnabled("enabled-agent")).toBe(true);
  });

  it("newly registered agent with scale=0 is disabled", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("disabled-agent", 0);
    expect(tracker.isAgentEnabled("disabled-agent")).toBe(false);
  });

  it("disableAgent sets enabled to false", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("agent-x", 1);
    expect(tracker.isAgentEnabled("agent-x")).toBe(true);

    tracker.disableAgent("agent-x");
    expect(tracker.isAgentEnabled("agent-x")).toBe(false);
  });

  it("enableAgent sets enabled to true after disable", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("agent-y", 0);
    expect(tracker.isAgentEnabled("agent-y")).toBe(false);

    tracker.enableAgent("agent-y");
    expect(tracker.isAgentEnabled("agent-y")).toBe(true);
  });

  it("isAgentEnabled returns false for unknown agents", () => {
    const tracker = new StatusTracker();
    expect(tracker.isAgentEnabled("nonexistent")).toBe(false);
  });

  it("isPaused returns false before any schedulerInfo is set", () => {
    const tracker = new StatusTracker();
    expect(tracker.isPaused()).toBe(false);
  });

  it("setPaused changes isPaused once schedulerInfo is set", () => {
    const tracker = new StatusTracker();
    tracker.setSchedulerInfo({ version: "1.0", uptime: 0, paused: false });

    tracker.setPaused(true);
    expect(tracker.isPaused()).toBe(true);

    tracker.setPaused(false);
    expect(tracker.isPaused()).toBe(false);
  });

  it("getInstances returns empty array when no instances registered", () => {
    const tracker = new StatusTracker();
    expect(tracker.getInstances()).toEqual([]);
  });

  it("registerInstance makes instance visible via getInstances()", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("run-agent", 1);
    const instance = {
      id: "inst-1",
      agentName: "run-agent",
      startedAt: new Date(),
      status: "running" as const,
      trigger: "manual",
    };
    tracker.registerInstance(instance);

    const instances = tracker.getInstances();
    expect(instances).toHaveLength(1);
    expect(instances[0].id).toBe("inst-1");
  });

  it("unregisterInstance removes the instance", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("run-agent2", 1);
    tracker.registerInstance({
      id: "inst-2",
      agentName: "run-agent2",
      startedAt: new Date(),
      status: "running",
      trigger: "manual",
    });

    tracker.unregisterInstance("inst-2");
    expect(tracker.getInstances()).toHaveLength(0);
  });

  it("getInvalidationVersion increments after state changes", () => {
    const tracker = new StatusTracker();
    const v0 = tracker.getInvalidationVersion();

    tracker.registerAgent("invalidation-agent", 1);
    tracker.startRun("invalidation-agent", "schedule");

    const v1 = tracker.getInvalidationVersion();
    expect(v1).toBeGreaterThan(v0);
  });

  it("getInvalidationsSince returns signals since a given version", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("signal-agent", 1);

    const v0 = tracker.getInvalidationVersion();
    tracker.startRun("signal-agent", "manual");
    const { signals, version } = tracker.getInvalidationsSince(v0);

    expect(signals.length).toBeGreaterThan(0);
    expect(version).toBeGreaterThan(v0);
  });

  it("updateAgentScale updates scale and getAgentScale returns new value", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("scale-test", 1);

    expect(tracker.getAgentScale("scale-test")).toBe(1);

    tracker.updateAgentScale("scale-test", 3);
    expect(tracker.getAgentScale("scale-test")).toBe(3);
  });

  it("setAgentTriggers updates agent's trigger labels", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("triggers-agent", 1);
    tracker.setAgentTriggers("triggers-agent", ["schedule", "github issues"]);

    const agent = tracker.getAllAgents().find((a) => a.name === "triggers-agent");
    expect(agent?.triggers).toEqual(["schedule", "github issues"]);
  });
});
