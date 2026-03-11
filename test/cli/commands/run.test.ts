import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { makeTmpProject, captureLog } from "../../helpers.js";

// Mock child_process for Docker check
vi.mock("child_process", () => ({
  execFileSync: vi.fn((_cmd: string, _args: string[]) => ""),
}));

// Mock Docker/container related modules
vi.mock("../../../src/docker/local-runtime.js", () => ({
  LocalDockerRuntime: class MockLocalDockerRuntime {
    constructor() {
      // Mock runtime methods if needed
    }
  }
}));

vi.mock("../../../src/docker/network.js", () => ({
  ensureNetwork: vi.fn()
}));

vi.mock("../../../src/docker/image.js", () => ({
  ensureImage: vi.fn(),
  ensureAgentImage: vi.fn().mockReturnValue("test-agent-image")
}));

// Mock AgentRunner first
const mockRun = vi.fn().mockResolvedValue({ result: "completed", triggers: [] });

vi.mock("../../../src/agents/container-runner.js", () => ({
  ContainerAgentRunner: class MockContainerAgentRunner {
    run = mockRun;
    isRunning = false;
  }
}));

// Mock doctor to be a no-op
vi.mock("../../../src/cli/commands/doctor.js", () => ({
  execute: vi.fn().mockResolvedValue(undefined),
}));

// Mock credentials to always pass
vi.mock("../../../src/shared/credentials.js", async () => {
  const actual = await vi.importActual("../../../src/shared/credentials.js") as any;
  return {
    ...actual,
    requireCredentialRef: vi.fn(),
    loadCredentialField: vi.fn().mockReturnValue("mock-value"),
    parseCredentialRef: actual.parseCredentialRef,
    backendLoadField: vi.fn().mockResolvedValue("mock-value"),
    backendLoadFields: vi.fn().mockResolvedValue({}),
    backendCredentialExists: vi.fn().mockResolvedValue(true),
    backendListInstances: vi.fn().mockResolvedValue([]),
    backendRequireCredentialRef: vi.fn().mockResolvedValue(undefined),
    getDefaultBackend: vi.fn(),
    setDefaultBackend: vi.fn(),
    resetDefaultBackend: vi.fn(),
  };
});

vi.mock("../../../src/agents/runner.js", () => ({
  AgentRunner: class MockAgentRunner {
    run = mockRun;
    isRunning = false;
  },
}));

// Mock logger
vi.mock("../../../src/shared/logger.js", () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  createFileOnlyLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { execute } from "../../../src/cli/commands/run.js";

describe("run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs a named agent in Docker mode", async () => {
    const dir = makeTmpProject({
      agents: [{ name: "dev", schedule: "*/5 * * * *" }],
    });

    const output = await captureLog(async () => {
      await execute("dev", { project: dir });
    });

    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockRun).toHaveBeenCalledWith(expect.stringContaining("triggered manually"));
    expect(output).toContain('Running agent "dev"');
    expect(output).toContain("run completed");
  });

  it("throws if agent does not exist", async () => {
    const dir = makeTmpProject({
      agents: [{ name: "dev", schedule: "*/5 * * * *" }],
    });

    await expect(execute("nonexistent", { project: dir })).rejects.toThrow(
      'Agent "nonexistent" not found'
    );
  });

  it("lists available agents in error message", async () => {
    const dir = makeTmpProject({
      agents: [
        { name: "dev", schedule: "*/5 * * * *" },
        { name: "reviewer", schedule: "*/5 * * * *" },
      ],
    });

    await expect(execute("nope", { project: dir })).rejects.toThrow("Available agents: dev, reviewer");
  });

  it("throws if run from an agent directory", async () => {
    const dir = makeTmpProject({
      agents: [{ name: "dev", schedule: "*/5 * * * *" }],
    });

    // Point at the agent subdir instead of the project root
    await expect(execute("dev", { project: resolve(dir, "dev") })).rejects.toThrow(
      "looks like an agent directory"
    );
  });
});
