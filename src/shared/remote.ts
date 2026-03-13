import type { CloudConfig } from "./config.js";
import type { CredentialBackend } from "./credential-backend.js";
import { FilesystemBackend } from "./filesystem-backend.js";

/**
 * Create a credential backend from the [cloud] config section.
 * Delegates to the appropriate CloudProvider implementation.
 */
export async function createBackendFromCloudConfig(cloud: CloudConfig): Promise<CredentialBackend> {
  const { createCloudProvider } = await import("../cloud/provider.js");
  const provider = await createCloudProvider(cloud);
  return provider.createCredentialBackend();
}

/**
 * Create the local filesystem backend.
 */
export function createLocalBackend(): CredentialBackend {
  return new FilesystemBackend();
}
