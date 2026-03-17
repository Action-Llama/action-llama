import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from "fs";
import { resolve, basename } from "path";
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml";
import { ENVIRONMENTS_DIR } from "./paths.js";
import { ConfigError } from "./errors.js";
import type { CloudConfig } from "./config.js";

export interface EnvironmentConfig {
  cloud?: CloudConfig;
  gateway?: { url?: string; port?: number; lockTimeout?: number };
  telemetry?: { enabled?: boolean; provider?: string; endpoint?: string; serviceName?: string; headers?: Record<string, string>; samplingRate?: number };
}

export interface EnvToml {
  environment?: string;
  [key: string]: unknown;
}

/**
 * Load .env.toml from the project directory.
 * Returns undefined if the file does not exist.
 */
export function loadEnvToml(projectPath: string): EnvToml | undefined {
  const envPath = resolve(projectPath, ".env.toml");
  if (!existsSync(envPath)) return undefined;
  const raw = readFileSync(envPath, "utf-8");
  return parseTOML(raw) as unknown as EnvToml;
}

/**
 * Load an environment config from ~/.action-llama/environments/<name>.toml.
 * Throws if the named environment does not exist.
 */
export function loadEnvironmentConfig(name: string): EnvironmentConfig {
  const envPath = resolve(ENVIRONMENTS_DIR, `${name}.toml`);
  if (!existsSync(envPath)) {
    throw new ConfigError(
      `Environment "${name}" not found at ${envPath}. ` +
      `Run 'al env init ${name}' to create it, or 'al env list' to see available environments.`
    );
  }
  const raw = readFileSync(envPath, "utf-8");
  return parseTOML(raw) as unknown as EnvironmentConfig;
}

/**
 * Resolve the environment name from (in priority order):
 * 1. --env CLI flag
 * 2. AL_ENV environment variable
 * 3. .env.toml's `environment` field
 *
 * Returns undefined if no environment is specified (local-only mode).
 */
export function resolveEnvironmentName(
  cliEnv: string | undefined,
  projectPath: string,
): string | undefined {
  if (cliEnv) return cliEnv;
  if (process.env.AL_ENV) return process.env.AL_ENV;
  const envToml = loadEnvToml(projectPath);
  return envToml?.environment;
}

/**
 * List all available environment names.
 */
export function listEnvironments(): string[] {
  if (!existsSync(ENVIRONMENTS_DIR)) return [];
  return readdirSync(ENVIRONMENTS_DIR)
    .filter((f) => f.endsWith(".toml"))
    .map((f) => basename(f, ".toml"))
    .sort();
}

/**
 * Check if a named environment exists.
 */
export function environmentExists(name: string): boolean {
  return existsSync(resolve(ENVIRONMENTS_DIR, `${name}.toml`));
}

/**
 * Create a new environment file with the given config.
 */
export function writeEnvironmentConfig(name: string, config: EnvironmentConfig): void {
  mkdirSync(ENVIRONMENTS_DIR, { recursive: true });
  const envPath = resolve(ENVIRONMENTS_DIR, `${name}.toml`);
  writeFileSync(envPath, stringifyTOML(config as Record<string, unknown>) + "\n");
}

/**
 * Get the full path to an environment file.
 */
export function environmentPath(name: string): string {
  return resolve(ENVIRONMENTS_DIR, `${name}.toml`);
}

/**
 * Deep merge two objects. Later values win. Arrays are replaced, not concatenated.
 */
export function deepMerge<T extends Record<string, any>>(base: T, override: Record<string, any>): T {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    const val = override[key];
    if (val === undefined) continue;
    if (
      val !== null &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      typeof result[key] === "object" &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      (result as any)[key] = deepMerge(result[key], val);
    } else {
      (result as any)[key] = val;
    }
  }
  return result;
}
