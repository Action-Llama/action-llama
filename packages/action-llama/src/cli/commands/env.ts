import { readFileSync } from "fs";
import {
  listEnvironments,
  loadEnvironmentConfig,
  environmentExists,
  environmentPath,
  writeEnvToml,
  resolveEnvironmentName,
} from "../../shared/environment.js";
import { ConfigError } from "../../shared/errors.js";

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
      loadEnvironmentConfig(name);
      console.log(`  ${name}`);
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

export async function set(name: string | undefined, opts: { project: string }): Promise<void> {
  if (name) {
    if (!environmentExists(name)) {
      console.warn(`Warning: environment "${name}" does not exist yet. You can create it with 'al env init ${name}'.`);
    }
    writeEnvToml(opts.project, { environment: name });
    console.log(`Project bound to environment "${name}".`);
  } else {
    writeEnvToml(opts.project, { environment: undefined });
    console.log("Environment binding cleared. Commands will use the local scheduler.");
  }
}
