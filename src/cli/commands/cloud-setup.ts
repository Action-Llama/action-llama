import { resolve } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { select, confirm } from "@inquirer/prompts";
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml";
import { createCloudProvider } from "../../cloud/provider.js";
import { saveState, createState } from "../../cloud/state.js";

export async function execute(opts: { project: string }): Promise<void> {
  const projectPath = resolve(opts.project);
  const configPath = resolve(projectPath, "config.toml");

  console.log("\n=== Cloud Setup ===\n");

  // Check for existing cloud config
  if (existsSync(configPath)) {
    const existing = parseTOML(readFileSync(configPath, "utf-8")) as Record<string, any>;
    if (existing.cloud && existing.cloud.provider) {
      console.log(`Existing cloud config found (provider: ${existing.cloud.provider}).`);
      const proceed = await confirm({
        message: "Remove existing [cloud] config and re-configure?",
        default: true,
      });
      if (!proceed) {
        console.log("Aborted.");
        return;
      }
    }
  }

  // 1. Select provider
  const providerChoice = await select({
    message: "Cloud provider:",
    choices: [
      { name: "VPS (Vultr, etc.)", value: "vps" as const },
    ],
  });

  // 2. Run provider-specific provisioning wizard
  const stubConfig = { provider: providerChoice } as any;
  const provider = await createCloudProvider(stubConfig);
  const cloudConfig = await provider.provision();

  if (!cloudConfig) return; // provision returned early

  // 3. Write [cloud] to config.toml
  let rawConfig: Record<string, any> = {};
  if (existsSync(configPath)) {
    rawConfig = parseTOML(readFileSync(configPath, "utf-8")) as Record<string, any>;
  }

  // Strip undefined values before writing
  const cloudToWrite: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cloudConfig)) {
    if (v !== undefined) cloudToWrite[k] = v;
  }
  rawConfig.cloud = cloudToWrite;

  writeFileSync(configPath, stringifyTOML(rawConfig));
  console.log(`\nWrote [cloud] config to ${configPath}`);

  // 4. Save provisioning state
  saveState(createState(projectPath, providerChoice, []));

  console.log("\nCloud setup complete.");
}
