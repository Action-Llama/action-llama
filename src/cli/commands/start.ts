import { resolve } from "path";
import { existsSync } from "fs";
import { loadGlobalConfig } from "../../shared/config.js";
import { startScheduler } from "../../scheduler/index.js";
import { StatusTracker } from "../../tui/status-tracker.js";
import { execute as runDoctor } from "./doctor.js";

export async function execute(opts: { project: string; env?: string; headless?: boolean; webUi?: boolean; expose?: boolean; port?: number }): Promise<void> {
  const projectPath = resolve(opts.project);

  // Guard: refuse to run if the project path looks like an agent directory
  if (existsSync(resolve(projectPath, "agent-config.toml")) || existsSync(resolve(projectPath, "ACTIONS.md"))) {
    throw new Error(
      `"${projectPath}" looks like an agent directory, not a project directory. ` +
      `Run 'al start' from the project root (the parent directory).`
    );
  }

  // Ensure all credentials are present before starting
  await runDoctor({ project: opts.project, env: opts.env, checkOnly: opts.headless });

  const globalConfig = loadGlobalConfig(projectPath, opts.env);

  // CLI --port overrides config
  if (opts.port) {
    if (!globalConfig.gateway) globalConfig.gateway = {};
    globalConfig.gateway.port = opts.port;
  }

  // Docker is always enabled
  if (!globalConfig.local) {
    globalConfig.local = { enabled: true };
  } else {
    globalConfig.local.enabled = true;
  }

  const statusTracker = new StatusTracker();

  // Render TUI early so build progress is visible
  statusTracker.setSchedulerInfo({
    mode: "docker",
    runtime: "local",
    projectName: globalConfig.projectName,
    gatewayPort: null,
    cronJobCount: 0,
    webhooksActive: false,
    webhookUrls: [],
    startedAt: new Date(),
    paused: false,
    initializing: true,
  });

  let cleanup: () => void;

  if (opts.headless) {
    const { attachPlainLogger } = await import("../../tui/plain-logger.js");
    const { detach } = attachPlainLogger(statusTracker);
    cleanup = detach;
  } else {
    const { renderTUI } = await import("../../tui/render.js");
    const { unmount } = await renderTUI(statusTracker);
    cleanup = unmount;
  }

  const { cronJobs, runnerPools, gateway, webhookRegistry, webhookUrls } = await startScheduler(
    projectPath, globalConfig, statusTracker, opts.webUi, opts.expose
  );

  const gatewayPort = globalConfig.gateway?.port || 8080;

  // Update scheduler info now that startup is complete
  statusTracker.setSchedulerInfo({
    mode: "docker",
    runtime: "local",
    projectName: globalConfig.projectName,
    gatewayPort,
    cronJobCount: cronJobs.length,
    webhooksActive: !!webhookRegistry,
    webhookUrls: webhookUrls || [],
    dashboardUrl: (opts.webUi && gatewayPort) ? `http://localhost:${gatewayPort}/dashboard` : undefined,
    startedAt: new Date(),
    paused: false,
    initializing: false,
  });

  // Coordinate SIGINT: cleanup, then exit
  const shutdown = () => {
    cleanup();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep process alive
  await new Promise(() => {});
}
