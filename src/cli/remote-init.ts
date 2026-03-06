import { resolve } from "path";
import { resolveRemote } from "../shared/config.js";
import { createBackendForRemote } from "../shared/remote.js";
import { setDefaultBackend } from "../shared/credentials.js";

/**
 * Initialize the default credential backend from a named remote.
 * Called before command execution when --remote is passed.
 */
export async function initRemoteBackend(projectDir: string, remoteName: string): Promise<void> {
  const projectPath = resolve(projectDir);
  const remoteConfig = resolveRemote(projectPath, remoteName);
  const backend = await createBackendForRemote(remoteConfig);
  setDefaultBackend(backend);
}
