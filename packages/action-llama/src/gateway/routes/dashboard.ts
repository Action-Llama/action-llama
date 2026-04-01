import type { Hono } from "hono";
import { registerDashboardDataRoutes } from "../../control/routes/dashboard.js";
import { registerDashboardApiRoutes } from "../../control/routes/dashboard-api.js";
import { registerLogRoutes } from "../../control/routes/logs.js";
import { registerLogSummaryRoutes } from "../../control/routes/log-summary.js";
import { registerStatsRoutes } from "../../control/routes/stats.js";
import type { StatusTracker } from "../../tui/status-tracker.js";
import type { ApiKeySource } from "../../control/auth.js";
import type { StatsStore } from "../../stats/store.js";
import type { Logger } from "../../shared/logger.js";
import type { StatsControlDeps } from "../../control/routes/stats.js";

/**
 * Register all dashboard-related routes: SSE data stream, JSON API,
 * log API, stats API, and the root redirect.
 *
 * Requires webUI + statusTracker + apiKey to be active (enforced by caller).
 */
export async function registerDashboardRoutes(
  app: Hono,
  opts: {
    statusTracker: StatusTracker;
    projectPath?: string;
    apiKey: ApiKeySource;
    statsStore?: StatsStore;
    logger: Logger;
    controlDeps?: StatsControlDeps;
  },
): Promise<void> {
  const { statusTracker, projectPath, statsStore } = opts;

  // SSE stream and locks API
  registerDashboardDataRoutes(app, statusTracker);

  // JSON API routes for the React SPA
  registerDashboardApiRoutes(app, statusTracker, projectPath, statsStore);

  // Log API routes (only if projectPath is provided)
  if (projectPath) {
    registerLogRoutes(app, projectPath);
    registerLogSummaryRoutes(app, projectPath, statsStore);
  }

  // Stats API routes
  registerStatsRoutes(app, statsStore, statusTracker, opts.controlDeps);

  // Root redirect to dashboard
  app.get("/", (c) => c.redirect("/dashboard"));
}
