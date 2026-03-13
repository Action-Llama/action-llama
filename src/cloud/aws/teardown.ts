/**
 * AWS teardown logic for ECS cloud resources.
 *
 * Extracted from cli/commands/cloud-teardown.ts into the cloud provider module.
 * Tears down App Runner scheduler service and per-agent IAM task roles.
 */

import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { IAMClient, DeleteRolePolicyCommand, DeleteRoleCommand } from "@aws-sdk/client-iam";
import { discoverAgents } from "../../shared/config.js";
import type { EcsCloudConfig } from "../../shared/config.js";
import { AWS_CONSTANTS } from "./constants.js";
import { teardownAppRunner } from "./deploy.js";

/**
 * Tear down all AWS ECS cloud resources for a project.
 *
 * Removes the App Runner scheduler service and deletes per-agent
 * IAM task roles (with their inline policies).
 */
export async function teardownAws(projectPath: string, cloud: EcsCloudConfig): Promise<void> {
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
