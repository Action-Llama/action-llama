/**
 * Pi extension for remote execution — interactive mode.
 *
 * When loaded via `pi -e pi-remote`, this extension:
 *  1. Discovers remotes.json config
 *  2. Resolves which remote to bind to (--remote flag > config default > PI_REMOTE env var)
 *  3. Creates a Transport and registers tool overrides for all 7 coding tools
 *  4. Provides /remote command for switching remotes at runtime
 *  5. Sets PI_REMOTE env var for subagent inheritance
 */

import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import {
  createBashToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  createEditToolDefinition,
  createGrepToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { loadRemotesConfig } from "./config.js";
import { RemoteBinding } from "./binding.js";
import { handleRemoteCommand } from "./command.js";
import { formatStatusText } from "./status.js";
import {
  createTransportBashOps,
  createTransportReadOps,
  createTransportWriteOps,
  createTransportEditOps,
  createTransportGrepOps,
  createTransportFindOps,
  createTransportLsOps,
} from "./transport/operations.js";

const piRemoteExtension: ExtensionFactory = (pi) => {
  const binding = new RemoteBinding();
  let config = loadRemotesConfig(process.cwd());

  // Register --remote flag
  pi.registerFlag("remote", {
    description: "Name of the remote to connect to from remotes.json",
    type: "string",
  });

  // Register /remote command
  pi.registerCommand("remote", {
    description: "Switch remote execution target",
    handler: async (args, ctx) => {
      const result = await handleRemoteCommand(args, binding, config);
      if (result.error) {
        ctx.ui.notify(result.message, "error");
      } else {
        ctx.ui.notify(result.message, "info");
        // Update status bar
        if (binding.isBound && binding.entry) {
          ctx.ui.setStatus("remote", formatStatusText(binding.name!, binding.entry));
        } else {
          ctx.ui.setStatus("remote", undefined);
        }
        // Re-register tools with new transport
        registerToolOverrides(pi, binding);
      }
    },
  });

  // Session start: resolve and bind
  pi.on("session_start", async (_event, ctx) => {
    const flagValue = pi.getFlag("remote") as string | undefined;
    const envVar = process.env.PI_REMOTE;

    const remoteName = RemoteBinding.resolveRemoteName(flagValue, config, envVar);
    if (!remoteName || !config) return;

    try {
      await binding.bind(remoteName, config);
      // Set env var for subagent inheritance
      process.env.PI_REMOTE = remoteName;
      // Update status bar
      if (binding.entry) {
        ctx.ui.setStatus("remote", formatStatusText(remoteName, binding.entry));
      }
      // Register tool overrides
      registerToolOverrides(pi, binding);
      ctx.ui.notify(`Connected to remote "${remoteName}" (${binding.entry!.type})`, "info");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.ui.notify(`Failed to connect to remote "${remoteName}": ${msg}`, "error");
    }
  });

  // Before agent start: rewrite system prompt cwd
  pi.on("before_agent_start", (event) => {
    if (!binding.isBound || !binding.entry) return;

    const remoteCwd = binding.cwd ?? "/";
    const typeLabel = binding.entry.type === "ssh" ? "SSH" : binding.entry.type;
    const cwdNote = `Current working directory: ${remoteCwd} (via ${typeLabel}: ${binding.name})`;

    // Inject cwd note into system prompt
    let systemPrompt = event.systemPrompt;
    if (systemPrompt) {
      systemPrompt = systemPrompt.replace(
        /Current working directory:.*$/m,
        cwdNote,
      );
    }

    return { systemPrompt };
  });

  // User bash (! commands): route through transport
  pi.on("user_bash", () => {
    const transport = binding.transport;
    if (!transport) return;
    return { operations: createTransportBashOps(transport) };
  });

  // Session shutdown: close transport
  pi.on("session_shutdown", async () => {
    await binding.unbind();
  });
};

/**
 * Register tool overrides that route through the active Transport.
 * Uses Pi's createXToolDefinition factories with transport-backed operations.
 */
function registerToolOverrides(pi: Parameters<ExtensionFactory>[0], binding: RemoteBinding): void {
  const cwd = binding.cwd ?? process.cwd();
  const transport = binding.transport;
  if (!transport) return;

  const definitions = [
    createBashToolDefinition(cwd, { operations: createTransportBashOps(transport) }),
    createReadToolDefinition(cwd, { operations: createTransportReadOps(transport) }),
    createWriteToolDefinition(cwd, { operations: createTransportWriteOps(transport) }),
    createEditToolDefinition(cwd, { operations: createTransportEditOps(transport) }),
    createGrepToolDefinition(cwd, { operations: createTransportGrepOps(transport) }),
    createFindToolDefinition(cwd, { operations: createTransportFindOps(transport) }),
    createLsToolDefinition(cwd, { operations: createTransportLsOps(transport) }),
  ];

  for (const def of definitions) {
    pi.registerTool(def as any);
  }
}

export default piRemoteExtension;
