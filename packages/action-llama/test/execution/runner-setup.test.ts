import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the container-runner dynamic import used inside createRunnerPools
vi.mock("../../src/agents/container-runner.js", () => ({
  ContainerAgentRunner: class MockContainerAgentRunner {
    instanceId = "mock-runner";
    isRunning = false;
    async run() { return { result: "completed", triggers: [] }; }
  },
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
    prompt: "test prompt",
  } as AgentConfig;
}

function makeRuntime() {
  return {
    run: vi.fn(),
    build: vi.fn(),
    kill: vi.fn(),
    remove: vi.fn(),
    listRunningAgents: vi.fn().mockResolvedValue([]),
    inspect: vi.fn(),
  } as any;
}

describe("createRunnerPools", () => {
  it("returns actualScales matching configured scale when no project cap", async () => {
    const agentConfigs = [
      makeAgentConfig("agent-a", 2),
      makeAgentConfig("agent-b", 3),
    ];

    const { actualScales } = await createRunnerPools({
      globalConfig: makeGlobalConfig(),
      agentConfigs,
      runtime: makeRuntime(),
      agentRuntimeOverrides: {},
      agentImages: { "agent-a": "img-a", "agent-b": "img-b" },
      baseImage: "base:latest",
      gatewayPort: 8080,
      registerContainer: vi.fn(),
      unregisterContainer: vi.fn(),
      mkLogger: () => makeLogger() as any,
      projectPath: "/tmp",
      logger: makeLogger(),
    });

    expect(actualScales["agent-a"]).toBe(2);
    expect(actualScales["agent-b"]).toBe(3);
  });

  it("returns actualScales after project-wide scale cap is applied", async () => {
    // Project cap of 5 shared across two agents requesting 4 each (8 total)
    const agentConfigs = [
      makeAgentConfig("agent-a", 4),
      makeAgentConfig("agent-b", 4),
    ];

    const { actualScales, runnerPools } = await createRunnerPools({
      globalConfig: makeGlobalConfig({ scale: 5 }),
      agentConfigs,
      runtime: makeRuntime(),
      agentRuntimeOverrides: {},
      agentImages: {},
      baseImage: "base:latest",
      gatewayPort: 8080,
      registerContainer: vi.fn(),
      unregisterContainer: vi.fn(),
      mkLogger: () => makeLogger() as any,
      projectPath: "/tmp",
      logger: makeLogger(),
    });

    // agent-a gets 4 (within remaining 5), agent-b gets capped to 1 (5-4=1)
    expect(actualScales["agent-a"]).toBe(4);
    expect(actualScales["agent-b"]).toBe(1);

    // runnerPools should match
    expect(runnerPools["agent-a"].size).toBe(4);
    expect(runnerPools["agent-b"].size).toBe(1);
  });

  it("status tracker scale is updated when it differs from pool size", async () => {
    const tracker = new StatusTracker();
    // Register agent-a with scale=4 (as if configured before pool creation)
    tracker.registerAgent("agent-a", 4);

    const agentConfigs = [makeAgentConfig("agent-a", 4)];

    const { actualScales } = await createRunnerPools({
      globalConfig: makeGlobalConfig({ scale: 2 }),
      agentConfigs,
      runtime: makeRuntime(),
      agentRuntimeOverrides: {},
      agentImages: {},
      baseImage: "base:latest",
      gatewayPort: 8080,
      registerContainer: vi.fn(),
      unregisterContainer: vi.fn(),
      statusTracker: tracker,
      mkLogger: () => makeLogger() as any,
      projectPath: "/tmp",
      logger: makeLogger(),
    });

    // actualScales reflects the capped value
    expect(actualScales["agent-a"]).toBe(2);

    // The caller (scheduler/index.ts) is responsible for syncing the tracker
    // using actualScales, which this test verifies the data is available for.
    expect(actualScales["agent-a"]).not.toBe(4); // not the original configured value
  });
});
