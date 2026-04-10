/**
 * Command handler for the /remote command.
 *
 * Usage:
 *   /remote           — show current binding
 *   /remote <name>    — switch to a named remote
 *   /remote local     — unbind from remote, restore local tools
 */

import type { RemoteBinding } from "./binding.js";
import type { RemotesConfig } from "./config.js";

export interface RemoteCommandResult {
  message: string;
  error?: boolean;
}

/**
 * Handle the /remote command.
 *
 * @param args - The arguments passed to the command (may be empty)
 * @param binding - The current remote binding state
 * @param config - The loaded remotes config (may be null)
 */
export async function handleRemoteCommand(
  args: string,
  binding: RemoteBinding,
  config: RemotesConfig | null,
): Promise<RemoteCommandResult> {
  const trimmed = args.trim();

  // No args: show current binding
  if (!trimmed) {
    if (binding.isBound) {
      return {
        message: `Connected to remote "${binding.name}" (${binding.entry!.type})${binding.cwd ? ` at ${binding.cwd}` : ""}`,
      };
    }
    return { message: "Not connected to any remote. Tools execute locally." };
  }

  // /remote local — unbind
  if (trimmed === "local") {
    if (!binding.isBound) {
      return { message: "Already running locally." };
    }
    const prevName = binding.name;
    await binding.unbind();
    // Clear PI_REMOTE env var
    delete process.env.PI_REMOTE;
    return { message: `Disconnected from remote "${prevName}". Tools now execute locally.` };
  }

  // /remote <name> — bind to a named remote
  if (!config) {
    return { message: "No remotes.json found. Cannot switch remotes.", error: true };
  }

  const available = Object.keys(config.remotes);
  if (!available.includes(trimmed)) {
    return {
      message: `Unknown remote "${trimmed}". Available: ${available.join(", ") || "(none)"}`,
      error: true,
    };
  }

  try {
    await binding.bind(trimmed, config);
    // Set PI_REMOTE env var for subagent inheritance
    process.env.PI_REMOTE = trimmed;
    return {
      message: `Connected to remote "${trimmed}" (${binding.entry!.type})${binding.cwd ? ` at ${binding.cwd}` : ""}`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { message: `Failed to connect to "${trimmed}": ${msg}`, error: true };
  }
}
