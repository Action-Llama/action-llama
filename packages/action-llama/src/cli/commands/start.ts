import { resolve } from "path";
import { existsSync } from "fs";
import { loadGlobalConfig } from "../../shared/config.js";
import { startScheduler } from "../../scheduler/index.js";
import { StatusTracker } from "../../tui/status-tracker.js";
import { execute as runDoctor } from "./doctor.js";
import { resolveEnvironmentName, loadEnvironmentConfig } from "../../shared/environment.js";
import { validateServerConfig } from "../../shared/server.js";
import { sshOptionsFromConfig, sshExec } from "../../remote/ssh.js";
import { gatewayFetch } from "../gateway-client.js";
import { credentialExists } from "../../shared/credentials.js";
import { ConfigError } from "../../shared/errors.js";

export async function execute(opts: { project: string; env?: string; headless?: boolean; webUi?: boolean; expose?: boolean; port?: number }): Promise<void> {
  // The scheduler registers multiple cleanup handlers (TUI, gateway, cron, telemetry, etc.)
  // which collectively exceed Node's default limit of 10 per event.
  process.setMaxListeners(20);

  const projectPath = resolve(opts.project);

  // Guard: refuse to run if the project path looks like an agent directory
  if (existsSync(resolve(projectPath, "SKILL.md"))) {
    throw new Error(
      `"${projectPath}" looks like an agent directory, not a project directory. ` +
      `Run 'al start' from the project root (the parent directory).`
    );
  }

  // If the environment has a [server] section, start the remote service instead
  const envName = resolveEnvironmentName(opts.env, projectPath);
  if (envName) {
    const envConfig = loadEnvironmentConfig(envName);
    if (envConfig.server) {
      const serverConfig = validateServerConfig(envConfig.server);
      await startRemoteService(projectPath, envName, serverConfig);
      return;
    }
  }

  // Security validation: require API key for exposed services
  if ((opts.webUi || opts.expose) && !await credentialExists("gateway_api_key", "default")) {
    throw new ConfigError(
      "Gateway API key required when using --web-ui or --expose. " +
      "Run 'al doctor' to configure it."
    );
  }

  // Ensure all credentials are present before starting (silent unless something is missing)
  await runDoctor({ project: opts.project, env: opts.env, checkOnly: opts.headless, silent: true });

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
    const { unmount } = await renderTUI(statusTracker, projectPath);
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

async function startRemoteService(
  projectPath: string,
  envName: string,
  serverConfig: import("../../shared/server.js").ServerConfig,
): Promise<void> {
  const sshOpts = sshOptionsFromConfig(serverConfig);

  // Check if already running via gateway health
  try {
    const resp = await gatewayFetch({ project: projectPath, path: "/health", env: envName });
    if (resp.ok) {
      console.log(`Service is already running on ${serverConfig.host}.`);
      return;
    }
  } catch {
    // Not reachable — proceed with starting
  }

  // SSH to start the systemd service
  console.log(`Starting service on ${serverConfig.host}...`);
  try {
    await sshExec(sshOpts, "sudo systemctl start action-llama");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to start service on ${serverConfig.host}: ${msg}\n` +
      `Make sure the service is installed — run 'al push --env ${envName}' first.`
    );
  }

  // Poll /health until it responds or we time out
  const deadline = Date.now() + 30_000;
  let healthy = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2_000));
    try {
      const resp = await gatewayFetch({ project: projectPath, path: "/health", env: envName });
      if (resp.ok) {
        healthy = true;
        break;
      }
    } catch {
      // Not up yet
    }
  }

  if (healthy) {
    console.log(`Service started on ${serverConfig.host}.`);
  } else {
    console.warn(`Service start command succeeded but health check did not respond within 30s. Check with 'al status --env ${envName}'.`);
  }
}
