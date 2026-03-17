import { resolve } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { select, confirm } from "@inquirer/prompts";
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml";
import type { CloudConfig } from "../../shared/config.js";
import { createLocalBackend, createBackendFromCloudConfig } from "../../shared/remote.js";
import { createCloudProvider } from "../../cloud/provider.js";
import { saveState, createState } from "../../cloud/state.js";
import { teardownCloud } from "./cloud-teardown.js";

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
        message: "Tear down existing cloud infrastructure before re-configuring?",
        default: true,
      });
      if (proceed) {
        await teardownCloud(projectPath, existing.cloud as CloudConfig);
      } else {
        const skip = await confirm({
          message: "Continue setup anyway (will overwrite [cloud] config)?",
          default: false,
        });
        if (!skip) {
          console.log("Aborted.");
          return;
        }
      }
    }
  }

  // 1. Select provider
  const providerChoice = await select({
    message: "Cloud provider:",
    choices: [
      { name: "GCP Cloud Run Jobs", value: "cloud-run" as const },
      { name: "AWS ECS Fargate", value: "ecs" as const },
      { name: "VPS (Vultr, etc.)", value: "vps" as const },
    ],
  });

  // 2. Run provider-specific provisioning wizard
  // Create a temporary provider with minimal config to access provision()
  const stubConfig = { provider: providerChoice } as any;
  const provider = await createCloudProvider(stubConfig);
  const cloudConfig = await provider.provision();

  if (!cloudConfig) return; // provision returned early (e.g. no AWS creds)

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

  // 5. Push credentials
  console.log(`\nPushing local credentials to ${providerChoice}...`);
  try {
    const local = createLocalBackend();
    const remote = await createBackendFromCloudConfig(cloudConfig as unknown as CloudConfig);
    const localEntries = await local.list();

    if (localEntries.length === 0) {
      console.log("No local credentials found. Run 'al doctor' to configure them, then 'al doctor -c' to push.");
    } else {
      let pushed = 0;
      for (const entry of localEntries) {
        const value = await local.read(entry.type, entry.instance, entry.field);
        if (value !== undefined) {
          await remote.write(entry.type, entry.instance, entry.field, value);
          pushed++;
        }
      }
      console.log(`Pushed ${pushed} credential field(s).`);

      // 6. Provision IAM
      console.log(`\nProvisioning per-agent IAM resources...`);
      const fullProvider = await createCloudProvider(cloudConfig as unknown as CloudConfig);
      await fullProvider.reconcileAgents(projectPath);
    }
  } catch (err: any) {
    console.log(`\nCloud credential push/IAM failed: ${err.message}`);
    console.log("You can retry later with: al doctor -c");
  }

  console.log("\nCloud setup complete.");
}
