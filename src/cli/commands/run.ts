import { resolve } from "path";
import { existsSync } from "fs";
import { discoverAgents } from "../../shared/config.js";
import { gatewayFetch, gatewayJson } from "../gateway-client.js";

export async function execute(agent: string, opts: { project: string; env?: string; headless?: boolean }): Promise<void> {
  const projectPath = resolve(opts.project);

  // Guard: refuse to run if the project path looks like an agent directory
  if (existsSync(resolve(projectPath, "agent-config.toml")) || existsSync(resolve(projectPath, "ACTIONS.md"))) {
    throw new Error(
      `"${projectPath}" looks like an agent directory, not a project directory. ` +
      `Run 'al run' from the project root (the parent directory).`
    );
  }

  // Check agent exists locally before hitting the gateway
  const agentNames = discoverAgents(projectPath);
  if (!agentNames.includes(agent)) {
    const available = agentNames.length > 0 ? `Available agents: ${agentNames.join(", ")}` : "No agents found.";
    throw new Error(`Agent "${agent}" not found. ${available}`);
  }

  let response: Response;
  try {
    response = await gatewayFetch({
      project: projectPath,
      path: `/control/trigger/${encodeURIComponent(agent)}`,
      method: "POST",
      env: opts.env,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("ECONNREFUSED")) {
      throw new Error("Scheduler not running. Start it with 'al start'.");
    }
    throw error;
  }

  const data = await gatewayJson(response);

  if (response.ok) {
    console.log(data.message);
  } else {
    throw new Error(data.error);
  }
}
