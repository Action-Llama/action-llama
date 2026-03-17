import { readFileSync } from "fs";
import {
  listEnvironments,
  loadEnvironmentConfig,
  writeEnvironmentConfig,
  environmentExists,
  environmentPath,
  type EnvironmentConfig,
} from "../../shared/environment.js";
import { ConfigError } from "../../shared/errors.js";

const VALID_TYPES = ["server"] as const;
type EnvType = typeof VALID_TYPES[number];

function buildSkeleton(type: EnvType): EnvironmentConfig {
  switch (type) {
    case "server":
      return {
        server: {
          host: "REPLACE_ME",
          user: "root",
          port: 22,
          basePath: "/opt/action-llama",
        },
      };
  }
}

export async function init(name: string, type: string): Promise<void> {
  if (!VALID_TYPES.includes(type as EnvType)) {
    throw new ConfigError(
      `Unknown environment type "${type}". Must be one of: ${VALID_TYPES.join(", ")}`
    );
  }

  if (environmentExists(name)) {
    throw new ConfigError(
      `Environment "${name}" already exists at ${environmentPath(name)}. ` +
      `Edit it directly or remove it first.`
    );
  }

  writeEnvironmentConfig(name, buildSkeleton(type as EnvType));

  console.log(`Created ${type} environment "${name}" at ${environmentPath(name)}`);
  console.log("Edit this file to configure your settings.");
}

export async function list(): Promise<void> {
  const envs = listEnvironments();
  if (envs.length === 0) {
    console.log("No environments configured.");
    console.log("Run 'al env init <name>' to create one.");
    return;
  }

  console.log("Environments:");
  for (const name of envs) {
    try {
      const config = loadEnvironmentConfig(name);
      const envType = config.server ? "server" : "unknown";
      console.log(`  ${name} (${envType})`);
    } catch {
      console.log(`  ${name} (invalid config)`);
    }
  }
}

export async function show(name: string): Promise<void> {
  if (!environmentExists(name)) {
    throw new ConfigError(
      `Environment "${name}" not found. Run 'al env list' to see available environments.`
    );
  }

  const filePath = environmentPath(name);
  console.log(`Environment: ${name}`);
  console.log(`File: ${filePath}\n`);
  const content = readFileSync(filePath, "utf-8");
  console.log(content);
}
