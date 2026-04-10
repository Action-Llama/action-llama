/**
 * Config — discovers and validates remotes.json configuration.
 *
 * Discovery order (first found wins, no merge):
 *  1. $CWD/remotes.json
 *  2. $CWD/.pi/remotes.json
 *  3. ~/.pi/remotes.json
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

/** A single remote entry in the config. */
export interface RemoteEntry {
  /** Transport type. */
  type: "container" | "ssh" | "host-user";
  /** Docker container name (for type: "container"). */
  container?: string;
  /** SSH host (for type: "ssh"). */
  host?: string;
  /** SSH port (for type: "ssh"). */
  port?: number;
  /** SSH/host user. */
  user?: string;
  /** SSH key path (for type: "ssh"). */
  keyPath?: string;
  /** Initial working directory on the remote. */
  cwd?: string;
  /** Additional SSH options (for type: "ssh"). */
  sshOptions?: Record<string, string>;
}

/** The full remotes.json config shape. */
export interface RemotesConfig {
  /** Default remote to connect to on startup. */
  defaultRemote?: string;
  /** Named remote definitions. */
  remotes: Record<string, RemoteEntry>;
}

/** Error thrown when no remotes.json is found. */
export class RemoteNotConfiguredError extends Error {
  constructor(searchPaths: string[]) {
    super(`No remotes.json found. Searched:\n${searchPaths.map(p => `  - ${p}`).join("\n")}`);
    this.name = "RemoteNotConfiguredError";
  }
}

/** Error thrown when a remote name is not found in the config. */
export class UnknownRemoteError extends Error {
  constructor(name: string, available: string[]) {
    super(`Unknown remote "${name}". Available: ${available.join(", ") || "(none)"}`);
    this.name = "UnknownRemoteError";
  }
}

/**
 * Discover and load remotes.json from the standard search paths.
 * Returns the parsed config, or null if not found and `required` is false.
 */
export function loadRemotesConfig(cwd: string, opts?: { required?: boolean }): RemotesConfig | null {
  const searchPaths = getSearchPaths(cwd);

  for (const configPath of searchPaths) {
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      return validateConfig(parsed, configPath);
    }
  }

  if (opts?.required) {
    throw new RemoteNotConfiguredError(searchPaths);
  }

  return null;
}

/** Get the ordered search paths for remotes.json. */
function getSearchPaths(cwd: string): string[] {
  return [
    join(cwd, "remotes.json"),
    join(cwd, ".pi", "remotes.json"),
    join(homedir(), ".pi", "remotes.json"),
  ];
}

/** Validate the config shape and return a typed config. */
function validateConfig(raw: unknown, path: string): RemotesConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Invalid remotes.json at ${path}: expected an object`);
  }

  const obj = raw as Record<string, unknown>;

  if (obj.remotes != null && (typeof obj.remotes !== "object" || obj.remotes === null)) {
    throw new Error(`Invalid remotes.json at ${path}: "remotes" must be an object`);
  }

  const remotes = (obj.remotes ?? {}) as Record<string, unknown>;
  const validated: Record<string, RemoteEntry> = {};

  for (const [name, entry] of Object.entries(remotes)) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`Invalid remote "${name}" in ${path}: expected an object`);
    }

    const e = entry as Record<string, unknown>;
    const type = e.type as string;
    if (!type || !["container", "ssh", "host-user"].includes(type)) {
      throw new Error(`Invalid remote "${name}" in ${path}: "type" must be one of: container, ssh, host-user`);
    }

    validated[name] = {
      type: type as RemoteEntry["type"],
      container: e.container as string | undefined,
      host: e.host as string | undefined,
      port: e.port as number | undefined,
      user: e.user as string | undefined,
      keyPath: e.keyPath as string | undefined,
      cwd: e.cwd as string | undefined,
      sshOptions: e.sshOptions as Record<string, string> | undefined,
    };
  }

  return {
    defaultRemote: obj.defaultRemote as string | undefined,
    remotes: validated,
  };
}
