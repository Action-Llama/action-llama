/**
 * GCP Cloud Run interactive provisioning wizard.
 *
 * Prompts for GCP-specific configuration fields and returns them
 * as a record to be written into config.toml's [cloud] section.
 */

import { input } from "@inquirer/prompts";
import { GCP_CONSTANTS } from "./constants.js";
import { CONSTANTS } from "../../shared/constants.js";

/**
 * Prompt for GCP Cloud Run configuration fields.
 *
 * Returns the populated config fields as a Record to be merged
 * into the [cloud] section of config.toml.
 */
export async function setupGcpCloud(
  partial: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const config: Record<string, unknown> = { ...partial, provider: "cloud-run" };

  config.gcpProject = await input({ message: "GCP project ID:" });

  config.region = await input({ message: "Region:", default: "us-central1" });

  config.artifactRegistry = await input({
    message: "Artifact Registry repo:",
    default: `${config.region}-docker.pkg.dev/${config.gcpProject}/al-images`,
  });

  config.serviceAccount = await input({
    message: "Service account email (for job creation):",
    default: GCP_CONSTANTS.defaultGcpRunner(config.gcpProject as string),
  });

  const prefix = await input({
    message: "Secret prefix:",
    default: CONSTANTS.DEFAULT_SECRET_PREFIX,
  });
  if (prefix !== CONSTANTS.DEFAULT_SECRET_PREFIX) {
    config.secretPrefix = prefix;
  }

  return config;
}
