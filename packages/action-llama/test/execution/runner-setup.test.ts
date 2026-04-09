import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the transport-runner
vi.mock("../../src/agents/transport-runner.js", () => ({
  TransportAgentRunner: vi.fn().mockImplementation(function (this: any) {
    this.instanceId = "mock-runner";
    this.isRunning = false;
    this.run = vi.fn().mockResolvedValue({ result: "completed", triggers: [] });
  }),
}));

// Mock model fallback
vi.mock("../../src/agents/model-fallback.js", () => ({
  ModelCircuitBreaker: vi.fn().mockImplementation(function (this: any) {
    this.recordSuccess = vi.fn();
    this.recordFailure = vi.fn();
  }),
}));

import { createRunnerPools } from "../../src/execution/runner-setup.js";
import { StatusTracker } from "../../src/tui/status-tracker.js";
import type { GlobalConfig, AgentConfig } from "../../src/shared/config.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;
}

function makeGlobalConfig(overrides: Partial<GlobalConfig> = {}): GlobalConfig {
  return {
    name: "test-project",
    models: {},
    ...overrides,
  } as GlobalConfig;
}

function makeAgentConfig(name: string, scale?: number): AgentConfig {
  return {
    name,
    scale,
    credentials: [],
    models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium" }],
  } as AgentConfig;
}

describe("createRunnerPools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns actualScales matching configured scale when no project cap", async () => {
    const agentConfigs = [
      makeAgentConfig("agent-a", 2),
      makeAgentConfig("agent-b", 3),
    ];

    const { actualScales } = await createRunnerPools({
      globalConfig: makeGlobalConfig(),
      agentConfigs,
      baseImage: "base:latest",
      mkLogger: () => makeLogger() as any,
      projectPath: "/tmp",
      logger: makeLogger(),
    });

    expect(actualScales["agent-a"]).toBe(2);
    expect(actualScales["agent-b"]).toBe(3);
  });

  it("returns actualScales after project-wide scale cap is applied", async () => {
    const agentConfigs = [
      makeAgentConfig("agent-a", 4),
      makeAgentConfig("agent-b", 4),
    ];

    const { actualScales, runnerPools } = await createRunnerPools({
      globalConfig: makeGlobalConfig({ scale: 5 }),
      agentConfigs,
      baseImage: "base:latest",
      mkLogger: () => makeLogger() as any,
      projectPath: "/tmp",
      logger: makeLogger(),
    });

    expect(actualScales["agent-a"]).toBe(4);
    expect(actualScales["agent-b"]).toBe(1);

    expect(runnerPools["agent-a"].size).toBe(4);
    expect(runnerPools["agent-b"].size).toBe(1);
  });

  it("warns when total requested scale exceeds project cap", async () => {
    const logger = makeLogger();
    const agentConfigs = [
      makeAgentConfig("agent-a", 3),
      makeAgentConfig("agent-b", 4),
    ];

    await createRunnerPools({
      globalConfig: makeGlobalConfig({ scale: 5, defaultAgentScale: 2 }),
      agentConfigs,
      baseImage: "base:latest",
      mkLogger: () => makeLogger() as any,
      projectPath: "/tmp",
      logger,
    });

    expect(logger.warn).toHaveBeenCalled();
    const warnCall = logger.warn.mock.calls[0];
    expect(warnCall[0]).toMatchObject({ totalRequested: 7, projectScale: 5 });
  });

  it("caps scale to 1 when remaining capacity is already exhausted", async () => {
    const agentConfigs = [
      makeAgentConfig("agent-a", 5),
      makeAgentConfig("agent-b", 3),
    ];
    const logger = makeLogger();

    const { actualScales } = await createRunnerPools({
      globalConfig: makeGlobalConfig({ scale: 5 }),
      agentConfigs,
      baseImage: "base:latest",
      mkLogger: () => makeLogger() as any,
      projectPath: "/tmp",
      logger,
    });

    expect(actualScales["agent-a"]).toBe(5);
    expect(actualScales["agent-b"]).toBe(1);
    expect(logger.warn).toHaveBeenCalled();
    const warnCall = logger.warn.mock.calls.find(
      (c: any) => c[0]?.agent === "agent-b"
    );
    expect(warnCall).toBeDefined();
    expect(warnCall[0]).toMatchObject({ agent: "agent-b", reduced: 1 });
  });

  it("uses defaultAgentScale when agent has no explicit scale configured", async () => {
    const agentConfigs = [
      makeAgentConfig("no-scale-agent"),
    ];

    const { actualScales } = await createRunnerPools({
      globalConfig: makeGlobalConfig({ defaultAgentScale: 3 }),
      agentConfigs,
      baseImage: "base:latest",
      mkLogger: () => makeLogger() as any,
      projectPath: "/tmp",
      logger: makeLogger(),
    });

    expect(actualScales["no-scale-agent"]).toBe(3);
  });

  it("returns createRunner function that creates PoolRunner instances", async () => {
    const agentConfigs = [makeAgentConfig("agent-a", 1)];

    const { createRunner } = await createRunnerPools({
      globalConfig: makeGlobalConfig(),
      agentConfigs,
      baseImage: "base:latest",
      mkLogger: () => makeLogger() as any,
      projectPath: "/tmp",
      logger: makeLogger(),
    });

    const runner = createRunner(agentConfigs[0]);
    expect(runner).toBeDefined();
    expect(typeof runner.run).toBe("function");
    expect(typeof runner.isRunning).toBe("boolean");
  });

  it("status tracker scale is updated when it differs from pool size", async () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("agent-a", 4);

    const agentConfigs = [makeAgentConfig("agent-a", 4)];

    const { actualScales } = await createRunnerPools({
      globalConfig: makeGlobalConfig({ scale: 2 }),
      agentConfigs,
      statusTracker: tracker,
      baseImage: "base:latest",
      mkLogger: () => makeLogger() as any,
      projectPath: "/tmp",
      logger: makeLogger(),
    });

    expect(actualScales["agent-a"]).toBe(2);
    expect(actualScales["agent-a"]).not.toBe(4);
  });
});
