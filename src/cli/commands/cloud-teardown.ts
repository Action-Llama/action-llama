import { resolve } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { confirm } from "@inquirer/prompts";
import { execFileSync } from "child_process";
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml";
import { discoverAgents } from "../../shared/config.js";
import type { CloudConfig } from "../../shared/config.js";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { IAMClient, DeleteRolePolicyCommand, DeleteRoleCommand } from "@aws-sdk/client-iam";
import { AWS_CONSTANTS } from "../../shared/aws-constants.js";

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

  console.log("\nCloud teardown complete.");
}

export async function teardownCloud(projectPath: string, cloud: CloudConfig): Promise<void> {
  if (cloud.provider === "cloud-run") {
    await teardownGcp(projectPath, cloud);
  } else if (cloud.provider === "ecs") {
    await teardownAws(projectPath, cloud);
  } else {
    throw new Error(`Unknown cloud provider: "${cloud.provider}"`);
  }
}

async function teardownGcp(projectPath: string, cloud: CloudConfig): Promise<void> {
  const { gcpProject } = cloud;
  if (!gcpProject) {
    console.log("Incomplete GCP config (no project). Skipping teardown.");
    return;
  }

  try {
    gcloud(["auth", "print-access-token"], gcpProject);
  } catch (err: any) {
    throw new Error(
      "gcloud CLI is not authenticated. Run 'gcloud auth login' first.\n" +
      `Original error: ${err.message}`
    );
  }

  // Tear down scheduler Cloud Run service
  console.log("Removing Cloud Run scheduler service...");
  const { teardownCloudRunService } = await import("../../cloud/deploy-cloudrun.js");
  await teardownCloudRunService(cloud);
  console.log("");

  const agents = discoverAgents(projectPath);
  if (agents.length === 0) {
    console.log("No agents found. Skipping IAM teardown.");
    return;
  }

  console.log(`Removing Cloud Run service accounts for ${agents.length} agent(s)...\n`);

  for (const name of agents) {
    const saName = AWS_CONSTANTS.serviceAccountName(name);
    const saEmail = AWS_CONSTANTS.serviceAccountEmail(name, gcpProject);

    console.log(`  Agent: ${name}`);
    console.log(`    Deleting SA: ${saEmail}`);

    try {
      gcloud([
        "iam", "service-accounts", "delete", saEmail,
        "--quiet",
        "--project", gcpProject,
      ], gcpProject);
      console.log(`    Deleted`);
    } catch (err: any) {
      if (err.message?.includes("NOT_FOUND") || err.message?.includes("not found")) {
        console.log(`    Not found (already deleted)`);
      } else {
        console.log(`    Warning: ${err.message}`);
      }
    }
    console.log("");
  }
}

async function teardownAws(projectPath: string, cloud: CloudConfig): Promise<void> {
  const { awsRegion } = cloud;
  if (!awsRegion) {
    console.log("Incomplete AWS config (no region). Skipping IAM teardown.");
    return;
  }

  const stsClient = new STSClient({ region: awsRegion });
  const iamClient = new IAMClient({ region: awsRegion });

  try {
    await stsClient.send(new GetCallerIdentityCommand({}));
  } catch (err: any) {
    throw new Error(
      "AWS CLI is not authenticated. Run 'aws configure' or set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY.\n" +
      `Original error: ${err.message}`
    );
  }

  const agents = discoverAgents(projectPath);
  if (agents.length === 0) {
    console.log("No agents found. Skipping IAM teardown.");
    return;
  }

  // Tear down scheduler App Runner service
  console.log("Removing App Runner scheduler service...");
  const { teardownAppRunner } = await import("../../cloud/deploy-apprunner.js");
  await teardownAppRunner(cloud);
  console.log("");

  console.log(`Removing ECS task roles for ${agents.length} agent(s)...\n`);

  for (const name of agents) {
    const roleName = AWS_CONSTANTS.taskRoleName(name);

    console.log(`  Agent: ${name}`);
    console.log(`    Deleting role: ${roleName}`);

    // Must delete inline policies before deleting the role
    try {
      await iamClient.send(new DeleteRolePolicyCommand({
        RoleName: roleName,
        PolicyName: "SecretsAccess",
      }));
    } catch {
      // Policy may not exist
    }

    try {
      await iamClient.send(new DeleteRoleCommand({
        RoleName: roleName,
      }));
      console.log(`    Deleted`);
    } catch (err: any) {
      if (err.name === "NoSuchEntityException") {
        console.log(`    Not found (already deleted)`);
      } else {
        console.log(`    Warning: ${err.message}`);
      }
    }
    console.log("");
  }
}

function gcloud(args: string[], _project: string): string {
  return execFileSync("gcloud", args, {
    encoding: "utf-8",
    timeout: 30_000,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
