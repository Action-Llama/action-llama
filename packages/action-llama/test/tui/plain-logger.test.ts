import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { attachPlainLogger } from "../../src/tui/plain-logger.js";
import { StatusTracker } from "../../src/tui/status-tracker.js";
import type { SchedulerInfo } from "../../src/tui/status-tracker.js";
import type { TokenUsage } from "../../src/shared/usage.js";

function makeSchedulerInfo(overrides: Partial<SchedulerInfo> = {}): SchedulerInfo {
  return {
    mode: "docker",
    runtime: "local",
    projectName: "my-project",
    gatewayPort: 8080,
    cronJobCount: 2,
    webhooksActive: true,
    webhookUrls: ["http://localhost:8080/webhooks"],
    dashboardUrl: "http://localhost:8080/dashboard",
    startedAt: new Date(),
    paused: false,
    ...overrides,
  };
}

describe("attachPlainLogger", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("returns a detach function", () => {
    const tracker = new StatusTracker();
    const { detach } = attachPlainLogger(tracker);
    expect(typeof detach).toBe("function");
    detach();
  });

  it("detach stops listening to future updates", () => {
    const tracker = new StatusTracker();
    const { detach } = attachPlainLogger(tracker);
    detach();

    consoleSpy.mockClear();
    tracker.setBaseImageStatus("building image");

    // After detach, no more logs
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  describe("base image status", () => {
    it("logs when base image status changes", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);

      tracker.setBaseImageStatus("building...");

      const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
      const relevant = calls.find((c) => c.includes("base image:"));
      expect(relevant).toBeDefined();
      expect(relevant).toMatch(/base image: building\.\.\./);
    });

    it("does not log base image again if the same status is set", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);

      tracker.setBaseImageStatus("building...");
      const firstCount = consoleSpy.mock.calls.length;

      tracker.setBaseImageStatus("building...");
      // No additional base image log
      const baseCalls = consoleSpy.mock.calls.map((c) => c[0] as string).filter((c) => c.includes("base image:"));
      expect(baseCalls).toHaveLength(1);
    });

    it("does not log when base image status is null", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);

      // Null status should not produce any log
      tracker.setBaseImageStatus(null);

      const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
      const baseCalls = calls.filter((c) => c.includes("base image:"));
      expect(baseCalls).toHaveLength(0);
    });

    it("does not log when base image status transitions back to null (line 13 FALSE branch)", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);

      // First set a non-null status (lastBaseImageStatus becomes "building")
      tracker.setBaseImageStatus("building");

      const beforeCount = consoleSpy.mock.calls.filter((c) =>
        (c[0] as string).includes("base image:")
      ).length;
      expect(beforeCount).toBe(1);

      // Now set back to null: baseStatus !== lastBaseImageStatus (null !== "building"),
      // but !baseStatus is true, so the if(baseStatus) body is skipped (FALSE branch of line 13)
      tracker.setBaseImageStatus(null);

      const afterCount = consoleSpy.mock.calls.filter((c) =>
        (c[0] as string).includes("base image:")
      ).length;
      // No additional "base image:" log should appear
      expect(afterCount).toBe(1);
    });
  });

  describe("agent state transitions", () => {
    it("logs when an agent enters the 'building' state", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);
      tracker.registerAgent("dev");

      tracker.setAgentState("dev", "building");

      const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
      const relevant = calls.find((c) => c.includes("dev") && c.includes("building"));
      expect(relevant).toBeDefined();
    });

    it("logs agent status text alongside building state", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);
      tracker.registerAgent("dev");

      tracker.setAgentState("dev", "building");
      tracker.setAgentStatusText("dev", "compiling dependencies");

      const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
      const withStatus = calls.find((c) => c.includes("dev") && c.includes("compiling dependencies"));
      expect(withStatus).toBeDefined();
    });

    it("logs when an agent enters the 'running' state", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);
      tracker.registerAgent("dev");

      tracker.setAgentState("dev", "running");

      const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
      const relevant = calls.find((c) => c.includes("dev") && c.includes("running"));
      expect(relevant).toBeDefined();
    });

    it("logs running state without parenthetical reason when runReason is not set (line 34 FALSE branch)", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);
      tracker.registerAgent("dev");

      // startRun without a reason → runReason is null → FALSE branch of `agent.runReason ?`
      tracker.startRun("dev");

      const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
      const relevant = calls.find((c) => c.includes("dev") && c.includes("running"));
      expect(relevant).toBeDefined();
      // Should not contain parenthetical reason
      expect(relevant).not.toMatch(/running \(/);
    });

    it("logs running state with parenthetical reason when runReason is set", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);
      tracker.registerAgent("dev");

      // startRun with a reason → runReason is set → TRUE branch of `agent.runReason ?`
      tracker.startRun("dev", "schedule");

      const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
      const relevant = calls.find((c) => c.includes("dev") && c.includes("running"));
      expect(relevant).toBeDefined();
      expect(relevant).toMatch(/running \(schedule\)/);
    });

    it("logs when an agent enters the 'error' state", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);
      tracker.registerAgent("dev");

      tracker.setAgentState("dev", "error");
      tracker.setAgentError("dev", "container crashed");

      const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
      const relevant = calls.find((c) => c.includes("dev") && c.includes("error"));
      expect(relevant).toBeDefined();
    });

    it("logs completion when agent transitions to idle with a lastRunAt", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);
      tracker.registerAgent("dev");

      // completeRun sets state to idle and records lastRunAt
      tracker.completeRun("dev", 5000);

      const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
      const relevant = calls.find((c) => c.includes("dev") && c.includes("completed"));
      expect(relevant).toBeDefined();
    });

    it("logs next run time when agent transitions to idle with a nextRunAt set", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);
      tracker.registerAgent("dev");

      // Set the next run before completing the run, so when the state
      // transitions to idle the nextRunAt is already set
      tracker.setAgentState("dev", "running");
      const nextRun = new Date(Date.now() + 60_000);
      tracker.setNextRunAt("dev", nextRun);
      // completeRun transitions to idle; at that point nextRunAt is set
      tracker.completeRun("dev", 1000);

      const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
      const relevant = calls.find((c) => c.includes("dev") && c.includes("next run:"));
      expect(relevant).toBeDefined();
    });

    it("does not log the same state transition twice", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);
      tracker.registerAgent("dev");

      tracker.setAgentState("dev", "running");
      const countAfterFirst = consoleSpy.mock.calls.filter((c) =>
        (c[0] as string).includes("running")
      ).length;

      // Same state again - should not produce a new log
      tracker.setAgentState("dev", "running");
      const countAfterSecond = consoleSpy.mock.calls.filter((c) =>
        (c[0] as string).includes("running")
      ).length;

      expect(countAfterSecond).toBe(countAfterFirst);
    });
  });

  describe("scheduler info", () => {
    it("logs scheduler startup info on first update", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);

      tracker.setSchedulerInfo(makeSchedulerInfo({ webhookUrls: [], dashboardUrl: undefined }));

      const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
      const relevant = calls.find((c) => c.includes("scheduler started"));
      expect(relevant).toBeDefined();
      expect(relevant).toMatch(/mode=docker/);
    });

    it("logs each webhook URL when provided", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);

      tracker.setSchedulerInfo(
        makeSchedulerInfo({ webhookUrls: ["http://localhost:8080/gh", "http://localhost:8080/slack"] })
      );

      const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
      const listenCalls = calls.filter((c) => c.includes("listening:"));
      expect(listenCalls).toHaveLength(2);
    });

    it("logs the dashboard URL when provided", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);

      tracker.setSchedulerInfo(
        makeSchedulerInfo({ webhookUrls: [], dashboardUrl: "http://localhost:3000" })
      );

      const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
      const dashboardLog = calls.find((c) => c.includes("dashboard:"));
      expect(dashboardLog).toBeDefined();
      expect(dashboardLog).toMatch(/http:\/\/localhost:3000/);
    });

    it("does not re-log scheduler info if it hasn't changed", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);

      const info = makeSchedulerInfo({ webhookUrls: [], dashboardUrl: undefined });
      tracker.setSchedulerInfo(info);
      const count1 = consoleSpy.mock.calls.filter((c) =>
        (c[0] as string).includes("scheduler started")
      ).length;

      // Setting the same info again (no change)
      tracker.setSchedulerInfo(info);
      const count2 = consoleSpy.mock.calls.filter((c) =>
        (c[0] as string).includes("scheduler started")
      ).length;

      expect(count2).toBe(count1);
    });

    it("includes runtime in scheduler log when provided", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);

      tracker.setSchedulerInfo(
        makeSchedulerInfo({ runtime: "vps", webhookUrls: [], dashboardUrl: undefined })
      );

      const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
      const relevant = calls.find((c) => c.includes("runtime=vps"));
      expect(relevant).toBeDefined();
    });

    it("includes gateway port in scheduler log when provided", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);

      tracker.setSchedulerInfo(
        makeSchedulerInfo({ gatewayPort: 9999, webhookUrls: [], dashboardUrl: undefined })
      );

      const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
      const relevant = calls.find((c) => c.includes("gateway=:9999"));
      expect(relevant).toBeDefined();
    });

    it("includes project name in agent logs when set", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);

      tracker.setSchedulerInfo(
        makeSchedulerInfo({ projectName: "my-project", webhookUrls: [], dashboardUrl: undefined })
      );
      tracker.registerAgent("dev");
      tracker.setAgentState("dev", "building");

      const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
      const relevant = calls.find((c) => c.includes("my-project") && c.includes("dev"));
      expect(relevant).toBeDefined();
    });
  });

  describe("log lines", () => {
    it("logs new log lines from the tracker", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);
      tracker.registerAgent("dev");

      tracker.addLogLine("dev", "Hello from dev agent");

      const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
      const relevant = calls.find((c) => c.includes("dev") && c.includes("Hello from dev agent"));
      expect(relevant).toBeDefined();
    });

    it("does not log the same log line twice", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);
      tracker.registerAgent("dev");

      tracker.addLogLine("dev", "duplicate message");

      // Count occurrences
      const count1 = consoleSpy.mock.calls.filter((c) =>
        (c[0] as string).includes("duplicate message")
      ).length;

      // Emit an update without adding a new log line (e.g., by triggering another update)
      tracker.emit("update");

      const count2 = consoleSpy.mock.calls.filter((c) =>
        (c[0] as string).includes("duplicate message")
      ).length;

      expect(count2).toBe(count1);
    });
  });

  describe("agent state with token usage", () => {
    const sampleUsage: TokenUsage = {
      inputTokens: 50,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 100,
      cost: 0.005,
      turnCount: 1,
    };

    it("includes token usage in completion log when lastRunUsage is set (line 44 TRUE branch)", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);
      tracker.registerAgent("dev");

      // endRun with usage sets lastRunUsage and transitions agent to idle
      tracker.startRun("dev");
      tracker.endRun("dev", 3000, undefined, sampleUsage);

      const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
      // Should contain token count and cost in the completion log
      const relevant = calls.find((c) => c.includes("dev") && c.includes("tokens"));
      expect(relevant).toBeDefined();
      expect(relevant).toMatch(/100 tokens/);
      expect(relevant).toMatch(/\$0\.0050/);
    });

    it("stateKey reflects lastRunUsage when present (covers stateKey TRUE branch)", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);
      tracker.registerAgent("agent-usage");

      // First run with usage — triggers stateKey with non-null lastRunUsage
      tracker.startRun("agent-usage");
      tracker.endRun("agent-usage", 2000, undefined, sampleUsage);

      // Second run with different usage — stateKey changes, triggers a new log
      const usage2: TokenUsage = { ...sampleUsage, totalTokens: 200, cost: 0.01 };
      tracker.startRun("agent-usage");
      tracker.endRun("agent-usage", 4000, undefined, usage2);

      const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
      // Both runs should produce "completed" logs
      const completedCalls = calls.filter((c) => c.includes("agent-usage") && c.includes("completed"));
      expect(completedCalls.length).toBeGreaterThanOrEqual(1);
      // The second run should have logged 200 tokens
      const secondRun = completedCalls.find((c) => c.includes("200 tokens"));
      expect(secondRun).toBeDefined();
    });
  });

  describe("scheduler info branch coverage", () => {
    it("omits runtime from log when scheduler info has no runtime", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);

      // runtime is undefined — covers line 78 FALSE branch
      tracker.setSchedulerInfo(
        makeSchedulerInfo({ runtime: undefined, webhookUrls: [], dashboardUrl: undefined })
      );

      const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
      const schedulerLog = calls.find((c) => c.includes("scheduler started"));
      expect(schedulerLog).toBeDefined();
      // Should NOT contain "runtime="
      expect(schedulerLog).not.toMatch(/runtime=/);
    });

    it("omits gateway port from log when gatewayPort is null", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);

      // gatewayPort is null — covers line 79 FALSE branch
      tracker.setSchedulerInfo(
        makeSchedulerInfo({ gatewayPort: null, webhookUrls: [], dashboardUrl: undefined })
      );

      const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
      const schedulerLog = calls.find((c) => c.includes("scheduler started"));
      expect(schedulerLog).toBeDefined();
      // Should NOT contain "gateway="
      expect(schedulerLog).not.toMatch(/gateway=/);
    });

    it("omits webhooks=active from log when webhooksActive is false", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);

      // webhooksActive is false — covers line 81 FALSE branch
      tracker.setSchedulerInfo(
        makeSchedulerInfo({ webhooksActive: false, webhookUrls: [], dashboardUrl: undefined })
      );

      const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
      const schedulerLog = calls.find((c) => c.includes("scheduler started"));
      expect(schedulerLog).toBeDefined();
      // Should NOT contain "webhooks=active"
      expect(schedulerLog).not.toMatch(/webhooks=active/);
    });

    it("does not log scheduler info when schedulerInfo is null (onSchedulerInfo early return)", () => {
      const tracker = new StatusTracker();
      attachPlainLogger(tracker);

      // Emit an update without setting scheduler info — info is null, so early return
      tracker.emit("update");

      const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
      const schedulerLog = calls.find((c) => c.includes("scheduler started"));
      expect(schedulerLog).toBeUndefined();
    });
  });
});
