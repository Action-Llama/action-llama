import { resolve } from "path";
import { loadGlobalConfig, discoverAgents } from "../../shared/config.js";
import { resolveEnvironmentName, loadEnvironmentConfig } from "../../shared/environment.js";
import { validateServerConfig } from "../../shared/server.js";
import { ConfigError } from "../../shared/errors.js";
import { pushToServer, pushAgentToServer } from "../../remote/push.js";

export async function execute(opts: {
  project: string;
  agent?: string;
  env?: string;
  dryRun?: boolean;
  noCreds?: boolean;
  credsOnly?: boolean;
  filesOnly?: boolean;
  all?: boolean;
  forceInstall?: boolean;
  headless?: boolean;
}): Promise<void> {
  const projectPath = resolve(opts.project);

  // Resolve environment
  const envName = resolveEnvironmentName(opts.env, projectPath);
  if (!envName) {
    throw new ConfigError(
      "No environment specified. Use --env <name>, set AL_ENV, or add 'environment' to .env.toml."
    );
  }

  // Load environment config and validate it has [server]
  const envConfig = loadEnvironmentConfig(envName);
  if (!envConfig.server) {
    throw new ConfigError(
      `Environment "${envName}" has no [server] section. ` +
      `al push requires a server environment.`
    );
  }

  const serverConfig = validateServerConfig(envConfig.server);
  const globalConfig = loadGlobalConfig(projectPath, envName);

  // Check agents exist
  const agents = discoverAgents(projectPath);
  if (agents.length === 0) {
    throw new ConfigError("No agents found. Create agents first, then re-run al push.");
  }

  // Validate the named agent exists
  if (opts.agent && !agents.includes(opts.agent)) {
    throw new ConfigError(
      `Agent "${opts.agent}" not found. Available agents: ${agents.join(", ")}`
    );
  }

  // Determine what to sync
  const syncCreds = opts.credsOnly || opts.all || (!opts.filesOnly);
  const syncFiles = opts.filesOnly || opts.all || (!opts.credsOnly);

  // Single-agent push — lightweight path (no restart, hot-reloaded)
  if (opts.agent) {
    console.log(`\n=== Push ${opts.agent} to ${serverConfig.host} (env: ${envName}) ===`);

    await pushAgentToServer({
      projectPath,
      serverConfig,
      globalConfig,
      agentName: opts.agent,
      dryRun: opts.dryRun,
      noCreds: !syncCreds,
      noFiles: !syncFiles,
    });
    return;
  }

  // Full push — run doctor in checkOnly mode to validate full config before pushing
  const { execute: doctorExecute } = await import("./doctor.js");
  await doctorExecute({
    project: projectPath,
    env: envName,
    checkOnly: opts.headless ?? false,  // Run interactively by default
    skipCredentials: opts.noCreds ?? false,
    silent: true
  });

  console.log(`\n=== Push to ${serverConfig.host} (env: ${envName}) ===`);
  console.log(`Agents: ${agents.join(", ")}`);

  await pushToServer({
    projectPath,
    serverConfig,
    globalConfig,
    dryRun: opts.dryRun,
    noCreds: !syncCreds,
    noFiles: !syncFiles,
    forceInstall: opts.forceInstall,
  });
}
