import { resolve } from "path";
import { existsSync, mkdirSync } from "fs";
import { loadGlobalConfig, loadAgentConfig, discoverAgents } from "../../shared/config.js";
import { requireCredentialRef } from "../../shared/credentials.js";
import { createLogger } from "../../shared/logger.js";
import { agentDir } from "../../shared/paths.js";
import { AgentRunner } from "../../agents/runner.js";
import { buildManualPrompt } from "../../agents/prompt.js";
import { execute as runSetup } from "./setup.js";

export async function execute(agent: string, opts: { project: string; dangerousNoDocker?: boolean }): Promise<void> {
  const projectPath = resolve(opts.project);

  // Guard: refuse to run if the project path looks like an agent directory
  if (existsSync(resolve(projectPath, "agent-config.toml")) || existsSync(resolve(projectPath, "PLAYBOOK.md"))) {
    throw new Error(
      `"${projectPath}" looks like an agent directory, not a project directory. ` +
      `Run 'al run' from the project root (the parent directory).`
    );
  }

  // Check agent exists
  const agentNames = discoverAgents(projectPath);
  if (!agentNames.includes(agent)) {
    const available = agentNames.length > 0 ? `Available agents: ${agentNames.join(", ")}` : "No agents found.";
    throw new Error(`Agent "${agent}" not found. ${available}`);
  }

  // Ensure credentials are present
  await runSetup({ project: opts.project });

  const globalConfig = loadGlobalConfig(projectPath);
  const agentConfig = loadAgentConfig(projectPath, agent);

  // Validate credentials
  for (const credRef of agentConfig.credentials) {
    requireCredentialRef(credRef);
  }

  const dockerEnabled = !opts.dangerousNoDocker && globalConfig.docker?.enabled === true;

  const logger = createLogger(projectPath, agent);

  if (dockerEnabled) {
    // Docker mode: validate and run in container
    if (agentConfig.model.authType === "pi_auth") {
      throw new Error(
        `Agent "${agent}" uses pi_auth which is not supported in Docker mode. ` +
        `Either switch to api_key/oauth_token (run 'al setup') or use --dangerous-no-docker.`
      );
    }

    const { execFileSync } = await import("child_process");
    try {
      execFileSync("docker", ["info"], { stdio: "pipe", timeout: 10000 });
    } catch {
      throw new Error(
        "Docker is not running. Start Docker Desktop (or the Docker daemon) and try again, " +
        "or use --dangerous-no-docker to run without container isolation."
      );
    }

    const { LocalDockerRuntime } = await import("../../docker/local-runtime.js");
    const { ensureNetwork } = await import("../../docker/network.js");
    const { ensureImage, ensureAgentImage } = await import("../../docker/image.js");
    const { ContainerAgentRunner } = await import("../../agents/container-runner.js");

    const runtime = new LocalDockerRuntime();
    ensureNetwork();

    const baseImage = globalConfig.docker?.image || "al-agent:latest";
    ensureImage(baseImage);
    const image = ensureAgentImage(agent, projectPath, baseImage);

    const runner = new ContainerAgentRunner(
      runtime,
      globalConfig,
      agentConfig,
      logger,
      () => {},          // no gateway to register with
      () => {},          // no gateway to unregister from
      "",                // no gateway URL
      projectPath,
      image,
    );

    const prompt = buildManualPrompt(agentConfig);
    console.log(`Running agent "${agent}" in Docker...`);
    await runner.run(prompt);
  } else {
    // Host mode
    mkdirSync(agentDir(projectPath, agent), { recursive: true });
    const runner = new AgentRunner(agentConfig, logger, projectPath);
    const prompt = buildManualPrompt(agentConfig);
    console.log(`Running agent "${agent}"...`);
    await runner.run(prompt);
  }

  console.log(`Agent "${agent}" run completed.`);
}
