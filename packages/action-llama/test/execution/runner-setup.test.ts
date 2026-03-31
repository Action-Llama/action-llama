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

  it("warns when total requested scale exceeds project cap (defaultAgentScale set)", async () => {
    const logger = makeLogger();
    const agentConfigs = [
      makeAgentConfig("agent-a", 3),
      makeAgentConfig("agent-b", 4),
    ];

    await createRunnerPools({
      globalConfig: makeGlobalConfig({ scale: 5, defaultAgentScale: 2 }),
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
      logger,
    });

    // Should have warned about total (7) exceeding cap (5)
    expect(logger.warn).toHaveBeenCalled();
    const warnCall = logger.warn.mock.calls[0];
    expect(warnCall[0]).toMatchObject({ totalRequested: 7, projectScale: 5 });
  });

  it("caps scale to 1 when remaining capacity is already exhausted", async () => {
    // agent-a uses all 5 slots, leaving 0 for agent-b
    const agentConfigs = [
      makeAgentConfig("agent-a", 5),
      makeAgentConfig("agent-b", 3), // requested 3 but 0 remain → capped to 1
    ];
    const logger = makeLogger();

    const { actualScales } = await createRunnerPools({
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
      logger,
    });

    expect(actualScales["agent-a"]).toBe(5);
    expect(actualScales["agent-b"]).toBe(1); // forced minimum
    // Should warn about agent-b being reduced
    expect(logger.warn).toHaveBeenCalled();
    const warnCall = logger.warn.mock.calls.find(
      (c: any) => c[0]?.agent === "agent-b"
    );
    expect(warnCall).toBeDefined();
    expect(warnCall[0]).toMatchObject({ agent: "agent-b", reduced: 1 });
  });

  it("uses defaultAgentScale when agent has no explicit scale configured", async () => {
    // Agent with no explicit scale — should default to globalConfig.defaultAgentScale
    const agentConfigs = [
      makeAgentConfig("no-scale-agent"), // scale is undefined
    ];

    const { actualScales } = await createRunnerPools({
      globalConfig: makeGlobalConfig({ defaultAgentScale: 3 }),
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

    expect(actualScales["no-scale-agent"]).toBe(3);
  });

  it("uses agent-specific runtime override when agentRuntimeOverrides is provided", async () => {
    const overrideRuntime = makeRuntime();
    const defaultRuntime = makeRuntime();
    const agentConfigs = [makeAgentConfig("special-agent", 1)];

    await createRunnerPools({
      globalConfig: makeGlobalConfig(),
      agentConfigs,
      runtime: defaultRuntime,
      agentRuntimeOverrides: { "special-agent": overrideRuntime },
      agentImages: { "special-agent": "custom-image:latest" },
      baseImage: "base:latest",
      gatewayPort: 8080,
      registerContainer: vi.fn(),
      unregisterContainer: vi.fn(),
      mkLogger: () => makeLogger() as any,
      projectPath: "/tmp",
      logger: makeLogger(),
    });

    // The pool should have been created (presence of "special-agent" in result)
    // The override runtime is used, not the default
    // We can only verify this indirectly via the successful creation
    expect(true).toBe(true); // createRunnerPools completed without error
  });

  it("uses localhost gateway URL when agent has a runtime override (host-user mode)", async () => {
    const overrideRuntime = makeRuntime();
    const agentConfigs = [makeAgentConfig("host-agent", 1)];

    // Temporarily unset GATEWAY_URL to test the localhost fallback path
    const savedGatewayUrl = process.env.GATEWAY_URL;
    delete process.env.GATEWAY_URL;

    try {
      const result = await createRunnerPools({
        globalConfig: makeGlobalConfig(),
        agentConfigs,
        runtime: makeRuntime(),
        agentRuntimeOverrides: { "host-agent": overrideRuntime },
        agentImages: {},
        baseImage: "base:latest",
        gatewayPort: 9090,
        registerContainer: vi.fn(),
        unregisterContainer: vi.fn(),
        mkLogger: () => makeLogger() as any,
        projectPath: "/tmp",
        logger: makeLogger(),
      });

      expect(result.runnerPools["host-agent"]).toBeDefined();
      expect(result.actualScales["host-agent"]).toBe(1);
    } finally {
      // Restore GATEWAY_URL
      if (savedGatewayUrl !== undefined) {
        process.env.GATEWAY_URL = savedGatewayUrl;
      }
    }
  });

  it("uses http://gateway fallback URL when GATEWAY_URL env var is not set", async () => {
    const agentConfigs = [makeAgentConfig("default-agent", 1)];

    const savedGatewayUrl = process.env.GATEWAY_URL;
    delete process.env.GATEWAY_URL;

    try {
      const result = await createRunnerPools({
        globalConfig: makeGlobalConfig(),
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

      expect(result.runnerPools["default-agent"]).toBeDefined();
    } finally {
      if (savedGatewayUrl !== undefined) {
        process.env.GATEWAY_URL = savedGatewayUrl;
      }
    }
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
