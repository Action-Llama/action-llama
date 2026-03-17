/**
 * Shared resolution for CLI arguments that accept an agent name.
 *
 * Commands like `al logs` and `al kill` accept a positional argument.
 * This module provides a single resolution path so every command handles
 * ambiguity the same way.
 */

import { loadAgentConfig } from "../shared/config.js";

export interface ResolvedTarget {
  /** Agent name (always present after resolution) */
  agent: string;
  /** Task/instance ID — reserved for future use */
  taskId?: string;
}

/**
 * Resolve a raw CLI argument to an agent name.
 *
 * Resolution order:
 *   1. Try loading agent config — if it succeeds, it's an agent name.
 *   2. Otherwise, pass through as-is (may be a valid agent without a
 *      local config directory, e.g. "scheduler").
 */
export async function resolveTarget(
  raw: string,
  projectPath: string,
): Promise<ResolvedTarget> {
  // 1. Known agent name?
  try {
    loadAgentConfig(projectPath, raw);
    return { agent: raw };
  } catch {
    // Not a local agent config — continue
  }

  // 2. Pass through (e.g. "scheduler", or an agent name without a config dir)
  return { agent: raw };
}
