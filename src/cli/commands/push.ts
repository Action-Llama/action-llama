import { resolve } from "path";
import { loadGlobalConfig, discoverAgents } from "../../shared/config.js";
import { resolveEnvironmentName, loadEnvironmentConfig } from "../../shared/environment.js";
import { validateServerConfig } from "../../shared/server.js";
import { collectCredentialRefs } from "../../shared/credential-refs.js";
import { credentialExists, parseCredentialRef } from "../../shared/credentials.js";
import { resolveCredential } from "../../credentials/registry.js";
import { ConfigError, CredentialError } from "../../shared/errors.js";
import { pushToServer } from "../../remote/push.js";

export async function execute(opts: { project: string; env?: string; dryRun?: boolean; noCreds?: boolean }): Promise<void> {
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

  // Check that local credentials exist before pushing
  if (!opts.noCreds) {
    const credentialRefs = collectCredentialRefs(projectPath, globalConfig);
    const missing: string[] = [];
    for (const ref of credentialRefs) {
      const { type, instance } = parseCredentialRef(ref);
      if (!(await credentialExists(type, instance))) {
        const def = resolveCredential(type);
        missing.push(`${def.label} (${ref})`);
      }
    }
    if (missing.length > 0) {
      throw new CredentialError(
        `${missing.length} credential(s) missing locally:\n` +
        missing.map((m) => `  - ${m}`).join("\n") + "\n" +
        "Run 'al doctor' to configure them before pushing."
      );
    }
  }

  console.log(`\n=== Push to ${serverConfig.host} (env: ${envName}) ===`);
  console.log(`Agents: ${agents.join(", ")}`);

  await pushToServer({
    projectPath,
    serverConfig,
    globalConfig,
    envName,
    dryRun: opts.dryRun,
    noCreds: opts.noCreds,
  });
}
