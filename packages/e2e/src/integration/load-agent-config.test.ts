/**
 * Integration tests: loadAgentConfig behaviors — no Docker required.
 *
 * loadAgentConfig() is a core function that merges SKILL.md frontmatter with
 * per-agent config.toml and resolves model references from global config.
 *
 * These tests exercise behaviors NOT covered by the startup flow tests:
 *   - defaultAgentScale from global config falls back to agents without explicit scale
 *   - explicit per-agent scale overrides defaultAgentScale
 *   - hooks, params, timeout, maxWorkQueueSize fields are preserved
 *   - description from SKILL.md frontmatter is included in the resolved config
 *   - throws ConfigError when a model reference is not in global config
 *
 * Covers:
 *   - shared/config/load-agent.ts: loadAgentConfig() — defaultAgentScale fallback,
 *     scale override, extended config fields
 *   - shared/config/load-project.ts: loadGlobalConfig() defaultAgentScale branch
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";
import { stringify as stringifyYAML } from "yaml";
import { loadAgentConfig } from "@action-llama/action-llama/internals/config";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "al-load-agent-test-"));
}

/**
 * Write a global config.toml with a "sonnet" model and optional overrides.
 */
function writeGlobalConfig(
  projectPath: string,
  overrides: Record<string, unknown> = {},
): void {
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
      ...overrides,
    }),
  );
}

/**
 * Write a minimal SKILL.md for an agent with optional frontmatter fields.
 */
function writeSkillMd(
  projectPath: string,
  agentName: string,
  frontmatter: Record<string, unknown> = {},
  body = "Test agent.",
): void {
  const agentDir = join(projectPath, "agents", agentName);
  mkdirSync(agentDir, { recursive: true });

  const fm = { name: agentName, ...frontmatter };
  const yamlStr = stringifyYAML(fm).trimEnd();
  writeFileSync(
    join(agentDir, "SKILL.md"),
    `---\n${yamlStr}\n---\n\n${body}\n`,
  );
}

/**
 * Write per-agent config.toml.
 */
function writeAgentConfig(
  projectPath: string,
  agentName: string,
  config: Record<string, unknown>,
): void {
  const agentDir = join(projectPath, "agents", agentName);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "config.toml"), stringifyTOML(config));
}

describe("load-agent-config: defaultAgentScale fallback", { timeout: 10_000 }, () => {
  it("inherits defaultAgentScale from global config when agent has no explicit scale", () => {
    const dir = makeTempDir();
    // Global config with defaultAgentScale=4
    writeGlobalConfig(dir, { defaultAgentScale: 4 });
    writeSkillMd(dir, "no-scale-agent");
    writeAgentConfig(dir, "no-scale-agent", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      schedule: "*/5 * * * *",
      // No explicit scale
    });

    const config = loadAgentConfig(dir, "no-scale-agent");
    expect(config.scale).toBe(4);
  });

  it("explicit per-agent scale overrides defaultAgentScale", () => {
    const dir = makeTempDir();
    writeGlobalConfig(dir, { defaultAgentScale: 4 });
    writeSkillMd(dir, "explicit-scale-agent");
    writeAgentConfig(dir, "explicit-scale-agent", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      schedule: "*/5 * * * *",
      scale: 2, // Explicit override
    });

    const config = loadAgentConfig(dir, "explicit-scale-agent");
    expect(config.scale).toBe(2); // explicit overrides defaultAgentScale
  });

  it("scale remains undefined when neither global nor agent defines a scale", () => {
    const dir = makeTempDir();
    writeGlobalConfig(dir); // no defaultAgentScale
    writeSkillMd(dir, "undefined-scale-agent");
    writeAgentConfig(dir, "undefined-scale-agent", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      schedule: "*/5 * * * *",
    });

    const config = loadAgentConfig(dir, "undefined-scale-agent");
    // No scale defined anywhere — should be undefined
    expect(config.scale).toBeUndefined();
  });
});

describe("load-agent-config: extended config fields", { timeout: 10_000 }, () => {
  it("preserves timeout from agent config.toml", () => {
    const dir = makeTempDir();
    writeGlobalConfig(dir);
    writeSkillMd(dir, "timeout-agent");
    writeAgentConfig(dir, "timeout-agent", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      schedule: "*/5 * * * *",
      timeout: 120,
    });

    const config = loadAgentConfig(dir, "timeout-agent");
    expect(config.timeout).toBe(120);
  });

  it("preserves maxWorkQueueSize from agent config.toml", () => {
    const dir = makeTempDir();
    writeGlobalConfig(dir);
    writeSkillMd(dir, "queue-agent");
    writeAgentConfig(dir, "queue-agent", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      schedule: "*/5 * * * *",
      maxWorkQueueSize: 5,
    });

    const config = loadAgentConfig(dir, "queue-agent");
    expect(config.maxWorkQueueSize).toBe(5);
  });

  it("preserves hooks from agent config.toml", () => {
    const dir = makeTempDir();
    writeGlobalConfig(dir);
    writeSkillMd(dir, "hooks-agent");
    writeAgentConfig(dir, "hooks-agent", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      schedule: "*/5 * * * *",
      hooks: {
        pre: ["echo pre"],
        post: ["echo post"],
      },
    });

    const config = loadAgentConfig(dir, "hooks-agent");
    expect(config.hooks?.pre).toEqual(["echo pre"]);
    expect(config.hooks?.post).toEqual(["echo post"]);
  });

  it("preserves params from agent config.toml", () => {
    const dir = makeTempDir();
    writeGlobalConfig(dir);
    writeSkillMd(dir, "params-agent");
    writeAgentConfig(dir, "params-agent", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      schedule: "*/5 * * * *",
      params: { env: "production", region: "us-east-1" },
    });

    const config = loadAgentConfig(dir, "params-agent");
    expect(config.params?.env).toBe("production");
    expect(config.params?.region).toBe("us-east-1");
  });

  it("includes description from SKILL.md frontmatter", () => {
    const dir = makeTempDir();
    writeGlobalConfig(dir);
    writeSkillMd(dir, "desc-agent", { description: "Manages deployments" });
    writeAgentConfig(dir, "desc-agent", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      schedule: "*/5 * * * *",
    });

    const config = loadAgentConfig(dir, "desc-agent");
    expect(config.description).toBe("Manages deployments");
  });
});

describe("load-agent-config: model resolution", { timeout: 10_000 }, () => {
  it("throws ConfigError when agent references a model not in global config", () => {
    const dir = makeTempDir();
    writeGlobalConfig(dir); // only has 'sonnet'
    writeSkillMd(dir, "bad-model-agent");
    writeAgentConfig(dir, "bad-model-agent", {
      models: ["nonexistent-model"],
      credentials: ["anthropic_key"],
      schedule: "*/5 * * * *",
    });

    expect(() => loadAgentConfig(dir, "bad-model-agent")).toThrow(
      /nonexistent-model|not defined|Available/i,
    );
  });

  it("resolves multiple models correctly when all are defined", () => {
    const dir = makeTempDir();
    // Global config with two models
    writeFileSync(
      join(dir, "config.toml"),
      stringifyTOML({
        models: {
          sonnet: {
            provider: "anthropic",
            model: "claude-sonnet-4-20250514",
            authType: "api_key",
          },
          haiku: {
            provider: "anthropic",
            model: "claude-haiku-4-20250514",
            authType: "api_key",
          },
        },
      }),
    );
    writeSkillMd(dir, "multi-model-agent");
    writeAgentConfig(dir, "multi-model-agent", {
      models: ["sonnet", "haiku"],
      credentials: ["anthropic_key"],
      schedule: "*/5 * * * *",
    });

    const config = loadAgentConfig(dir, "multi-model-agent");
    expect(config.models).toHaveLength(2);
    expect(config.models[0].model).toBe("claude-sonnet-4-20250514");
    expect(config.models[1].model).toBe("claude-haiku-4-20250514");
  });
});
