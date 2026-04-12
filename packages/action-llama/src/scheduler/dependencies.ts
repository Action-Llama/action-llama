// packages/action-llama/src/scheduler/dependencies.ts

import type { GlobalConfig } from "../shared/config.js";
import type { Logger } from "../shared/logger.js";
import { loadBuiltinExtensions } from "../extensions/loader.js";

export interface DependencyResult {}

/**
 * Load external dependencies: extensions.
 * Non-fatal — failures log warnings and continue.
 */
export async function loadDependencies(
  globalConfig: GlobalConfig,
  logger: Logger,
): Promise<DependencyResult> {
  try {
    await loadBuiltinExtensions();
    logger.info("Extensions loaded successfully");
  } catch (error: any) {
    logger.warn({ error: error.message }, "Failed to load extensions");
  }

  return {};
}
