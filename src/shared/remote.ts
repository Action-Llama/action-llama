import type { RemoteConfig } from "./config.js";
import type { CredentialBackend } from "./credential-backend.js";
import { FilesystemBackend } from "./filesystem-backend.js";

/**
 * Create a credential backend for the given remote config.
 * Returns a FilesystemBackend if no remote is specified.
 */
export async function createBackendForRemote(remote: RemoteConfig): Promise<CredentialBackend> {
  if (remote.provider === "gsm") {
    if (!remote.gcpProject) {
      throw new Error("Remote provider 'gsm' requires 'gcpProject' to be set.");
    }
    const { GoogleSecretManagerBackend } = await import("./gsm-backend.js");
    return new GoogleSecretManagerBackend(remote.gcpProject, remote.secretPrefix || "action-llama");
  }

  throw new Error(`Unknown remote provider: "${remote.provider}". Supported providers: gsm`);
}

/**
 * Create the local filesystem backend.
 */
export function createLocalBackend(): CredentialBackend {
  return new FilesystemBackend();
}
