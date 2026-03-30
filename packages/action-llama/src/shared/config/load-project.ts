import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml";
import { ConfigError } from "../errors.js";
import {
  resolveEnvironmentName,
  loadEnvToml,
  loadEnvironmentConfig,
  deepMerge,
} from "../environment.js";
import type { GlobalConfig } from "./types.js";

/**
 * Load the raw project config.toml without environment merging.
 * Used internally and by tests that need the raw project config.
 */
export function loadProjectConfig(projectPath: string): GlobalConfig {
  const configPath = resolve(projectPath, "config.toml");
  let config: GlobalConfig = {};

  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, "utf-8");
    try {
      config = parseTOML(raw) as unknown as GlobalConfig;
    } catch (err) {
      throw new ConfigError(
        `Error parsing ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }

  return config;
}

/**
 * Load the merged global config: config.toml → .env.toml → environment file.
 *
 * @param projectPath - path to the project directory
 * @param envName - explicit environment name (from --env flag); takes precedence over .env.toml and AL_ENV
 */
export function loadGlobalConfig(projectPath: string, envName?: string): GlobalConfig {
  let config = loadProjectConfig(projectPath);

  // Layer 2: .env.toml overrides
  const envToml = loadEnvToml(projectPath);
  let projectName: string | undefined;
  if (envToml) {
    const { environment: _, projectName: pn, ...overrides } = envToml;
    projectName = typeof pn === "string" ? pn : undefined;
    if (Object.keys(overrides).length > 0) {
      config = deepMerge(config, overrides);
    }
  }

  // Layer 3: environment file
  const resolvedEnv = resolveEnvironmentName(envName, projectPath);
  if (resolvedEnv) {
    const envConfig = loadEnvironmentConfig(resolvedEnv);
    config = deepMerge(config, envConfig);
  }

  // Set default telemetry config if not provided
  if (!config.telemetry) {
    config.telemetry = {
      enabled: false,
      provider: "none",
    };
  }

  // projectName is .env.toml-only — not deep-merged from config.toml or environment files
  if (projectName) {
    config.projectName = projectName;
  }

  // Validate defaultAgentScale
  if (config.defaultAgentScale !== undefined) {
    if (!Number.isInteger(config.defaultAgentScale) || config.defaultAgentScale < 0) {
      throw new ConfigError("defaultAgentScale must be a non-negative integer.");
    }
  }

  return config;
}

/**
 * Update the project-level scale in config.toml
 */
export function updateProjectScale(projectPath: string, scale: number): void {
  const config = loadProjectConfig(projectPath);
  config.scale = scale;

  const configPath = resolve(projectPath, "config.toml");
  const tomlStr = stringifyTOML(config);
  writeFileSync(configPath, tomlStr);
}

/**
 * Get current project scale from config
 */
export function getProjectScale(projectPath: string): number {
  const config = loadGlobalConfig(projectPath);
  return config.scale ?? 5; // Default project scale
}
