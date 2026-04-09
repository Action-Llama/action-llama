/**
 * Tests for the runtime factory (createContainerRuntime and buildAgentImages).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentError } from "../../src/shared/errors.js";

// --- Mocks ---

// child_process mock (for Docker info check)
vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

// Docker network mock
vi.mock("../../src/docker/network.js", () => ({
  ensureNetwork: vi.fn(),
}));

// HostUserRuntime mock
vi.mock("../../src/docker/host-user-runtime.js", () => ({
  HostUserRuntime: class MockHostUserRuntime {
    constructor(public runAs: string, public groups: string[] = []) {}
    isContainerRuntime = false;
  },
}));

import { createContainerRuntime } from "../../src/execution/runtime-factory.js";
import { globalRegistry } from "../../src/extensions/registry.js";
import type { AgentConfig } from "../../src/shared/config.js";
import type { Runtime } from "../../src/docker/runtime.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;
}

function makeAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: "dev",
    credentials: [],
    models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
    schedule: "0 * * * *",
    ...overrides,
  };
}

describe("createContainerRuntime", () => {
  let registrySpy: ReturnType<typeof vi.spyOn>;
  let mockRuntime: any;

  beforeEach(async () => {
    // Provide a mock runtime via the extension registry
    mockRuntime = { isRunning: true } as any;
    registrySpy = vi.spyOn(globalRegistry, "getRuntimeExtension").mockReturnValue({
      provider: mockRuntime,
      metadata: { name: "local" },
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws AgentError when the runtime type is not registered", async () => {
    registrySpy.mockReturnValue(undefined);
    vi.spyOn(globalRegistry, "getAllRuntimeExtensions").mockReturnValue([
      { metadata: { name: "local", type: "runtime", version: "1.0.0", description: "Local Docker" }, provider: {} as any, init: vi.fn(), shutdown: vi.fn() },
    ]);

    await expect(
      createContainerRuntime({} as any, [], makeLogger())
    ).rejects.toThrow(AgentError);

    await expect(
      createContainerRuntime({} as any, [], makeLogger())
    ).rejects.toThrow(/Unknown runtime type/);
  });

  it("throws AgentError when Docker is not running", async () => {
    const { execFileSync } = await import("child_process");
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("docker not found");
    });

    await expect(
      createContainerRuntime({} as any, [], makeLogger())
    ).rejects.toThrow(AgentError);

    await expect(
      createContainerRuntime({} as any, [], makeLogger())
    ).rejects.toThrow(/Docker is not running/);
  });

  it("returns the runtime and empty overrides when Docker is available", async () => {
    const { execFileSync } = await import("child_process");
    vi.mocked(execFileSync).mockReturnValue(Buffer.from("Docker info"));

    const result = await createContainerRuntime({} as any, [makeAgentConfig()], makeLogger());
    expect(result.runtime).toBe(mockRuntime);
    expect(result.agentRuntimeOverrides).toEqual({});
  });

  it("adds a HostUserRuntime override for agents with runtime.type === 'host-user'", async () => {
    const { execFileSync } = await import("child_process");
    vi.mocked(execFileSync).mockReturnValue(Buffer.from("Docker info"));

    const agentWithHostRuntime = makeAgentConfig({
      name: "host-agent",
      runtime: { type: "host-user", run_as: "my-user" } as any,
    });

    const result = await createContainerRuntime(
      {} as any,
      [makeAgentConfig(), agentWithHostRuntime],
      makeLogger()
    );

    expect(result.agentRuntimeOverrides["host-agent"]).toBeDefined();
  });

  it("uses default run_as 'al-agent' when not specified in host-user runtime config", async () => {
    const { execFileSync } = await import("child_process");
    vi.mocked(execFileSync).mockReturnValue(Buffer.from("Docker info"));

    const agentWithHostRuntime = makeAgentConfig({
      name: "host-agent",
      runtime: { type: "host-user" } as any,
    });

    const result = await createContainerRuntime(
      {} as any,
      [agentWithHostRuntime],
      makeLogger()
    );

    // HostUserRuntime should have been created with the default 'al-agent'
    const override = result.agentRuntimeOverrides["host-agent"] as any;
    expect(override).toBeDefined();
    expect(override.runAs).toBe("al-agent");
  });

  it("passes groups to HostUserRuntime when configured", async () => {
    const { execFileSync } = await import("child_process");
    vi.mocked(execFileSync).mockReturnValue(Buffer.from("Docker info"));

    const agentWithGroups = makeAgentConfig({
      name: "host-agent",
      runtime: { type: "host-user", run_as: "al-agent", groups: ["docker"] } as any,
    });

    const result = await createContainerRuntime(
      {} as any,
      [agentWithGroups],
      makeLogger()
    );

    const override = result.agentRuntimeOverrides["host-agent"] as any;
    expect(override).toBeDefined();
    expect(override.runAs).toBe("al-agent");
    expect(override.groups).toEqual(["docker"]);
  });

  it("uses empty groups array when groups not specified in host-user runtime config", async () => {
    const { execFileSync } = await import("child_process");
    vi.mocked(execFileSync).mockReturnValue(Buffer.from("Docker info"));

    const agentWithHostRuntime = makeAgentConfig({
      name: "host-agent",
      runtime: { type: "host-user" } as any,
    });

    const result = await createContainerRuntime(
      {} as any,
      [agentWithHostRuntime],
      makeLogger()
    );

    const override = result.agentRuntimeOverrides["host-agent"] as any;
    expect(override.groups).toEqual([]);
  });
});

