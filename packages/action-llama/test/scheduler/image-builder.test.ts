import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import type { AgentConfig, GlobalConfig } from "../../src/shared/config.js";
import type { ContainerRuntime, BuildImageOpts } from "../../src/docker/runtime.js";
import { buildSingleAgentImage } from "../../src/scheduler/image-builder.js";

/** Minimal mock runtime that captures buildImage calls. */
function createMockRuntime() {
  const calls: BuildImageOpts[] = [];
  const runtime: ContainerRuntime = {
    buildImage: vi.fn(async (opts: BuildImageOpts) => {
      calls.push(opts);
      return opts.tag;
    }),
    launchContainer: vi.fn(),
    kill: vi.fn(),
    listRunning: vi.fn().mockResolvedValue([]),
    cleanup: vi.fn(),
  } as unknown as ContainerRuntime;
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
