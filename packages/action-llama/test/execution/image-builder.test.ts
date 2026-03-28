import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import type { AgentConfig, GlobalConfig } from "../../src/shared/config.js";
import type { Runtime, ContainerRuntime, BuildImageOpts } from "../../src/docker/runtime.js";
import { buildSingleAgentImage, buildAllImages } from "../../src/execution/image-builder.js";

// Mock docker/image.js so imageExists doesn't call Docker
vi.mock("../../src/docker/image.js", () => ({
  imageExists: vi.fn(() => true),
}));

/** Minimal mock runtime that captures buildImage calls. */
function createMockRuntime() {
  const calls: BuildImageOpts[] = [];
  const runtime: Runtime & ContainerRuntime = {
    buildImage: vi.fn(async (opts: BuildImageOpts) => {
      calls.push(opts);
      return opts.tag;
    }),
    launchContainer: vi.fn(),
    kill: vi.fn(),
    listRunning: vi.fn().mockResolvedValue([]),
    cleanup: vi.fn(),
  } as unknown as Runtime & ContainerRuntime;
  return { runtime, calls };
}

const baseAgentConfig: AgentConfig = {
  name: "dev",
  credentials: [],
  models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
  schedule: "*/5 * * * *",
};

const baseGlobalConfig: GlobalConfig = {};

describe("buildSingleAgentImage shared files", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-imgbuild-"));
    // Create minimal agent directory with SKILL.md
    const agentDir = resolve(tmpDir, "agents", "dev");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(resolve(agentDir, "SKILL.md"), "---\nmetadata:\n  models:\n    - sonnet\n---\n\n# Dev\n");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("includes shared files in extraFiles when shared/ exists", async () => {
    const sharedDir = resolve(tmpDir, "shared");
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(resolve(sharedDir, "conventions.md"), "# Conventions");
    writeFileSync(resolve(sharedDir, "layout.md"), "# Layout");

    const { runtime, calls } = createMockRuntime();
    await buildSingleAgentImage({
      agentConfig: baseAgentConfig,
      projectPath: tmpDir,
      globalConfig: baseGlobalConfig,
      runtime,
      baseImage: "al-agent:latest",
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    });

    expect(calls).toHaveLength(1);
    const extraFiles = calls[0].extraFiles!;
    expect(extraFiles["shared/conventions.md"]).toBe("# Conventions");
    expect(extraFiles["shared/layout.md"]).toBe("# Layout");
    // Standard files still present
    expect(extraFiles["agent-config.json"]).toBeDefined();
    expect(extraFiles["SKILL.md"]).toBeDefined();
  });

  it("includes shared files from subdirectories", async () => {
    const sharedDir = resolve(tmpDir, "shared");
    mkdirSync(resolve(sharedDir, "team"), { recursive: true });
    writeFileSync(resolve(sharedDir, "team", "policy.md"), "# Policy");

    const { runtime, calls } = createMockRuntime();
    await buildSingleAgentImage({
      agentConfig: baseAgentConfig,
      projectPath: tmpDir,
      globalConfig: baseGlobalConfig,
      runtime,
      baseImage: "al-agent:latest",
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    });

    expect(calls[0].extraFiles!["shared/team/policy.md"]).toBe("# Policy");
  });

  it("works without shared/ directory", async () => {
    const { runtime, calls } = createMockRuntime();
    await buildSingleAgentImage({
      agentConfig: baseAgentConfig,
      projectPath: tmpDir,
      globalConfig: baseGlobalConfig,
      runtime,
      baseImage: "al-agent:latest",
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    });

    expect(calls).toHaveLength(1);
    const keys = Object.keys(calls[0].extraFiles!);
    expect(keys.some(k => k.startsWith("shared/"))).toBe(false);
  });
});

describe("buildAllImages", () => {
  let tmpDir: string;

  function makeLogger() {
    return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;
  }

  function createMockRuntime() {
    const calls: BuildImageOpts[] = [];
    const runtime: Runtime & ContainerRuntime = {
      buildImage: vi.fn(async (opts: BuildImageOpts) => {
        calls.push(opts);
        return opts.tag;
      }),
      launchContainer: vi.fn(),
      kill: vi.fn(),
      listRunning: vi.fn().mockResolvedValue([]),
      cleanup: vi.fn(),
    } as unknown as Runtime & ContainerRuntime;
    return { runtime, calls };
  }

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-allimgs-"));

    // Reset mock for imageExists (it's imported dynamically but we mocked it at module level)
    const { imageExists } = await import("../../src/docker/image.js");
    vi.mocked(imageExists).mockReturnValue(true);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("builds per-agent images and returns result with baseImage and agentImages map", async () => {
    const agentDir = resolve(tmpDir, "agents", "worker");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(resolve(agentDir, "SKILL.md"), "# Worker");

    const agentConfig: AgentConfig = {
      name: "worker",
      credentials: [],
      models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
      schedule: "*/5 * * * *",
    };

    const { runtime } = createMockRuntime();
    const result = await buildAllImages({
      projectPath: tmpDir,
      globalConfig: {},
      activeAgentConfigs: [agentConfig],
      runtime,
      logger: makeLogger(),
    });

    expect(typeof result.baseImage).toBe("string");
    expect(result.baseImage.length).toBeGreaterThan(0);
    expect(result.agentImages["worker"]).toBeDefined();
    expect(typeof result.agentImages["worker"]).toBe("string");
  });

  it("skips building base image when it already exists (imageExists returns true)", async () => {
    const { imageExists } = await import("../../src/docker/image.js");
    vi.mocked(imageExists).mockReturnValue(true);

    const agentDir = resolve(tmpDir, "agents", "worker");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(resolve(agentDir, "SKILL.md"), "# Worker");

    const agentConfig: AgentConfig = {
      name: "worker",
      credentials: [],
      models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
      schedule: "*/5 * * * *",
    };

    const { runtime, calls } = createMockRuntime();
    await buildAllImages({
      projectPath: tmpDir,
      globalConfig: {},
      activeAgentConfigs: [agentConfig],
      runtime,
      logger: makeLogger(),
    });

    // Only agent image should be built; base image skipped
    expect(calls.every(c => !c.tag.includes("al-agent:latest"))).toBe(true);
  });

  it("builds base image when imageExists returns false", async () => {
    const { imageExists } = await import("../../src/docker/image.js");
    vi.mocked(imageExists).mockReturnValue(false);

    const agentDir = resolve(tmpDir, "agents", "worker");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(resolve(agentDir, "SKILL.md"), "# Worker");

    const agentConfig: AgentConfig = {
      name: "worker",
      credentials: [],
      models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
      schedule: "*/5 * * * *",
    };

    const { runtime, calls } = createMockRuntime();
    await buildAllImages({
      projectPath: tmpDir,
      globalConfig: {},
      activeAgentConfigs: [agentConfig],
      runtime,
      logger: makeLogger(),
    });

    // Base image should be built (the first buildImage call)
    expect(calls.length).toBeGreaterThanOrEqual(2); // base + agent
  });

  it("builds project base image when project Dockerfile has custom instructions", async () => {
    const { imageExists } = await import("../../src/docker/image.js");
    vi.mocked(imageExists).mockReturnValue(true);

    // Write a project Dockerfile with more than just a FROM
    writeFileSync(resolve(tmpDir, "Dockerfile"), "FROM ubuntu:22.04\nRUN apt-get update\n");

    const agentDir = resolve(tmpDir, "agents", "worker");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(resolve(agentDir, "SKILL.md"), "# Worker");

    const agentConfig: AgentConfig = {
      name: "worker",
      credentials: [],
      models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
      schedule: "*/5 * * * *",
    };

    const { runtime, calls } = createMockRuntime();
    await buildAllImages({
      projectPath: tmpDir,
      globalConfig: {},
      activeAgentConfigs: [agentConfig],
      runtime,
      logger: makeLogger(),
    });

    // Should have built a project base image
    const projectBaseBuild = calls.find(c => c.tag.includes("al-project-base") || c.dockerfile?.toString().includes(tmpDir));
    expect(projectBaseBuild).toBeDefined();
  });

  it("does not build project base image when Dockerfile has only a FROM", async () => {
    writeFileSync(resolve(tmpDir, "Dockerfile"), "FROM ubuntu:22.04\n");

    const agentDir = resolve(tmpDir, "agents", "worker");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(resolve(agentDir, "SKILL.md"), "# Worker");

    const agentConfig: AgentConfig = {
      name: "worker",
      credentials: [],
      models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
      schedule: "*/5 * * * *",
    };

    const { runtime, calls } = createMockRuntime();
    await buildAllImages({
      projectPath: tmpDir,
      globalConfig: {},
      activeAgentConfigs: [agentConfig],
      runtime,
      logger: makeLogger(),
    });

    // No project base build; all builds are agent or base
    const projectBaseBuild = calls.find(c => c.tag?.toString().includes("al-project-base"));
    expect(projectBaseBuild).toBeUndefined();
  });

  it("builds images for multiple agents", async () => {
    for (const name of ["alpha", "beta"]) {
      const agentDir = resolve(tmpDir, "agents", name);
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(resolve(agentDir, "SKILL.md"), `# ${name}`);
    }

    const agentConfigs: AgentConfig[] = ["alpha", "beta"].map(name => ({
      name,
      credentials: [],
      models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
      schedule: "*/5 * * * *",
    }));

    const { runtime } = createMockRuntime();
    const result = await buildAllImages({
      projectPath: tmpDir,
      globalConfig: {},
      activeAgentConfigs: agentConfigs,
      runtime,
      logger: makeLogger(),
    });

    expect(result.agentImages["alpha"]).toBeDefined();
    expect(result.agentImages["beta"]).toBeDefined();
  });

  it("returns empty agentImages when no agents provided", async () => {
    const { runtime } = createMockRuntime();
    const result = await buildAllImages({
      projectPath: tmpDir,
      globalConfig: {},
      activeAgentConfigs: [],
      runtime,
      logger: makeLogger(),
    });

    expect(result.agentImages).toEqual({});
  });

  it("calls onProgress callback during build", async () => {
    const agentDir = resolve(tmpDir, "agents", "worker");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(resolve(agentDir, "SKILL.md"), "# Worker");

    const agentConfig: AgentConfig = {
      name: "worker",
      credentials: [],
      models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
      schedule: "*/5 * * * *",
    };

    const progressCalls: Array<[string, string]> = [];
    const { runtime } = createMockRuntime();
    await buildAllImages({
      projectPath: tmpDir,
      globalConfig: {},
      activeAgentConfigs: [agentConfig],
      runtime,
      logger: makeLogger(),
      onProgress: (label, msg) => progressCalls.push([label, msg]),
    });

    expect(progressCalls.length).toBeGreaterThan(0);
  });

  it("uses custom globalConfig.local.image if specified", async () => {
    const agentDir = resolve(tmpDir, "agents", "worker");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(resolve(agentDir, "SKILL.md"), "# Worker");

    const agentConfig: AgentConfig = {
      name: "worker",
      credentials: [],
      models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
      schedule: "*/5 * * * *",
    };

    const { runtime } = createMockRuntime();
    const result = await buildAllImages({
      projectPath: tmpDir,
      globalConfig: { local: { image: "my-custom-base:v2", timeout: 900 } },
      activeAgentConfigs: [agentConfig],
      runtime,
      logger: makeLogger(),
    });

    // The baseImage in the result should be the custom image
    expect(result.baseImage).toBe("my-custom-base:v2");
  });
});
