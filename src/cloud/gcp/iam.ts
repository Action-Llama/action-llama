/**
 * GCP IAM reconciliation for per-agent service accounts and secret bindings.
 *
 * Extracted from cli/commands/cloud-iam.ts — handles the GCP-specific
 * service account creation and GSM secret binding logic.
 */

import { execFileSync } from "child_process";
import { confirm } from "@inquirer/prompts";
import { discoverAgents, loadAgentConfig } from "../../shared/config.js";
import type { CloudRunCloudConfig } from "../../shared/config.js";
import { parseCredentialRef } from "../../shared/credentials.js";
import { GCP_CONSTANTS } from "./constants.js";
import { CONSTANTS } from "../../shared/constants.js";
import { ConfigError, CloudProviderError } from "../../shared/errors.js";

/**
 * Reconcile per-agent GCP service accounts and GSM secret bindings.
 *
 * For each discovered agent:
 * 1. Creates a dedicated GCP service account (idempotent)
 * 2. Binds secretmanager.secretAccessor on each secret the agent declares
 * 3. Grants iam.serviceAccountUser so the SA can run Cloud Run jobs
 */
export async function reconcileGcpAgents(projectPath: string, cloud: CloudRunCloudConfig): Promise<void> {
  const { gcpProject, secretPrefix: configPrefix } = cloud;
  if (!gcpProject) {
    throw new ConfigError("cloud.gcpProject is required in config.toml");
  }

  const secretPrefix = configPrefix || CONSTANTS.DEFAULT_SECRET_PREFIX;

  // Verify gcloud is available and authenticated
  try {
    gcloud(["auth", "print-access-token"], gcpProject);
  } catch (err: any) {
    throw new CloudProviderError(
      "gcloud CLI is not authenticated. Run 'gcloud auth login' first.\n" +
      `Original error: ${err.message}`
    );
  }

  const agents = discoverAgents(projectPath);
  if (agents.length === 0) {
    console.log("No agents found. Create agents first.");
    return;
  }

  // Pre-flight: check if any secrets exist in GSM with this prefix
  const preflight = listGsmSecretCount(gcpProject, secretPrefix);
  if (preflight === 0) {
    console.log(
      `\nWarning: No secrets found in GSM with prefix "${secretPrefix}".\n` +
      `IAM bindings are created against existing secrets, so you should push credentials first.\n`
    );
    const proceed = await confirm({
      message: "Continue anyway? (Service accounts will be created but no secrets will be bound)",
      default: false,
    });
    if (!proceed) {
      console.log("Aborted. Push credentials first, then re-run.");
      return;
    }
  }

  console.log(`\nSetting up Cloud Run service accounts for ${agents.length} agent(s)...\n`);

  for (const name of agents) {
    const config = loadAgentConfig(projectPath, name);
    const saName = GCP_CONSTANTS.serviceAccountName(name);
    const saEmail = GCP_CONSTANTS.serviceAccountEmail(name, gcpProject);

    console.log(`  Agent: ${name}`);
    console.log(`    SA: ${saEmail}`);

    // 1. Create service account (idempotent)
    try {
      gcloud([
        "iam", "service-accounts", "create", saName,
        "--display-name", `Action Llama agent: ${name}`,
        "--project", gcpProject,
      ], gcpProject);
      console.log(`    Created service account`);
    } catch (err: any) {
      if (err.message?.includes("already exists")) {
        console.log(`    Service account already exists`);
      } else {
        throw err;
      }
    }

    // 2. Collect all secret names this agent needs
    const credRefs = [...new Set(config.credentials)];
    if (config.model.authType !== "pi_auth" && !credRefs.includes("anthropic_key:default")) {
      credRefs.push("anthropic_key:default");
    }

    const secretNames: string[] = [];
    for (const ref of credRefs) {
      const { type, instance } = parseCredentialRef(ref);
      const fields = listGsmFields(gcpProject, secretPrefix, type, instance);
      for (const field of fields) {
        secretNames.push(`${secretPrefix}--${type}--${instance}--${field}`);
      }
    }

    // 3. Grant secretmanager.secretAccessor on each secret
    let boundCount = 0;
    for (const secretName of secretNames) {
      try {
        gcloud([
          "secrets", "add-iam-policy-binding", secretName,
          "--member", `serviceAccount:${saEmail}`,
          "--role", "roles/secretmanager.secretAccessor",
          "--project", gcpProject,
        ], gcpProject);
        boundCount++;
      } catch (err: any) {
        if (err.message?.includes("already exists") || err.message?.includes("already has")) {
          boundCount++;
        } else {
          console.log(`    Warning: failed to bind ${secretName}: ${err.message}`);
        }
      }
    }
    console.log(`    Bound ${boundCount} secret(s)`);

    // 4. Grant the SA permission to act as itself (for Cloud Run job execution)
    try {
      gcloud([
        "iam", "service-accounts", "add-iam-policy-binding", saEmail,
        "--member", `serviceAccount:${saEmail}`,
        "--role", "roles/iam.serviceAccountUser",
        "--project", gcpProject,
      ], gcpProject);
    } catch {
      // May already be bound
    }

    console.log("");
  }

  console.log("Done. Each agent now has an isolated service account with access to only its declared secrets.");
}

// --- Helpers ---

export function gcloud(args: string[], _project: string): string {
  return execFileSync("gcloud", args, {
    encoding: "utf-8",
    timeout: 30_000,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

export function listGsmSecretCount(gcpProject: string, prefix: string): number {
  try {
    const output = gcloud([
      "secrets", "list",
      "--filter", `name:${prefix}--`,
      "--format", "value(name)",
      "--project", gcpProject,
    ], gcpProject);
    if (!output.trim()) return 0;
    return output.trim().split("\n").length;
  } catch {
    return 0;
  }
}

export function listGsmFields(
  gcpProject: string,
  prefix: string,
  type: string,
  instance: string
): string[] {
  const filter = `name:${prefix}--${type}--${instance}--`;
  try {
    const output = gcloud([
      "secrets", "list",
      "--filter", filter,
      "--format", "value(name)",
      "--project", gcpProject,
    ], gcpProject);

    if (!output.trim()) return [];

    const fields: string[] = [];
    for (const line of output.split("\n")) {
      const secretId = line.trim().split("/").pop()!;
      const parts = secretId.split("--");
      if (parts.length === 4 && parts[0] === prefix && parts[1] === type && parts[2] === instance) {
        fields.push(parts[3]);
      }
    }
    return fields;
  } catch {
    return [];
  }
}
