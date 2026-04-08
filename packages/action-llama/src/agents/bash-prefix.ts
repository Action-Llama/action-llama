/**
 * Ensure the packaged docker/bin directory is on PATH so shell helpers like
 * `al-export` are available in chat and local harness flows.
 */
import { dirname, resolve } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";

/**
 * Ensure the docker/bin directory (which contains al-export and other agent
 * shell scripts) is on PATH. Call this before creating an agent session in
 * contexts that don't use installSignalCommands().
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
