import { resolve } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml";
import type { GlobalConfig, RemoteConfig } from "../../shared/config.js";

function loadRawConfig(projectPath: string): Record<string, any> {
  const configPath = resolve(projectPath, "config.toml");
  if (!existsSync(configPath)) return {};
  return parseTOML(readFileSync(configPath, "utf-8")) as Record<string, any>;
}

function saveConfig(projectPath: string, config: Record<string, any>): void {
  const configPath = resolve(projectPath, "config.toml");
  writeFileSync(configPath, stringifyTOML(config));
}

export async function executeAdd(
  name: string,
  opts: { project: string; provider: string; gcpProject?: string; awsRegion?: string; secretPrefix?: string }
): Promise<void> {
  const projectPath = resolve(opts.project);
  const config = loadRawConfig(projectPath);

  if (!config.remotes) config.remotes = {};
  if (config.remotes[name]) {
    throw new Error(`Remote "${name}" already exists. Remove it first with 'al remote remove ${name}'.`);
  }

  if (opts.provider === "gsm" && !opts.gcpProject) {
    throw new Error("--gcp-project is required for the 'gsm' provider.");
  }

  if (opts.provider === "asm" && !opts.awsRegion) {
    throw new Error("--aws-region is required for the 'asm' provider.");
  }

  const remote: Record<string, string> = { provider: opts.provider };
  if (opts.gcpProject) remote.gcpProject = opts.gcpProject;
  if (opts.awsRegion) remote.awsRegion = opts.awsRegion;
  if (opts.secretPrefix) remote.secretPrefix = opts.secretPrefix;

  config.remotes[name] = remote;
  saveConfig(projectPath, config);
  console.log(`Remote "${name}" added (provider: ${opts.provider}).`);
}

export async function executeList(opts: { project: string }): Promise<void> {
  const projectPath = resolve(opts.project);
  const config = loadRawConfig(projectPath);
  const remotes = config.remotes as Record<string, RemoteConfig> | undefined;

  if (!remotes || Object.keys(remotes).length === 0) {
    console.log("No remotes configured. Add one with: al remote add <name> --provider <gsm|asm> [options]");
    return;
  }

  for (const [name, remote] of Object.entries(remotes)) {
    const details = [`provider: ${remote.provider}`];
    if (remote.gcpProject) details.push(`gcpProject: ${remote.gcpProject}`);
    if (remote.awsRegion) details.push(`awsRegion: ${remote.awsRegion}`);
    if (remote.secretPrefix) details.push(`prefix: ${remote.secretPrefix}`);
    console.log(`  ${name}  (${details.join(", ")})`);
  }
}

export async function executeRemove(name: string, opts: { project: string }): Promise<void> {
  const projectPath = resolve(opts.project);
  const config = loadRawConfig(projectPath);

  if (!config.remotes?.[name]) {
    throw new Error(`Remote "${name}" not found.`);
  }

  delete config.remotes[name];
  if (Object.keys(config.remotes).length === 0) delete config.remotes;
  saveConfig(projectPath, config);
  console.log(`Remote "${name}" removed.`);
}
