/**
 * Scale reconciliation policies.
 *
 * Centralises the project-wide scale cap enforcement and the status-tracker
 * sync that follows pool creation.  Both rules were previously inline in
 * runner-setup.ts / scheduler/index.ts — moving them here gives maintainers
 * one obvious place to look when scale behaviour changes.
 */

import type { GlobalConfig, AgentConfig } from "../../shared/config.js";
import type { StatusTracker } from "../../tui/status-tracker.js";
import type { Logger } from "../../shared/logger.js";

/**
 * Enforce the project-wide scale limit across all agent configs.
 *
 * Walks the list in order, granting each agent as much of the remaining
 * capacity as it requested.  Agents whose requested scale exceeds what
 * remains are throttled; agents that are reached with zero capacity are
 * pinned to 1 (minimum viable runner).
 *
 * Returns a new array of agent configs with adjusted `scale` fields.
 * The original objects are not mutated.
 */
export function enforceProjectScaleCap(
  agentConfigs: AgentConfig[],
  globalConfig: GlobalConfig,
  logger: Logger,
): AgentConfig[] {
  const defaultScale = globalConfig.defaultAgentScale ?? 1;
  const adjustedConfigs = agentConfigs.map(config => ({ ...config }));

  if (globalConfig.scale === undefined) {
    return adjustedConfigs;
  }

  // Warn up-front when the total requested scale exceeds the cap.
  if (globalConfig.defaultAgentScale !== undefined) {
    const totalRequested = agentConfigs.reduce(
      (sum, c) => sum + (c.scale ?? defaultScale), 0
    );
    if (totalRequested > globalConfig.scale) {
      logger.warn({
        defaultAgentScale: globalConfig.defaultAgentScale,
        agentCount: agentConfigs.length,
        totalRequested,
        projectScale: globalConfig.scale,
      }, "Total requested agent scale (%d) exceeds project scale cap (%d) — agents will be throttled",
        totalRequested, globalConfig.scale);
    }
  }

  let totalScale = 0;
  for (const config of adjustedConfigs) {
    const requestedScale = config.scale ?? defaultScale;
    const remainingCapacity = globalConfig.scale - totalScale;

    if (remainingCapacity <= 0) {
      config.scale = 1; // Ensure at least 1 runner per agent
      if (requestedScale > 1) {
        logger.warn({
          agent: config.name,
          requested: requestedScale,
          reduced: 1,
          projectLimit: globalConfig.scale,
        }, "Agent scale reduced due to project scale limit");
      }
      totalScale += 1;
    } else if (requestedScale > remainingCapacity) {
      config.scale = remainingCapacity;
      logger.warn({
        agent: config.name,
        requested: requestedScale,
        reduced: remainingCapacity,
        projectLimit: globalConfig.scale,
      }, "Agent scale reduced due to project scale limit");
      totalScale += remainingCapacity;
    } else {
      totalScale += requestedScale;
    }
  }

  return adjustedConfigs;
}

/**
 * Sync the status tracker with actual pool sizes after scale cap enforcement.
 *
 * The status tracker is seeded with the configured scale at agent-registration
 * time; if the project-wide cap reduced any pool, we update the tracker so the
 * TUI shows the real runner count.
 */
export function syncTrackerScales(
  actualScales: Record<string, number>,
  statusTracker: StatusTracker | undefined,
  logger: Logger,
): void {
  if (!statusTracker) return;
  for (const [agentName, actualScale] of Object.entries(actualScales)) {
    const registeredScale = statusTracker.getAgentScale(agentName);
    if (registeredScale !== actualScale) {
      statusTracker.updateAgentScale(agentName, actualScale);
      logger.info(
        { agent: agentName, registeredScale, actualScale },
        "synced status tracker scale with actual pool size",
      );
    }
  }
}
