import { readFileSync } from "fs";
import {
  listEnvironments,
  loadEnvironmentConfig,
  writeEnvironmentConfig,
  environmentExists,
  environmentPath,
} from "../../shared/environment.js";
import { ConfigError } from "../../shared/errors.js";

export async function init(name: string): Promise<void> {
  if (environmentExists(name)) {
    throw new ConfigError(
      `Environment "${name}" already exists at ${environmentPath(name)}. ` +
      `Edit it directly or remove it first.`
    );
  }

  // Create a skeleton environment file
  writeEnvironmentConfig(name, {
    cloud: {
      provider: "ecs",
      awsRegion: "us-east-1",
      ecsCluster: "action-llama",
      ecrRepository: "REPLACE_ME",
      executionRoleArn: "REPLACE_ME",
      taskRoleArn: "REPLACE_ME",
      subnets: ["REPLACE_ME"],
    } as any,
  });

  console.log(`Created environment "${name}" at ${environmentPath(name)}`);
  console.log("Edit this file to configure your cloud infrastructure settings.");
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
      const provider = config.cloud?.provider || "local";
      console.log(`  ${name} (${provider})`);
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
