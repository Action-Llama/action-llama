import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, relative, join } from "path";
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml";
import { ConfigError } from "../errors.js";
import { parseFrontmatter } from "../frontmatter.js";
import type { AgentConfig, AgentRuntimeConfig, ModelConfig } from "./types.js";
import { loadGlobalConfig } from "./load-project.js";

/**
 * Load the raw per-agent runtime config from `agents/<name>/config.toml`.
 */
export function loadAgentRuntimeConfig(projectPath: string, agentName: string): AgentRuntimeConfig {
  const configPath = resolve(projectPath, "agents", agentName, "config.toml");

  if (!existsSync(configPath)) {
    return {};
  }

  const raw = readFileSync(configPath, "utf-8");
  try {
    return parseTOML(raw) as unknown as AgentRuntimeConfig;
  } catch (err) {
    throw new ConfigError(
      `Error parsing ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

export function loadAgentConfig(projectPath: string, agentName: string): AgentConfig {
  const agentDir = resolve(projectPath, "agents", agentName);
  const skillPath = resolve(agentDir, "SKILL.md");

  if (!existsSync(skillPath)) {
    throw new ConfigError(`Agent config not found at ${skillPath}.`);
  }

  // Read portable fields from SKILL.md frontmatter
  const raw = readFileSync(skillPath, "utf-8");
  let data: Record<string, unknown>;
  try {
    ({ data } = parseFrontmatter(raw));
  } catch (err) {
    throw new ConfigError(
      `Error parsing ${skillPath}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  // Read runtime config from per-agent config.toml
  const runtime = loadAgentRuntimeConfig(projectPath, agentName);

  const parsed: Record<string, unknown> = {
    name: agentName,
    // Portable fields from SKILL.md frontmatter
    description: data.description,
    license: data.license,
    compatibility: data.compatibility,
    // Runtime fields from config.toml
    credentials: runtime.credentials,
    schedule: runtime.schedule,
    webhooks: runtime.webhooks,
    hooks: runtime.hooks,
    params: runtime.params,
    scale: runtime.scale,
    timeout: runtime.timeout,
    maxWorkQueueSize: runtime.maxWorkQueueSize,
    runtime: runtime.runtime,
  };

  // Resolve named model references from global config
  const rawModels = runtime.models;
  if (!rawModels || !Array.isArray(rawModels) || rawModels.length === 0) {
    throw new ConfigError(
      `Agent "${agentName}" must have a "models" field listing at least one named model.`
    );
  }

  const global = loadGlobalConfig(projectPath);
  if (!global.models || Object.keys(global.models).length === 0) {
    throw new ConfigError(
      `No models defined in config.toml [models]. Define at least one named model.`
    );
  }

  const resolvedModels: ModelConfig[] = [];
  for (const name of rawModels) {
    const modelDef = global.models[name];
    if (!modelDef) {
      const available = Object.keys(global.models).join(", ");
      throw new ConfigError(
        `Agent "${agentName}" references model "${name}" which is not defined in config.toml. Available: ${available}`
      );
    }
    resolvedModels.push(modelDef);
  }

  parsed.models = resolvedModels;

  // Apply defaultAgentScale as fallback when no explicit per-agent scale is set
  if (parsed.scale === undefined && global.defaultAgentScale !== undefined) {
    parsed.scale = global.defaultAgentScale;
  }

  return parsed as unknown as AgentConfig;
}

/**
 * Load the SKILL.md body (markdown content after frontmatter).
 * Used by image builder and container entry to get agent instructions.
 */
export function loadAgentBody(projectPath: string, agentName: string): string {
  const skillPath = resolve(projectPath, "agents", agentName, "SKILL.md");
  if (!existsSync(skillPath)) return "";
  const raw = readFileSync(skillPath, "utf-8");
  try {
    const { body } = parseFrontmatter(raw);
    return body;
  } catch (err) {
    throw new ConfigError(
      `Error parsing ${skillPath}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

/**
 * Load all files from `<projectPath>/shared/` recursively.
 * Returns a map of relative paths (prefixed with `shared/`) to file contents.
 * Returns an empty object if the directory doesn't exist.
 */
export function loadSharedFiles(projectPath: string): Record<string, string> {
  const sharedDir = resolve(projectPath, "shared");
  if (!existsSync(sharedDir) || !statSync(sharedDir).isDirectory()) {
    return {};
  }

  const result: Record<string, string> = {};

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(".")) continue;
      const fullPath = resolve(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile()) {
        const relPath = join("shared", relative(sharedDir, fullPath));
        result[relPath] = readFileSync(fullPath, "utf-8");
      }
    }
  }

  walk(sharedDir);
  return result;
}

export function discoverAgents(projectPath: string): string[] {
  const excluded = new Set(["node_modules"]);
  const agents: string[] = [];

  if (!existsSync(projectPath)) return agents;

  const agentsPath = resolve(projectPath, "agents");
  if (!existsSync(agentsPath)) return agents;

  for (const entry of readdirSync(agentsPath)) {
    if (excluded.has(entry)) continue;
    if (entry.startsWith(".")) continue;
    const entryPath = resolve(agentsPath, entry);
    if (!statSync(entryPath).isDirectory()) continue;
    if (existsSync(resolve(entryPath, "SKILL.md"))) {
      agents.push(entry);
    }
  }

  return agents.sort();
}

/**
 * Get current agent scale from config
 */
export function getAgentScale(projectPath: string, agentName: string): number {
  const config = loadAgentConfig(projectPath, agentName);
  // defaultAgentScale is already applied in loadAgentConfig, so just fall back to 1
  return config.scale ?? 1;
}

/**
 * Update a field in the per-agent config.toml.
 */
export function updateAgentRuntimeField(
  projectPath: string,
  agentName: string,
  field: string,
  value: unknown,
): void {
  const configPath = resolve(projectPath, "agents", agentName, "config.toml");
  let existing: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    existing = parseTOML(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
  }
  existing[field] = value;
  writeFileSync(configPath, stringifyTOML(existing));
}
