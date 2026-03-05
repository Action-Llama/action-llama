import { resolve } from "path";
import { loadGlobalConfig } from "../../shared/config.js";
import { startScheduler } from "../../scheduler/index.js";
import { StatusTracker } from "../../tui/status-tracker.js";
import { execute as runSetup } from "./setup.js";

export async function execute(opts: { project: string; dangerousNoDocker?: boolean }): Promise<void> {
  const projectPath = resolve(opts.project);

  // Ensure all credentials are present before starting
  await runSetup({ project: opts.project });

  const globalConfig = loadGlobalConfig(projectPath);

  // Docker is on by default; --dangerous-no-docker disables it
  if (opts.dangerousNoDocker) {
    if (!globalConfig.docker) globalConfig.docker = { enabled: false };
    else globalConfig.docker.enabled = false;
  } else if (!globalConfig.docker) {
    globalConfig.docker = { enabled: true };
  }

  const dockerEnabled = globalConfig.docker?.enabled === true;
  const mode = dockerEnabled ? "docker" : "host";

  const statusTracker = new StatusTracker();

  const { cronJobs, gateway, webhookRegistry, webhookUrls } = await startScheduler(projectPath, globalConfig, statusTracker);

  const gatewayPort = gateway ? (globalConfig.gateway?.port || 8080) : null;

  statusTracker.setSchedulerInfo({
    mode,
    gatewayPort,
    cronJobCount: cronJobs.length,
    webhooksActive: !!webhookRegistry,
    webhookUrls: webhookUrls || [],
    startedAt: new Date(),
  });

  // Lazy-import TUI to avoid loading React unless needed
  const { renderTUI } = await import("../../tui/render.js");
  const { unmount } = await renderTUI(statusTracker);

  // Coordinate SIGINT: unmount Ink, then exit
  const shutdown = () => {
    unmount();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep process alive
  await new Promise(() => {});
}
