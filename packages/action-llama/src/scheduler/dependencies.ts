// packages/action-llama/src/scheduler/dependencies.ts

import type { GlobalConfig } from "../shared/config.js";
import type { Logger } from "../shared/logger.js";
import { loadBuiltinExtensions } from "../extensions/loader.js";
import { initTelemetry } from "../telemetry/index.js";

export interface DependencyResult {
  telemetry: any | undefined;
}

/**
 * Load external dependencies: model-provider extensions and telemetry.
 * Both are non-fatal — failures log warnings and continue.
 */
export async function loadDependencies(
  globalConfig: GlobalConfig,
  logger: Logger,
): Promise<DependencyResult> {
  // Only load model extensions for providers actually referenced in config
  const usedProviders = globalConfig.models
    ? new Set(Object.values(globalConfig.models).map(m => m.provider))
    : undefined;

  try {
    await loadBuiltinExtensions(undefined, usedProviders);
    logger.info("Extensions loaded successfully");
  } catch (error: any) {
    logger.warn({ error: error.message }, "Failed to load extensions");
  }

  // Initialize telemetry if enabled
  let telemetry: any;
  if (globalConfig.telemetry?.enabled) {
    try {
      telemetry = initTelemetry(globalConfig.telemetry);
      await telemetry.init();
      logger.info("Telemetry initialized successfully");
    } catch (error: any) {
      logger.warn({ error: error.message }, "Failed to initialize telemetry");
    }
  }

  return { telemetry };
}
