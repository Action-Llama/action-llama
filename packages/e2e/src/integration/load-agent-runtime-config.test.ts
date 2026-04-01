/**
 * Integration tests: loadAgentConfig [runtime] section — no Docker required.
 *
 * The `[runtime]` table in per-agent config.toml controls how agents are
 * launched (container vs host-user mode). These tests verify that
 * loadAgentConfig() correctly reads and preserves runtime fields:
 *
 *   - type = "host-user" triggers HostUserRuntime creation in the scheduler
 *   - run_as sets the OS user for host-user mode (default: "al-agent")
 *   - groups lists additional OS groups for Docker socket access
 *   - No [runtime] section → runtime field is undefined in AgentConfig
 *   - type = "container" is explicitly supported
 *
 * These were introduced in commits af9e0fb (groups field) and 38d36b1
 * (hot-reload runtime config change). While the hot-reload behavior
 * requires Docker to test end-to-end, the config loading itself is
 * testable without any Docker dependency.
 *
 * Covers:
 *   - shared/config/load-agent.ts: loadAgentConfig() — runtime field pass-through
 *   - shared/config/types.ts: AgentRuntimeType interface (type, run_as, groups)
 *   - execution/runtime-factory.ts: createAgentRuntimeOverride() reads these fields
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";
import { stringify as stringifyYAML } from "yaml";
import { loadAgentConfig } from "@action-llama/action-llama/internals/config";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "al-runtime-cfg-test-"));
}

function writeGlobalConfig(projectPath: string): void {
  writeFileSync(
    join(projectPath, "config.toml"),
    stringifyTOML({
      models: {
        sonnet: {
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          thinkingLevel: "medium",
          authType: "api_key",
        },
      },
    }),
  );
}

function writeSkillMd(projectPath: string, agentName: string): void {
  const agentDir = join(projectPath, "agents", agentName);
  mkdirSync(agentDir, { recursive: true });
  const yamlStr = stringifyYAML({ name: agentName }).trimEnd();
  writeFileSync(join(agentDir, "SKILL.md"), `---\n${yamlStr}\n---\n\nTest agent.\n`);
}

function writeAgentConfig(
  projectPath: string,
  agentName: string,
  config: Record<string, unknown>,
): void {
  const agentDir = join(projectPath, "agents", agentName);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "config.toml"), stringifyTOML(config));
}

describe("load-agent-runtime-config: [runtime] section in agent config.toml", { timeout: 10_000 }, () => {
  it("runtime field is undefined when no [runtime] section is present", () => {
    const dir = makeTempDir();
    writeGlobalConfig(dir);
    writeSkillMd(dir, "no-runtime-agent");
    writeAgentConfig(dir, "no-runtime-agent", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      schedule: "*/5 * * * *",
      // No runtime section
    });

    const config = loadAgentConfig(dir, "no-runtime-agent");
    // AgentConfig.runtime is undefined when not set
    expect(config.runtime).toBeUndefined();
  });

  it("preserves host-user runtime type from [runtime] section", () => {
    const dir = makeTempDir();
    writeGlobalConfig(dir);
    writeSkillMd(dir, "host-user-agent");
    writeAgentConfig(dir, "host-user-agent", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      schedule: "*/5 * * * *",
      runtime: { type: "host-user" },
    });

    const config = loadAgentConfig(dir, "host-user-agent");
    expect(config.runtime).toBeDefined();
    expect(config.runtime!.type).toBe("host-user");
  });

  it("preserves run_as field from [runtime] section", () => {
    const dir = makeTempDir();
    writeGlobalConfig(dir);
    writeSkillMd(dir, "run-as-agent");
    writeAgentConfig(dir, "run-as-agent", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      schedule: "*/5 * * * *",
      runtime: { type: "host-user", run_as: "custom-user" },
    });

    const config = loadAgentConfig(dir, "run-as-agent");
    expect(config.runtime).toBeDefined();
    expect(config.runtime!.type).toBe("host-user");
    expect(config.runtime!.run_as).toBe("custom-user");
  });

  it("preserves groups field from [runtime] section (added in af9e0fb)", () => {
    const dir = makeTempDir();
    writeGlobalConfig(dir);
    writeSkillMd(dir, "groups-agent");
    writeAgentConfig(dir, "groups-agent", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      schedule: "*/5 * * * *",
      runtime: { type: "host-user", run_as: "al-agent", groups: ["docker", "sudo"] },
    });

    const config = loadAgentConfig(dir, "groups-agent");
    expect(config.runtime).toBeDefined();
    expect(config.runtime!.type).toBe("host-user");
    expect(config.runtime!.run_as).toBe("al-agent");
    expect(config.runtime!.groups).toEqual(["docker", "sudo"]);
  });

  it("preserves empty groups array from [runtime] section", () => {
    const dir = makeTempDir();
    writeGlobalConfig(dir);
    writeSkillMd(dir, "empty-groups-agent");
    writeAgentConfig(dir, "empty-groups-agent", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      schedule: "*/5 * * * *",
      runtime: { type: "host-user", groups: [] },
    });

    const config = loadAgentConfig(dir, "empty-groups-agent");
    expect(config.runtime).toBeDefined();
    expect(config.runtime!.groups).toEqual([]);
  });

  it("preserves container runtime type when explicitly set", () => {
    const dir = makeTempDir();
    writeGlobalConfig(dir);
    writeSkillMd(dir, "container-agent");
    writeAgentConfig(dir, "container-agent", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      schedule: "*/5 * * * *",
      runtime: { type: "container" },
    });

    const config = loadAgentConfig(dir, "container-agent");
    expect(config.runtime).toBeDefined();
    expect(config.runtime!.type).toBe("container");
  });

  it("two agents in same project can have different runtime configs", () => {
    const dir = makeTempDir();
    writeGlobalConfig(dir);

    // Agent 1: no runtime (default container mode)
    writeSkillMd(dir, "container-default");
    writeAgentConfig(dir, "container-default", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      schedule: "*/5 * * * *",
    });

    // Agent 2: host-user mode with groups
    writeSkillMd(dir, "host-user-with-docker");
    writeAgentConfig(dir, "host-user-with-docker", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      schedule: "*/5 * * * *",
      runtime: { type: "host-user", groups: ["docker"] },
    });

    const config1 = loadAgentConfig(dir, "container-default");
    const config2 = loadAgentConfig(dir, "host-user-with-docker");

    // Agent 1 has no runtime override
    expect(config1.runtime).toBeUndefined();

    // Agent 2 has host-user runtime with docker group
    expect(config2.runtime?.type).toBe("host-user");
    expect(config2.runtime?.groups).toContain("docker");
  });
});
