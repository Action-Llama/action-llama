/**
 * Integration tests: events/cron-setup.ts setupCronJobs() — no Docker required.
 *
 * setupCronJobs() creates croner Cron job instances for all active agent configs
 * that have a schedule. It also builds the webhook URL list when anyWebhooks=true.
 *
 * Covers:
 *   - cron-setup.ts: setupCronJobs() — empty active list returns empty arrays
 *   - cron-setup.ts: setupCronJobs() — agent without schedule is skipped
 *   - cron-setup.ts: setupCronJobs() — agent with schedule creates cron job
 *   - cron-setup.ts: setupCronJobs() — multiple agents, multiple cron jobs
 *   - cron-setup.ts: setupCronJobs() — agentCronJobs map populated correctly
 *   - cron-setup.ts: setupCronJobs() — logger.info called for each scheduled agent
 *   - cron-setup.ts: setupCronJobs() — anyWebhooks=false → empty webhookUrls
 *   - cron-setup.ts: setupCronJobs() — anyWebhooks=true + no port → empty webhookUrls
 *   - cron-setup.ts: setupCronJobs() — anyWebhooks=true + port → webhook URLs built
 *   - cron-setup.ts: setupCronJobs() — multiple webhook providers → multiple URLs
 *   - cron-setup.ts: setupCronJobs() — cron callback: paused scheduler skips run
 *   - cron-setup.ts: setupCronJobs() — cron callback: disabled agent skips run
 *   - cron-setup.ts: setupCronJobs() — cron callback: active agent fires onScheduledRun
 *   - cron-setup.ts: setupCronJobs() — statusTracker.setNextRunAt called when nextRun present
 */

import { describe, it, expect, vi } from "vitest";
import { StatusTracker } from "@action-llama/action-llama/internals/status-tracker";
import type { AgentConfig } from "@action-llama/action-llama/internals/config";

const {
  setupCronJobs,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/events/cron-setup.js"
);

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
}

/** Minimal AgentConfig for testing — only fields used by setupCronJobs are set. */
function makeAgentConfig(overrides: Partial<AgentConfig> & { name: string }): AgentConfig {
  return {
    name: overrides.name,
    credentials: [],
    models: [],
    params: {},
    ...overrides,
  } as AgentConfig;
}

const BASE_GLOBAL_CONFIG = {};

describe("integration: events/cron-setup.ts setupCronJobs() (no Docker required)", { timeout: 15_000 }, () => {

  it("returns empty arrays when activeAgentConfigs is empty", () => {
    const result = setupCronJobs({
      activeAgentConfigs: [],
      webhookSources: {},
      globalConfig: BASE_GLOBAL_CONFIG,
      agentConfigs: [],
      onScheduledRun: vi.fn(),
      logger: makeLogger(),
      timezone: "UTC",
      anyWebhooks: false,
    });

    expect(result.cronJobs).toHaveLength(0);
    expect(result.agentCronJobs.size).toBe(0);
    expect(result.webhookUrls).toHaveLength(0);

    // Clean up (no jobs to stop)
  });

  it("agent without schedule is skipped — no cron job created", () => {
    const agent = makeAgentConfig({ name: "no-schedule-agent" }); // schedule undefined
    const result = setupCronJobs({
      activeAgentConfigs: [agent],
      webhookSources: {},
      globalConfig: BASE_GLOBAL_CONFIG,
      agentConfigs: [agent],
      onScheduledRun: vi.fn(),
      logger: makeLogger(),
      timezone: "UTC",
      anyWebhooks: false,
    });

    expect(result.cronJobs).toHaveLength(0);
    expect(result.agentCronJobs.size).toBe(0);
  });

  it("agent with schedule creates exactly one cron job", () => {
    const agent = makeAgentConfig({ name: "scheduled-agent", schedule: "0 * * * *" });
    const result = setupCronJobs({
      activeAgentConfigs: [agent],
      webhookSources: {},
      globalConfig: BASE_GLOBAL_CONFIG,
      agentConfigs: [agent],
      onScheduledRun: vi.fn(),
      logger: makeLogger(),
      timezone: "UTC",
      anyWebhooks: false,
    });

    try {
      expect(result.cronJobs).toHaveLength(1);
      expect(result.agentCronJobs.size).toBe(1);
      expect(result.agentCronJobs.has("scheduled-agent")).toBe(true);
    } finally {
      result.cronJobs.forEach((j: any) => j.stop());
    }
  });

  it("multiple agents with schedules create multiple cron jobs", () => {
    const agentA = makeAgentConfig({ name: "agent-a", schedule: "0 * * * *" });
    const agentB = makeAgentConfig({ name: "agent-b", schedule: "30 * * * *" });
    const agentC = makeAgentConfig({ name: "agent-c" }); // no schedule
    const result = setupCronJobs({
      activeAgentConfigs: [agentA, agentB, agentC],
      webhookSources: {},
      globalConfig: BASE_GLOBAL_CONFIG,
      agentConfigs: [agentA, agentB, agentC],
      onScheduledRun: vi.fn(),
      logger: makeLogger(),
      timezone: "UTC",
      anyWebhooks: false,
    });

    try {
      expect(result.cronJobs).toHaveLength(2);
      expect(result.agentCronJobs.size).toBe(2);
      expect(result.agentCronJobs.has("agent-a")).toBe(true);
      expect(result.agentCronJobs.has("agent-b")).toBe(true);
      expect(result.agentCronJobs.has("agent-c")).toBe(false);
    } finally {
      result.cronJobs.forEach((j: any) => j.stop());
    }
  });

  it("logger.info called for each scheduled agent with name and schedule", () => {
    const agent = makeAgentConfig({ name: "logged-agent", schedule: "0 * * * *" });
    const logger = makeLogger();
    const result = setupCronJobs({
      activeAgentConfigs: [agent],
      webhookSources: {},
      globalConfig: BASE_GLOBAL_CONFIG,
      agentConfigs: [agent],
      onScheduledRun: vi.fn(),
      logger,
      timezone: "UTC",
      anyWebhooks: false,
    });

    try {
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("logged-agent")
      );
    } finally {
      result.cronJobs.forEach((j: any) => j.stop());
    }
  });

  it("anyWebhooks=false → empty webhookUrls even with gatewayPort", () => {
    const agent = makeAgentConfig({ name: "webhook-agent" });
    const result = setupCronJobs({
      activeAgentConfigs: [agent],
      webhookSources: {},
      globalConfig: BASE_GLOBAL_CONFIG,
      agentConfigs: [agent],
      onScheduledRun: vi.fn(),
      logger: makeLogger(),
      timezone: "UTC",
      anyWebhooks: false,
      gatewayPort: 8080,
    });

    expect(result.webhookUrls).toHaveLength(0);
  });

  it("anyWebhooks=true + no gatewayPort → empty webhookUrls", () => {
    const agent = makeAgentConfig({ name: "webhook-agent" });
    const result = setupCronJobs({
      activeAgentConfigs: [agent],
      webhookSources: { "gh": { type: "github" } } as any,
      globalConfig: BASE_GLOBAL_CONFIG,
      agentConfigs: [agent],
      onScheduledRun: vi.fn(),
      logger: makeLogger(),
      timezone: "UTC",
      anyWebhooks: true,
      // gatewayPort not set
    });

    expect(result.webhookUrls).toHaveLength(0);
  });

  it("anyWebhooks=true + gatewayPort + agent with webhook → URL generated", () => {
    const agent = makeAgentConfig({
      name: "webhook-agent",
      webhooks: [{ source: "gh-source", events: ["push"] }] as any,
    });
    const result = setupCronJobs({
      activeAgentConfigs: [agent],
      webhookSources: { "gh-source": { type: "github" } } as any,
      globalConfig: BASE_GLOBAL_CONFIG,
      agentConfigs: [agent],
      onScheduledRun: vi.fn(),
      logger: makeLogger(),
      timezone: "UTC",
      anyWebhooks: true,
      gatewayPort: 3456,
    });

    expect(result.webhookUrls).toHaveLength(1);
    expect(result.webhookUrls[0]).toBe("http://localhost:3456/webhooks/github");
  });

  it("multiple webhook provider types → multiple URLs", () => {
    const agentA = makeAgentConfig({
      name: "agent-a",
      webhooks: [{ source: "gh-src", events: ["push"] }] as any,
    });
    const agentB = makeAgentConfig({
      name: "agent-b",
      webhooks: [{ source: "slack-src", events: ["message"] }] as any,
    });
    const result = setupCronJobs({
      activeAgentConfigs: [],
      webhookSources: {
        "gh-src": { type: "github" },
        "slack-src": { type: "slack" },
      } as any,
      globalConfig: BASE_GLOBAL_CONFIG,
      agentConfigs: [agentA, agentB],
      onScheduledRun: vi.fn(),
      logger: makeLogger(),
      timezone: "UTC",
      anyWebhooks: true,
      gatewayPort: 5000,
    });

    expect(result.webhookUrls).toHaveLength(2);
    expect(result.webhookUrls).toContain("http://localhost:5000/webhooks/github");
    expect(result.webhookUrls).toContain("http://localhost:5000/webhooks/slack");
  });

  it("duplicate webhook provider types → deduplicated URLs (Set used)", () => {
    const agentA = makeAgentConfig({
      name: "agent-a",
      webhooks: [{ source: "gh-src-1", events: ["push"] }] as any,
    });
    const agentB = makeAgentConfig({
      name: "agent-b",
      webhooks: [{ source: "gh-src-2", events: ["pull_request"] }] as any,
    });
    const result = setupCronJobs({
      activeAgentConfigs: [],
      webhookSources: {
        "gh-src-1": { type: "github" },
        "gh-src-2": { type: "github" },
      } as any,
      globalConfig: BASE_GLOBAL_CONFIG,
      agentConfigs: [agentA, agentB],
      onScheduledRun: vi.fn(),
      logger: makeLogger(),
      timezone: "UTC",
      anyWebhooks: true,
      gatewayPort: 5000,
    });

    // Both agents use "github" type — should deduplicate to 1 URL
    expect(result.webhookUrls).toHaveLength(1);
    expect(result.webhookUrls[0]).toBe("http://localhost:5000/webhooks/github");
  });

  it("cron callback fires onScheduledRun when active (trigger method)", async () => {
    const agent = makeAgentConfig({ name: "fire-agent", schedule: "0 * * * *" });
    const onScheduledRun = vi.fn().mockResolvedValue(undefined);
    const result = setupCronJobs({
      activeAgentConfigs: [agent],
      webhookSources: {},
      globalConfig: BASE_GLOBAL_CONFIG,
      agentConfigs: [agent],
      onScheduledRun,
      logger: makeLogger(),
      timezone: "UTC",
      anyWebhooks: false,
    });

    try {
      const job = result.agentCronJobs.get("fire-agent")!;
      // Trigger the job immediately (croner's trigger() fires the callback now)
      await (job as any).trigger();
      // Wait briefly for async callback to resolve
      await new Promise((r) => setTimeout(r, 50));
      expect(onScheduledRun).toHaveBeenCalledTimes(1);
      expect(onScheduledRun).toHaveBeenCalledWith(agent);
    } finally {
      result.cronJobs.forEach((j: any) => j.stop());
    }
  });

  it("cron callback skips run when scheduler is paused", async () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("pause-agent", 1);
    // Must initialize schedulerInfo before setPaused works
    tracker.setSchedulerInfo({
      mode: "docker",
      gatewayPort: null,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
      paused: false,
    });

    const agent = makeAgentConfig({ name: "pause-agent", schedule: "0 * * * *" });
    const onScheduledRun = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();
    const result = setupCronJobs({
      activeAgentConfigs: [agent],
      webhookSources: {},
      globalConfig: BASE_GLOBAL_CONFIG,
      agentConfigs: [agent],
      onScheduledRun,
      statusTracker: tracker,
      logger,
      timezone: "UTC",
      anyWebhooks: false,
    });

    try {
      tracker.setPaused(true);
      const job = result.agentCronJobs.get("pause-agent")!;
      await (job as any).trigger();
      await new Promise((r) => setTimeout(r, 50));

      expect(onScheduledRun).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ agent: "pause-agent" }),
        expect.stringContaining("paused")
      );
    } finally {
      result.cronJobs.forEach((j: any) => j.stop());
    }
  });

  it("cron callback skips run when agent is disabled", async () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("disabled-agent", 1);
    tracker.disableAgent("disabled-agent");

    const agent = makeAgentConfig({ name: "disabled-agent", schedule: "0 * * * *" });
    const onScheduledRun = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();
    const result = setupCronJobs({
      activeAgentConfigs: [agent],
      webhookSources: {},
      globalConfig: BASE_GLOBAL_CONFIG,
      agentConfigs: [agent],
      onScheduledRun,
      statusTracker: tracker,
      logger,
      timezone: "UTC",
      anyWebhooks: false,
    });

    try {
      const job = result.agentCronJobs.get("disabled-agent")!;
      await (job as any).trigger();
      await new Promise((r) => setTimeout(r, 50));

      expect(onScheduledRun).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ agent: "disabled-agent" }),
        expect.stringContaining("disabled")
      );
    } finally {
      result.cronJobs.forEach((j: any) => j.stop());
    }
  });

  it("statusTracker.setNextRunAt called with next run date", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("next-run-agent", 1);
    const setNextRunAtSpy = vi.spyOn(tracker, "setNextRunAt");

    const agent = makeAgentConfig({ name: "next-run-agent", schedule: "0 * * * *" });
    const result = setupCronJobs({
      activeAgentConfigs: [agent],
      webhookSources: {},
      globalConfig: BASE_GLOBAL_CONFIG,
      agentConfigs: [agent],
      onScheduledRun: vi.fn(),
      statusTracker: tracker,
      logger: makeLogger(),
      timezone: "UTC",
      anyWebhooks: false,
    });

    try {
      expect(setNextRunAtSpy).toHaveBeenCalledTimes(1);
      const [calledName, calledDate] = setNextRunAtSpy.mock.calls[0];
      expect(calledName).toBe("next-run-agent");
      expect(calledDate).toBeInstanceOf(Date);
    } finally {
      result.cronJobs.forEach((j: any) => j.stop());
    }
  });

  it("webhook URL not added when agent's webhook source has no type in webhookSources", () => {
    const agent = makeAgentConfig({
      name: "unknown-src-agent",
      webhooks: [{ source: "unknown-source", events: ["push"] }] as any,
    });
    const result = setupCronJobs({
      activeAgentConfigs: [],
      webhookSources: {}, // unknown-source has no entry
      globalConfig: BASE_GLOBAL_CONFIG,
      agentConfigs: [agent],
      onScheduledRun: vi.fn(),
      logger: makeLogger(),
      timezone: "UTC",
      anyWebhooks: true,
      gatewayPort: 8080,
    });

    // filter(Boolean) removes undefined → empty set → no URLs
    expect(result.webhookUrls).toHaveLength(0);
  });
});
