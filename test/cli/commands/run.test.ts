import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { makeTmpProject, captureLog } from "../../helpers.js";

// Mock setup to be a no-op
vi.mock("../../../src/cli/commands/setup.js", () => ({
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

// Mock AgentRunner
const mockRun = vi.fn().mockResolvedValue(undefined);
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

  it("runs a named agent in host mode", async () => {
    const dir = makeTmpProject({
      agents: [{ name: "dev", schedule: "*/5 * * * *" }],
    });

    const output = await captureLog(async () => {
      await execute("dev", { project: dir, dangerousNoDocker: true });
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
