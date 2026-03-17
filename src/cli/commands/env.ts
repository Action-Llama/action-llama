import { readFileSync, unlinkSync } from "fs";
import {
  listEnvironments,
  loadEnvironmentConfig,
  writeEnvironmentConfig,
  environmentExists,
  environmentPath,
  loadEnvToml,
  writeEnvToml,
  type EnvironmentConfig,
} from "../../shared/environment.js";
import { ConfigError } from "../../shared/errors.js";
import { VPS_CONSTANTS } from "../../cloud/vps/constants.js";

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

export async function set(name: string, opts: { project: string }): Promise<void> {
  if (!environmentExists(name)) {
    console.warn(`Warning: environment "${name}" does not exist yet. You can create it with 'al env init ${name}'.`);
  }

  writeEnvToml(opts.project, { environment: name });
  console.log(`Project bound to environment "${name}".`);
}

export async function prov(name: string): Promise<void> {
  // If env already exists with a real host, skip
  if (environmentExists(name)) {
    const existing = loadEnvironmentConfig(name);
    if (existing.server?.host && existing.server.host !== "REPLACE_ME") {
      console.log(`Environment "${name}" already has a server at ${existing.server.host}. Skipping provisioning.`);
      return;
    }
  }

  const { setupVpsCloud } = await import("../../cloud/vps/provision.js");
  const result = await setupVpsCloud();
  if (!result) return;

  const host = result.host as string;
  const config: EnvironmentConfig = {
    server: {
      host,
      user: (result.sshUser as string) ?? VPS_CONSTANTS.DEFAULT_SSH_USER,
      port: (result.sshPort as number) ?? VPS_CONSTANTS.DEFAULT_SSH_PORT,
      basePath: "/opt/action-llama",
      provider: (result.provider as string) ?? "vps",
      vultrInstanceId: result.vultrInstanceId as string | undefined,
      vultrRegion: result.vultrRegion as string | undefined,
    },
    gateway: { url: `http://${host}:${VPS_CONSTANTS.DEFAULT_GATEWAY_PORT}` },
  };

  writeEnvironmentConfig(name, config);
  console.log(`Environment "${name}" created at ${environmentPath(name)}`);
}

export async function deprov(name: string, opts: { project: string }): Promise<void> {
  if (!environmentExists(name)) {
    throw new ConfigError(
      `Environment "${name}" not found. Run 'al env list' to see available environments.`
    );
  }

  const config = loadEnvironmentConfig(name);
  if (!config.server) {
    throw new ConfigError(`Environment "${name}" has no [server] config — nothing to deprovision.`);
  }

  const { teardownVps } = await import("../../cloud/vps/teardown.js");
  const vpsConfig = {
    provider: "vps" as const,
    host: config.server.host,
    sshUser: config.server.user,
    sshPort: config.server.port,
    sshKeyPath: config.server.keyPath,
    vultrInstanceId: config.server.vultrInstanceId,
    vultrRegion: config.server.vultrRegion,
  };

  await teardownVps(opts.project, vpsConfig);

  // Delete environment file
  unlinkSync(environmentPath(name));
  console.log(`Environment "${name}" deleted.`);

  // Clear .env.toml binding if it points to this env
  const envToml = loadEnvToml(opts.project);
  if (envToml?.environment === name) {
    writeEnvToml(opts.project, { environment: undefined });
    console.log(`Cleared environment binding in .env.toml.`);
  }
}
