/**
 * GCP Cloud Run teardown — removes per-agent service accounts
 * and the scheduler Cloud Run service.
 */

import { execFileSync } from "child_process";
import { discoverAgents } from "../../shared/config.js";
import type { CloudRunCloudConfig } from "../../shared/config.js";
import { GCP_CONSTANTS } from "./constants.js";
import { teardownCloudRunService } from "./deploy.js";

/**
 * Tear down all GCP resources provisioned for this project:
 * 1. Scheduler Cloud Run service
 * 2. Per-agent GCP service accounts
 */
export async function teardownGcp(projectPath: string, cloud: CloudRunCloudConfig): Promise<void> {
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
  await teardownCloudRunService(cloud);
  console.log("");

  const agents = discoverAgents(projectPath);
  if (agents.length === 0) {
    console.log("No agents found. Skipping IAM teardown.");
    return;
  }

  console.log(`Removing Cloud Run service accounts for ${agents.length} agent(s)...\n`);

  for (const name of agents) {
    const saEmail = GCP_CONSTANTS.serviceAccountEmail(name, gcpProject);

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

function gcloud(args: string[], _project: string): string {
  return execFileSync("gcloud", args, {
    encoding: "utf-8",
    timeout: 30_000,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
