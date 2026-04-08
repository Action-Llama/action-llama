/**
 * Integration tests: events/cron-setup.ts setupEnableDisableHandlers() — no Docker required.
 *
 * setupEnableDisableHandlers() listens to StatusTracker "agent-enabled" and
 * "agent-disabled" events and pauses/resumes the corresponding Cron job.
 *
 * Covers:
 *   - cron-setup.ts: setupEnableDisableHandlers() — "agent-enabled" resumes cron job
 *   - cron-setup.ts: setupEnableDisableHandlers() — "agent-disabled" pauses cron job
 *   - cron-setup.ts: setupEnableDisableHandlers() — unknown agent name is a no-op (no job found)
 *   - cron-setup.ts: setupEnableDisableHandlers() — logs info on enable/disable
 */

import { describe, it, expect, vi } from "vitest";
import {
  StatusTracker,
} from "@action-llama/action-llama/internals/status-tracker";

const {
  setupEnableDisableHandlers,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/events/cron-setup.js"
);

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
}

describe("integration: cron-setup.ts setupEnableDisableHandlers() (no Docker required)", { timeout: 10_000 }, () => {
  it("resumes cron job when agent-enabled event fires", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("my-agent", 1);

    const mockJob = { resume: vi.fn(), pause: vi.fn(), nextRun: vi.fn(() => new Date()) };
    const agentCronJobs = new Map([["my-agent", mockJob]]);
    const logger = makeLogger();

    setupEnableDisableHandlers({ statusTracker: tracker, agentCronJobs: agentCronJobs as any, logger });

    // Disable then re-enable to trigger events
    tracker.disableAgent("my-agent");
    tracker.enableAgent("my-agent");

    expect(mockJob.resume).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ agent: "my-agent" }), expect.stringContaining("enabled"));
  });

  it("pauses cron job when agent-disabled event fires", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("my-agent", 1);

    const mockJob = { resume: vi.fn(), pause: vi.fn(), nextRun: vi.fn(() => new Date()) };
    const agentCronJobs = new Map([["my-agent", mockJob]]);
    const logger = makeLogger();

    setupEnableDisableHandlers({ statusTracker: tracker, agentCronJobs: agentCronJobs as any, logger });

    tracker.disableAgent("my-agent");

    expect(mockJob.pause).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ agent: "my-agent" }), expect.stringContaining("disabled"));
  });

  it("is a no-op when agent has no cron job (no job in map)", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("no-cron-agent", 1);

    const agentCronJobs = new Map<string, any>(); // Empty map
    const logger = makeLogger();

    setupEnableDisableHandlers({ statusTracker: tracker, agentCronJobs, logger });

    // Should not throw when enabling/disabling an agent with no cron job
    expect(() => {
      tracker.disableAgent("no-cron-agent");
      tracker.enableAgent("no-cron-agent");
    }).not.toThrow();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("setNextRunAt is called with next run date on enable", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("timed-agent", 1);

    const nextRunDate = new Date(Date.now() + 60000);
    const mockJob = { resume: vi.fn(), pause: vi.fn(), nextRun: vi.fn(() => nextRunDate) };
    const agentCronJobs = new Map([["timed-agent", mockJob]]);
    const logger = makeLogger();

    const setNextRunAtSpy = vi.spyOn(tracker, "setNextRunAt");
    setupEnableDisableHandlers({ statusTracker: tracker, agentCronJobs: agentCronJobs as any, logger });

    tracker.disableAgent("timed-agent");
    tracker.enableAgent("timed-agent");

    expect(setNextRunAtSpy).toHaveBeenCalledWith("timed-agent", nextRunDate);
  });

  it("setNextRunAt is called with null on disable", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("disable-agent", 1);

    const mockJob = { resume: vi.fn(), pause: vi.fn(), nextRun: vi.fn(() => new Date()) };
    const agentCronJobs = new Map([["disable-agent", mockJob]]);
    const logger = makeLogger();

    const setNextRunAtSpy = vi.spyOn(tracker, "setNextRunAt");
    setupEnableDisableHandlers({ statusTracker: tracker, agentCronJobs: agentCronJobs as any, logger });

    tracker.disableAgent("disable-agent");

    expect(setNextRunAtSpy).toHaveBeenCalledWith("disable-agent", null);
  });
});
