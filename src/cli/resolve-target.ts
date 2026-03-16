/**
 * Shared resolution for CLI arguments that accept either an agent name or
 * a cloud task/instance ID.
 *
 * Commands like `al logs` and `al kill` accept a positional argument that
 * can be either. This module provides a single resolution path so every
 * command handles ambiguity the same way.
 */

import { loadAgentConfig } from "../shared/config.js";
import type { CloudProvider } from "../cloud/provider.js";

export interface ResolvedTarget {
  /** Agent name (always present after resolution) */
  agent: string;
  /** Cloud task/instance ID — set when the user passed an instance ID */
  taskId?: string;
}

/**
 * Resolve a raw CLI argument to an agent name + optional task ID.
 *
 * Resolution order:
 *   1. Try loading agent config — if it succeeds, it's an agent name.
 *   2. If it looks like a hex task ID and we're in cloud mode, query
 *      running instances to find the owning agent.
 *   3. Otherwise, pass through as-is (may be a valid agent without a
 *      local config directory, e.g. "scheduler").
 */
export async function resolveTarget(
  raw: string,
  projectPath: string,
  cloudProvider?: CloudProvider,
): Promise<ResolvedTarget> {
  // 1. Known agent name?
  try {
    loadAgentConfig(projectPath, raw);
    return { agent: raw };
  } catch {
    // Not a local agent config — continue
  }

  // 2. Looks like a task/instance ID? (hex, 8+ chars)
  if (/^[0-9a-f]{8,}$/i.test(raw) && cloudProvider) {
    const runtime = cloudProvider.createRuntime();
    const running = await runtime.listRunningAgents();
    const match = running.find((r) => r.taskId === raw || r.taskId.startsWith(raw));
    if (match) {
      return { agent: match.agentName, taskId: match.taskId };
    }
    throw new Error(
      `No running instance found matching "${raw}". Use 'al stat -c' to list instances.`,
    );
  }

  // 3. Pass through (e.g. "scheduler", or an agent name without a config dir)
  return { agent: raw };
}
