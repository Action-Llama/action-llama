import { resolve } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { loadGlobalConfig, loadAgentConfig, discoverAgents } from "../../shared/config.js";
import { requireCredentialRef } from "../../shared/credentials.js";
import { createLogger } from "../../shared/logger.js";
import { CONSTANTS, imageTags } from "../../shared/constants.js";
import { buildManualPrompt } from "../../agents/prompt.js";
import { execute as runDoctor } from "./doctor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..", "..", "..");

export async function execute(agent: string, opts: { project: string; env?: string; headless?: boolean }): Promise<void> {
  const projectPath = resolve(opts.project);

  // Guard: refuse to run if the project path looks like an agent directory
  if (existsSync(resolve(projectPath, "agent-config.toml")) || existsSync(resolve(projectPath, "ACTIONS.md"))) {
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
  await runDoctor({ project: opts.project, env: opts.env, checkOnly: opts.headless });

  const globalConfig = loadGlobalConfig(projectPath, opts.env);
  const agentConfig = loadAgentConfig(projectPath, agent);

  // Validate credentials
  for (const credRef of agentConfig.credentials) {
    await requireCredentialRef(credRef);
  }

  const logger = createLogger(projectPath, agent);

  // Docker mode: validate and run in container
  if (agentConfig.model.authType === "pi_auth") {
    throw new Error(
      `Agent "${agent}" uses pi_auth which is not supported in container mode. ` +
      `Switch to api_key/oauth_token (run 'al doctor').`
    );
  }

  const { execFileSync } = await import("child_process");
  try {
    execFileSync("docker", ["info"], { stdio: "pipe", timeout: 10000 });
  } catch {
    throw new Error(
      "Docker is not running. Start Docker Desktop (or the Docker daemon) and try again."
    );
  }

  const { LocalDockerRuntime } = await import("../../docker/local-runtime.js");
  const { ensureNetwork } = await import("../../docker/network.js");
  const { ensureImage, ensureAgentImage, ensureProjectBaseImage } = await import("../../docker/image.js");
  const { ContainerAgentRunner } = await import("../../agents/container-runner.js");

  const runtime = new LocalDockerRuntime();
  ensureNetwork();

  const baseImage = globalConfig.local?.image || CONSTANTS.DEFAULT_IMAGE;
  ensureImage(baseImage);
  const effectiveBaseImage = ensureProjectBaseImage(projectPath, baseImage);
  const image = ensureAgentImage(agent, projectPath, effectiveBaseImage);

  const runner = new ContainerAgentRunner(
    runtime,
    globalConfig,
    agentConfig,
    logger,
    async () => {},    // no gateway to register with
    async () => {},    // no gateway to unregister from
    "",                // no gateway URL
    projectPath,
    image,
  );

  const prompt = buildManualPrompt(agentConfig);
  console.log(`Running agent "${agent}" in Docker...`);
  await runner.run(prompt);

  console.log(`Agent "${agent}" run completed.`);
}
