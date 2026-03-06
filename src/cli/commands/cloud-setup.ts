import { resolve } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { select, input, confirm } from "@inquirer/prompts";
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml";
import type { CloudConfig } from "../../shared/config.js";
import { createLocalBackend, createBackendFromCloudConfig } from "../../shared/remote.js";
import { reconcileCloudIam } from "./doctor.js";
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
  const provider = await select({
    message: "Cloud provider:",
    choices: [
      { name: "GCP Cloud Run Jobs", value: "cloud-run" as const },
      { name: "AWS ECS Fargate", value: "ecs" as const },
    ],
  });

  // 2. Prompt for provider-specific fields
  const cloud: CloudConfig = { provider };

  if (provider === "cloud-run") {
    cloud.gcpProject = await input({ message: "GCP project ID:" });
    cloud.region = await input({ message: "Region:", default: "us-central1" });
    cloud.artifactRegistry = await input({
      message: "Artifact Registry repo:",
      default: `${cloud.region}-docker.pkg.dev/${cloud.gcpProject}/al-images`,
    });
    cloud.serviceAccount = await input({
      message: "Service account email (for job creation):",
      default: `al-runner@${cloud.gcpProject}.iam.gserviceaccount.com`,
    });
    const prefix = await input({ message: "Secret prefix:", default: "action-llama" });
    if (prefix !== "action-llama") cloud.secretPrefix = prefix;
  } else {
    cloud.awsRegion = await input({ message: "AWS region:", default: "us-east-1" });
    cloud.ecsCluster = await input({ message: "ECS cluster name:", default: "al-cluster" });
    cloud.ecrRepository = await input({ message: "ECR repository URI:" });
    cloud.executionRoleArn = await input({ message: "Execution role ARN:" });
    cloud.taskRoleArn = await input({ message: "Default task role ARN:" });
    const subnets = await input({ message: "Subnet IDs (comma-separated):" });
    cloud.subnets = subnets.split(",").map(s => s.trim()).filter(Boolean);
    const sgs = await input({ message: "Security group IDs (comma-separated, optional):" });
    if (sgs.trim()) {
      cloud.securityGroups = sgs.split(",").map(s => s.trim()).filter(Boolean);
    }
    const prefix = await input({ message: "Secret prefix:", default: "action-llama" });
    if (prefix !== "action-llama") cloud.awsSecretPrefix = prefix;
  }

  // 3. Write [cloud] to config.toml
  let rawConfig: Record<string, any> = {};
  if (existsSync(configPath)) {
    rawConfig = parseTOML(readFileSync(configPath, "utf-8")) as Record<string, any>;
  }

  // Strip undefined values before writing
  const cloudToWrite: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cloud)) {
    if (v !== undefined) cloudToWrite[k] = v;
  }
  rawConfig.cloud = cloudToWrite;

  writeFileSync(configPath, stringifyTOML(rawConfig));
  console.log(`\nWrote [cloud] config to ${configPath}`);

  // 4. Push credentials
  console.log(`\nPushing local credentials to ${provider}...`);
  try {
    const local = createLocalBackend();
    const remote = await createBackendFromCloudConfig(cloud);
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

      // 5. Provision IAM
      console.log(`\nProvisioning per-agent IAM resources...`);
      await reconcileCloudIam(projectPath, cloud);
    }
  } catch (err: any) {
    console.log(`\nCloud credential push/IAM failed: ${err.message}`);
    console.log("You can retry later with: al doctor -c");
  }

  console.log("\nCloud setup complete.");
}
