/**
 * Bash command prefix injected before every agent shell command.
 *
 * Sources `al-bash-init.sh` which defines the `setenv` helper and restores
 * persisted environment variables. The script must be on PATH:
 *  - Docker agents: baked into `/app/bin/` via Dockerfile COPY
 *  - Host-user scheduled agents: copied to temp bin dir via installSignalCommands()
 *  - Host-user run/chat: added to PATH via ensureBinDir()
 */
import { dirname, resolve } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";

export const BASH_COMMAND_PREFIX = ". al-bash-init.sh";

/**
 * Ensure the docker/bin directory (which contains al-bash-init.sh and other
 * agent shell scripts) is on PATH. Call this before creating an agent session
 * in contexts that don't use installSignalCommands() (e.g. chat mode).
 *
 * No-op if the directory is already on PATH or doesn't exist.
 */
export function ensureBinDir(): void {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const binDir = resolve(thisDir, "..", "..", "docker", "bin");
  if (!existsSync(binDir)) return;
  const currentPath = process.env.PATH || "";
  if (currentPath.split(":").includes(binDir)) return;
  process.env.PATH = `${binDir}:${currentPath}`;
}
