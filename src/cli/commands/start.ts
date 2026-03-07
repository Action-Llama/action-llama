import { resolve } from "path";
import { existsSync } from "fs";
import { loadGlobalConfig } from "../../shared/config.js";
import { startScheduler } from "../../scheduler/index.js";
import { StatusTracker } from "../../tui/status-tracker.js";
import { execute as runDoctor } from "./doctor.js";

export async function execute(opts: { project: string; noDocker?: boolean; cloud?: boolean; headless?: boolean }): Promise<void> {
  const projectPath = resolve(opts.project);

  // Guard: refuse to run if the project path looks like an agent directory
  if (existsSync(resolve(projectPath, "agent-config.toml")) || existsSync(resolve(projectPath, "PLAYBOOK.md"))) {
    throw new Error(
      `"${projectPath}" looks like an agent directory, not a project directory. ` +
      `Run 'al start' from the project root (the parent directory).`
    );
  }

  // Ensure all credentials are present before starting
  await runDoctor({ project: opts.project, cloud: opts.cloud, checkOnly: opts.headless });

  const globalConfig = loadGlobalConfig(projectPath);

  // Docker is on by default; --no-docker disables it
  if (opts.noDocker) {
    if (!globalConfig.local) globalConfig.local = { enabled: false };
    else globalConfig.local.enabled = false;
  } else if (!globalConfig.local) {
    globalConfig.local = { enabled: true };
  }

  // Cloud mode: set up cloud backend
  if (opts.cloud) {
    if (!globalConfig.cloud) {
      throw new Error("No [cloud] section found in config.toml. Run 'al cloud setup' first.");
    }
    const { setDefaultBackend } = await import("../../shared/credentials.js");
    const { createBackendFromCloudConfig } = await import("../../shared/remote.js");
    const backend = await createBackendFromCloudConfig(globalConfig.cloud);
    setDefaultBackend(backend);
  }

  const dockerEnabled = globalConfig.local?.enabled === true;
  const mode = dockerEnabled ? "docker" : "host";

  const statusTracker = new StatusTracker();

  // Render TUI early so build progress is visible
  statusTracker.setSchedulerInfo({
    mode,
    runtime: dockerEnabled ? (opts.cloud ? globalConfig.cloud?.provider : "local") : undefined,
    gatewayPort: null,
    cronJobCount: 0,
    webhooksActive: false,
    webhookUrls: [],
    startedAt: new Date(),
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

  const { cronJobs, gateway, webhookRegistry, webhookUrls } = await startScheduler(projectPath, globalConfig, statusTracker, opts.cloud);

  const gatewayPort = gateway ? (globalConfig.gateway?.port || 8080) : null;

  // Update scheduler info now that startup is complete
  statusTracker.setSchedulerInfo({
    mode,
    runtime: dockerEnabled ? (opts.cloud ? globalConfig.cloud?.provider : "local") : undefined,
    gatewayPort,
    cronJobCount: cronJobs.length,
    webhooksActive: !!webhookRegistry,
    webhookUrls: webhookUrls || [],
    startedAt: new Date(),
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
