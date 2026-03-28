import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentStatusReporter } from "../../src/agents/status-reporter.js";
import { StatusTracker } from "../../src/tui/status-tracker.js";

describe("AgentStatusReporter", () => {
  describe("without a StatusTracker (no-op mode)", () => {
    let reporter: AgentStatusReporter;

    beforeEach(() => {
      reporter = new AgentStatusReporter();
    });

    it("startRun does not throw", () => {
      expect(() => reporter.startRun("dev", "schedule")).not.toThrow();
    });

    it("reportStatus does not throw", () => {
      expect(() => reporter.reportStatus("dev", "working on issue")).not.toThrow();
    });

    it("reportError does not throw", () => {
      expect(() => reporter.reportError("dev", "container crashed")).not.toThrow();
    });

    it("addLogLine does not throw", () => {
      expect(() => reporter.addLogLine("dev", "some log message")).not.toThrow();
    });

    it("endRun does not throw", () => {
      expect(() => reporter.endRun("dev", 10000)).not.toThrow();
    });

    it("isAgentEnabled returns true when no tracker is present", () => {
      expect(reporter.isAgentEnabled("dev")).toBe(true);
    });

    it("setNextRunAt does not throw", () => {
      expect(() => reporter.setNextRunAt("dev", new Date())).not.toThrow();
    });
  });

  describe("with a StatusTracker", () => {
    let tracker: StatusTracker;
    let reporter: AgentStatusReporter;

    beforeEach(() => {
      tracker = new StatusTracker();
      tracker.registerAgent("dev");
      reporter = new AgentStatusReporter(tracker);
    });

    it("startRun transitions agent to running state", () => {
      reporter.startRun("dev", "schedule");
      const agent = tracker.getAllAgents().find((a) => a.name === "dev")!;
      expect(agent.state).toBe("running");
    });

    it("startRun records the run reason", () => {
      reporter.startRun("dev", "webhook");
      const agent = tracker.getAllAgents().find((a) => a.name === "dev")!;
      expect(agent.runReason).toBe("webhook");
    });

    it("reportStatus updates agent status text", () => {
      reporter.reportStatus("dev", "processing PR #42");
      const agent = tracker.getAllAgents().find((a) => a.name === "dev")!;
      expect(agent.statusText).toBe("processing PR #42");
    });

    it("reportError sets agent error and adds a log line", () => {
      reporter.reportError("dev", "out of memory");
      const agent = tracker.getAllAgents().find((a) => a.name === "dev")!;
      expect(agent.lastError).toBe("out of memory");

      const logs = tracker.getRecentLogs(5);
      expect(logs.some((l) => l.message.includes("out of memory"))).toBe(true);
    });

    it("addLogLine appends a log entry", () => {
      reporter.addLogLine("dev", "starting analysis");
      const logs = tracker.getRecentLogs(5);
      expect(logs.some((l) => l.message === "starting analysis" && l.agent === "dev")).toBe(true);
    });

    it("endRun transitions agent back to idle after success", () => {
      tracker.startRun("dev");
      reporter.endRun("dev", 5000);
      const agent = tracker.getAllAgents().find((a) => a.name === "dev")!;
      expect(agent.state).toBe("idle");
      expect(agent.lastRunDuration).toBe(5000);
    });

    it("endRun transitions agent to error state on failure", () => {
      tracker.startRun("dev");
      reporter.endRun("dev", 3000, "process exited with code 1");
      const agent = tracker.getAllAgents().find((a) => a.name === "dev")!;
      expect(agent.state).toBe("error");
      expect(agent.lastError).toBe("process exited with code 1");
    });

    it("isAgentEnabled returns true when agent is enabled", () => {
      expect(reporter.isAgentEnabled("dev")).toBe(true);
    });

    it("isAgentEnabled returns false when agent is disabled", () => {
      tracker.disableAgent("dev");
      expect(reporter.isAgentEnabled("dev")).toBe(false);
    });

    it("setNextRunAt updates the next run time", () => {
      const nextRun = new Date(Date.now() + 60_000);
      reporter.setNextRunAt("dev", nextRun);
      const agent = tracker.getAllAgents().find((a) => a.name === "dev")!;
      expect(agent.nextRunAt?.getTime()).toBe(nextRun.getTime());
    });

    it("setNextRunAt with null clears the next run time", () => {
      reporter.setNextRunAt("dev", new Date());
      reporter.setNextRunAt("dev", null);
      const agent = tracker.getAllAgents().find((a) => a.name === "dev")!;
      expect(agent.nextRunAt).toBeNull();
    });
  });
});
