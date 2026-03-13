import { resolve } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { confirm } from "@inquirer/prompts";
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml";
import type { CloudConfig } from "../../shared/config.js";
import { createCloudProvider } from "../../cloud/provider.js";
import { deleteState } from "../../cloud/state.js";

export async function execute(opts: { project: string }): Promise<void> {
  const projectPath = resolve(opts.project);
  const configPath = resolve(projectPath, "config.toml");

  if (!existsSync(configPath)) {
    console.log("No config.toml found. Nothing to tear down.");
    return;
  }

  const rawConfig = parseTOML(readFileSync(configPath, "utf-8")) as Record<string, any>;
  const cloud = rawConfig.cloud as CloudConfig | undefined;

  if (!cloud || !cloud.provider) {
    console.log("No [cloud] section in config.toml. Nothing to tear down.");
    return;
  }

  console.log(`\n=== Cloud Teardown (${cloud.provider}) ===\n`);

  const ok = await confirm({
    message: "This will delete the cloud scheduler, per-agent IAM resources, and remove the [cloud] config. Continue?",
    default: false,
  });
  if (!ok) {
    console.log("Aborted.");
    return;
  }

  await teardownCloud(projectPath, cloud);

  // Remove [cloud] from config.toml
  delete rawConfig.cloud;
  writeFileSync(configPath, stringifyTOML(rawConfig));
  console.log(`Removed [cloud] section from ${configPath}`);

  // Delete state file
  deleteState(projectPath);

  console.log("\nCloud teardown complete.");
}

export async function teardownCloud(projectPath: string, cloud: CloudConfig): Promise<void> {
  const provider = await createCloudProvider(cloud);
  await provider.teardown(projectPath);
}
