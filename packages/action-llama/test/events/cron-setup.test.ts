import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupCronJobs, setupEnableDisableHandlers } from "../../src/events/cron-setup.js";
import type { AgentConfig } from "../../src/shared/config.js";
import { EventEmitter } from "events";

function makeAgentConfig(name: string, overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name,
    credentials: [],
    models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
    schedule: "0 * * * *",
    scale: 1,
    ...overrides,
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;
}

function makeStatusTracker(overrides: Partial<{
  isPaused: () => boolean;
  isAgentEnabled: (name: string) => boolean;
  setNextRunAt: (name: string, date: Date | null) => void;
  on: (event: string, handler: any) => void;
  emit: (event: string, ...args: any[]) => void;
}> = {}) {
  const emitter = new EventEmitter();
  return {
    isPaused: vi.fn().mockReturnValue(false),
    isAgentEnabled: vi.fn().mockReturnValue(true),
    setNextRunAt: vi.fn(),
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
    ...overrides,
  } as any;
}

describe("setupCronJobs", () => {
  it("creates no cron jobs when no agents have schedules", () => {
    const result = setupCronJobs({
      activeAgentConfigs: [makeAgentConfig("no-schedule", { schedule: undefined })],
      webhookSources: {},
      globalConfig: {} as any,
      agentConfigs: [],
      onScheduledRun: vi.fn(),
      logger: makeLogger(),
      timezone: "UTC",
      anyWebhooks: false,
    });

    expect(result.cronJobs).toHaveLength(0);
    expect(result.agentCronJobs.size).toBe(0);
  });

  it("creates cron jobs for agents with schedules", () => {
    const result = setupCronJobs({
      activeAgentConfigs: [makeAgentConfig("my-agent", { schedule: "0 * * * *" })],
      webhookSources: {},
      globalConfig: {} as any,
      agentConfigs: [],
      onScheduledRun: vi.fn(),
      logger: makeLogger(),
      timezone: "UTC",
      anyWebhooks: false,
    });

    expect(result.cronJobs).toHaveLength(1);
    expect(result.agentCronJobs.has("my-agent")).toBe(true);

    // Cleanup
    result.cronJobs.forEach((job) => job.stop());
  });

  it("creates cron jobs for multiple agents", () => {
    const agents = [
      makeAgentConfig("agent-a", { schedule: "0 * * * *" }),
      makeAgentConfig("agent-b", { schedule: "*/30 * * * *" }),
    ];
    const result = setupCronJobs({
      activeAgentConfigs: agents,
      webhookSources: {},
      globalConfig: {} as any,
      agentConfigs: agents,
      onScheduledRun: vi.fn(),
      logger: makeLogger(),
      timezone: "UTC",
      anyWebhooks: false,
    });

    expect(result.cronJobs).toHaveLength(2);
    expect(result.agentCronJobs.has("agent-a")).toBe(true);
    expect(result.agentCronJobs.has("agent-b")).toBe(true);

    result.cronJobs.forEach((job) => job.stop());
  });

  it("skips scheduled run when scheduler is paused", async () => {
    const statusTracker = makeStatusTracker({ isPaused: vi.fn().mockReturnValue(true) });
    const onScheduledRun = vi.fn();
    const logger = makeLogger();

    const result = setupCronJobs({
      activeAgentConfigs: [makeAgentConfig("my-agent", { schedule: "0 * * * *" })],
      webhookSources: {},
      globalConfig: {} as any,
      agentConfigs: [],
      onScheduledRun,
      statusTracker,
      logger,
      timezone: "UTC",
      anyWebhooks: false,
    });

    // Manually invoke the job's callback to simulate schedule fire
    const job = result.agentCronJobs.get("my-agent")!;
    await (job as any).fn?.();

    expect(onScheduledRun).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      { agent: "my-agent" },
      "scheduler paused, skipping scheduled run"
    );

    result.cronJobs.forEach((j) => j.stop());
  });

  it("skips scheduled run when agent is disabled", async () => {
    const statusTracker = makeStatusTracker({
      isPaused: vi.fn().mockReturnValue(false),
      isAgentEnabled: vi.fn().mockReturnValue(false),
    });
    const onScheduledRun = vi.fn();
    const logger = makeLogger();

    const result = setupCronJobs({
      activeAgentConfigs: [makeAgentConfig("my-agent", { schedule: "0 * * * *" })],
      webhookSources: {},
      globalConfig: {} as any,
      agentConfigs: [],
      onScheduledRun,
      statusTracker,
      logger,
      timezone: "UTC",
      anyWebhooks: false,
    });

    const job = result.agentCronJobs.get("my-agent")!;
    await (job as any).fn?.();

    expect(onScheduledRun).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      { agent: "my-agent" },
      "agent is disabled, skipping scheduled run"
    );

    result.cronJobs.forEach((j) => j.stop());
  });

  it("calls onScheduledRun when agent is enabled and scheduler is not paused", async () => {
    const statusTracker = makeStatusTracker();
    const onScheduledRun = vi.fn().mockResolvedValue(undefined);

    const result = setupCronJobs({
      activeAgentConfigs: [makeAgentConfig("my-agent", { schedule: "0 * * * *" })],
      webhookSources: {},
      globalConfig: {} as any,
      agentConfigs: [],
      onScheduledRun,
      statusTracker,
      logger: makeLogger(),
      timezone: "UTC",
      anyWebhooks: false,
    });

    const job = result.agentCronJobs.get("my-agent")!;
    await (job as any).fn?.();

    expect(onScheduledRun).toHaveBeenCalledOnce();

    result.cronJobs.forEach((j) => j.stop());
  });

  it("generates webhook URLs when anyWebhooks=true and gatewayPort is set", () => {
    const agents = [
      makeAgentConfig("my-agent", {
        schedule: "0 * * * *",
        webhooks: [{ source: "github" }],
      }),
    ];
    const result = setupCronJobs({
      activeAgentConfigs: agents,
      webhookSources: { github: { type: "github" } as any },
      globalConfig: {} as any,
      agentConfigs: agents,
      onScheduledRun: vi.fn(),
      logger: makeLogger(),
      timezone: "UTC",
      anyWebhooks: true,
      gatewayPort: 8080,
    });

    expect(result.webhookUrls).toHaveLength(1);
    expect(result.webhookUrls[0]).toContain("localhost:8080/webhooks/github");

    result.cronJobs.forEach((j) => j.stop());
  });

  it("returns empty webhookUrls when anyWebhooks=false", () => {
    const result = setupCronJobs({
      activeAgentConfigs: [],
      webhookSources: {},
      globalConfig: {} as any,
      agentConfigs: [],
      onScheduledRun: vi.fn(),
      logger: makeLogger(),
      timezone: "UTC",
      anyWebhooks: false,
      gatewayPort: 8080,
    });

    expect(result.webhookUrls).toHaveLength(0);
  });
});

describe("setupEnableDisableHandlers", () => {
  it("resumes cron job when agent-enabled event fires", () => {
    const resumeSpy = vi.fn();
    const nextRunSpy = vi.fn().mockReturnValue(new Date(Date.now() + 3600_000));
    const mockJob = { resume: resumeSpy, pause: vi.fn(), nextRun: nextRunSpy };
    const agentCronJobs = new Map([["my-agent", mockJob as any]]);
    const statusTracker = makeStatusTracker();
    const logger = makeLogger();

    setupEnableDisableHandlers({ statusTracker, agentCronJobs, logger });

    statusTracker.emit("agent-enabled", "my-agent");

    expect(resumeSpy).toHaveBeenCalledOnce();
    expect(statusTracker.setNextRunAt).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      { agent: "my-agent" },
      "agent enabled, cron job resumed"
    );
  });

  it("pauses cron job when agent-disabled event fires", () => {
    const pauseSpy = vi.fn();
    const mockJob = { resume: vi.fn(), pause: pauseSpy, nextRun: vi.fn() };
    const agentCronJobs = new Map([["my-agent", mockJob as any]]);
    const statusTracker = makeStatusTracker();
    const logger = makeLogger();

    setupEnableDisableHandlers({ statusTracker, agentCronJobs, logger });

    statusTracker.emit("agent-disabled", "my-agent");

    expect(pauseSpy).toHaveBeenCalledOnce();
    expect(statusTracker.setNextRunAt).toHaveBeenCalledWith("my-agent", null);
    expect(logger.info).toHaveBeenCalledWith(
      { agent: "my-agent" },
      "agent disabled, cron job paused"
    );
  });

  it("does nothing on agent-enabled if agent has no cron job", () => {
    const statusTracker = makeStatusTracker();
    const logger = makeLogger();
    const agentCronJobs = new Map<string, any>();

    setupEnableDisableHandlers({ statusTracker, agentCronJobs, logger });

    // Should not throw
    statusTracker.emit("agent-enabled", "unknown-agent");
    expect(statusTracker.setNextRunAt).not.toHaveBeenCalled();
  });

  it("does nothing on agent-disabled if agent has no cron job", () => {
    const statusTracker = makeStatusTracker();
    const logger = makeLogger();
    const agentCronJobs = new Map<string, any>();

    setupEnableDisableHandlers({ statusTracker, agentCronJobs, logger });

    // Should not throw
    statusTracker.emit("agent-disabled", "unknown-agent");
    expect(statusTracker.setNextRunAt).not.toHaveBeenCalled();
  });
});
