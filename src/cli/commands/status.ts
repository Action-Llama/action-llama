import { resolve } from "path";
import { discoverAgents, loadAgentConfig } from "../../shared/config.js";

export async function execute(opts: { project: string }): Promise<void> {
  const projectPath = resolve(opts.project);

  const agentNames = discoverAgents(projectPath);

  console.log(`AL Status — ${projectPath}\n`);

  for (const name of agentNames) {
    const agentConfig = loadAgentConfig(projectPath, name);
    console.log(`${name}:`);
    console.log(`  Repos:    ${agentConfig.repos.join(", ")}`);
    console.log(`  Schedule: ${agentConfig.schedule || "(none)"}`);
    console.log("");
  }

  console.log(`Agents: ${agentNames.join(", ")}`);
}
