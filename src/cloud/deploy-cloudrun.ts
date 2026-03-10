/**
 * GCP Cloud Run service deployment for the cloud scheduler.
 *
 * Creates or updates a Cloud Run service that runs the scheduler as a
 * long-running container with an HTTPS endpoint for webhooks.
 */

import { execFileSync } from "child_process";
import { AWS_CONSTANTS } from "../shared/aws-constants.js";
import type { CloudConfig } from "../shared/config.js";

export interface CloudRunDeployOpts {
  imageUri: string;
  cloudConfig: CloudConfig;
  port?: number;
  envVars?: Record<string, string>;
}

export interface CloudRunServiceInfo {
  serviceName: string;
  serviceUrl: string;
  status: string;
  region: string;
}

/**
 * Deploy (create or update) the scheduler as a Cloud Run service.
 */
export async function deployCloudRun(opts: CloudRunDeployOpts): Promise<CloudRunServiceInfo> {
  const { imageUri, cloudConfig, port = 8080, envVars = {} } = opts;
  const { gcpProject, region, serviceAccount } = cloudConfig;

  if (!gcpProject || !region) {
    throw new Error("cloud.gcpProject and cloud.region are required for Cloud Run deployment.");
  }

  const serviceName = AWS_CONSTANTS.SCHEDULER_CLOUD_RUN_SERVICE;
  const cpu = cloudConfig.schedulerCpu || "1";
  const memory = cloudConfig.schedulerMemory || "512Mi";

  // Build env var flags
  const envParts: string[] = [];
  for (const [key, value] of Object.entries(envVars)) {
    envParts.push(`${key}=${value}`);
  }
  const envFlag = envParts.length > 0 ? envParts.join(",") : undefined;

  const args = [
    "run", "deploy", serviceName,
    "--image", imageUri,
    "--project", gcpProject,
    "--region", region,
    "--port", String(port),
    "--cpu", cpu,
    "--memory", memory,
    "--min-instances", "1",
    "--max-instances", "1",
    "--allow-unauthenticated",
    "--quiet",
  ];

  if (serviceAccount) {
    args.push("--service-account", serviceAccount);
  }

  if (envFlag) {
    args.push("--set-env-vars", envFlag);
  }

  gcloud(args);

  // Get the service URL
  const url = gcloud([
    "run", "services", "describe", serviceName,
    "--project", gcpProject,
    "--region", region,
    "--format", "value(status.url)",
  ]);

  return {
    serviceName,
    serviceUrl: url,
    status: "RUNNING",
    region: region!,
  };
}

/**
 * Get the current status of the scheduler Cloud Run service.
 */
export async function getCloudRunStatus(cloudConfig: CloudConfig): Promise<CloudRunServiceInfo | null> {
  const { gcpProject, region } = cloudConfig;
  if (!gcpProject || !region) return null;

  const serviceName = AWS_CONSTANTS.SCHEDULER_CLOUD_RUN_SERVICE;

  try {
    const url = gcloud([
      "run", "services", "describe", serviceName,
      "--project", gcpProject,
      "--region", region,
      "--format", "value(status.url)",
    ]);

    const conditions = gcloud([
      "run", "services", "describe", serviceName,
      "--project", gcpProject,
      "--region", region,
      "--format", "value(status.conditions[0].type)",
    ]);

    return {
      serviceName,
      serviceUrl: url,
      status: conditions || "UNKNOWN",
      region,
    };
  } catch (err: any) {
    if (err.message?.includes("NOT_FOUND") || err.message?.includes("could not be found")) {
      return null;
    }
    throw err;
  }
}

/**
 * Fetch recent scheduler logs from Cloud Logging.
 */
export async function getCloudRunLogs(cloudConfig: CloudConfig, limit: number): Promise<string[]> {
  const { gcpProject, region } = cloudConfig;
  if (!gcpProject || !region) return [];

  const serviceName = AWS_CONSTANTS.SCHEDULER_CLOUD_RUN_SERVICE;

  try {
    const output = gcloud([
      "logging", "read",
      `resource.type="cloud_run_revision" AND resource.labels.service_name="${serviceName}"`,
      "--project", gcpProject,
      "--limit", String(limit),
      "--format", "value(textPayload)",
      "--freshness", "1d",
    ]);

    return output.split("\n").filter(Boolean).reverse();
  } catch {
    return [];
  }
}

/**
 * Delete the scheduler Cloud Run service.
 */
export async function teardownCloudRunService(cloudConfig: CloudConfig): Promise<void> {
  const { gcpProject, region } = cloudConfig;
  if (!gcpProject || !region) {
    console.log("  Incomplete GCP config. Skipping Cloud Run service teardown.");
    return;
  }

  const serviceName = AWS_CONSTANTS.SCHEDULER_CLOUD_RUN_SERVICE;

  try {
    gcloud([
      "run", "services", "delete", serviceName,
      "--project", gcpProject,
      "--region", region,
      "--quiet",
    ]);
    console.log(`  Deleted Cloud Run service: ${serviceName}`);
  } catch (err: any) {
    if (err.message?.includes("NOT_FOUND") || err.message?.includes("could not be found")) {
      console.log(`  Cloud Run service not found (already deleted)`);
    } else {
      console.log(`  Warning: ${err.message}`);
    }
  }
}

function gcloud(args: string[]): string {
  return execFileSync("gcloud", args, {
    encoding: "utf-8",
    timeout: 120_000,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
