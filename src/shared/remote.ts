import type { CloudConfig } from "./config.js";
import type { CredentialBackend } from "./credential-backend.js";
import { FilesystemBackend } from "./filesystem-backend.js";
import { AWS_CONSTANTS } from "./aws-constants.js";

/**
 * Create a credential backend from the [cloud] config section.
 */
export async function createBackendFromCloudConfig(cloud: CloudConfig): Promise<CredentialBackend> {
  if (cloud.provider === "cloud-run") {
    if (!cloud.gcpProject) {
      throw new Error("Cloud provider 'cloud-run' requires 'gcpProject' in [cloud] config.");
    }
    const { GoogleSecretManagerBackend } = await import("./gsm-backend.js");
    return new GoogleSecretManagerBackend(cloud.gcpProject, cloud.secretPrefix || AWS_CONSTANTS.DEFAULT_SECRET_PREFIX);
  }

  if (cloud.provider === "ecs") {
    if (!cloud.awsRegion) {
      throw new Error("Cloud provider 'ecs' requires 'awsRegion' in [cloud] config.");
    }
    const { AwsSecretsManagerBackend } = await import("./asm-backend.js");
    return new AwsSecretsManagerBackend(cloud.awsRegion, cloud.awsSecretPrefix || AWS_CONSTANTS.DEFAULT_SECRET_PREFIX);
  }

  throw new Error(`Unknown cloud provider: "${cloud.provider}". Supported providers: cloud-run, ecs`);
}

/**
 * Create the local filesystem backend.
 */
export function createLocalBackend(): CredentialBackend {
  return new FilesystemBackend();
}
