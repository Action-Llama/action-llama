import { mkdirSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { stringify as stringifyTOML } from "smol-toml";
import type { GlobalConfig, AgentConfig } from "../shared/config.js";
import { writeCredential } from "../shared/credentials.js";

export { writeCredential };

const PROJECT_AGENTS_MD = `# Action Llama Project

This is an Action Llama project. It runs automated development agents triggered by cron schedules or webhooks.

## Project Structure

Each agent is a directory containing:

- \`agent-config.toml\` — credentials, repos, model, schedule, webhooks, params
- \`AGENTS.md\` — the system prompt that defines what the agent does

## Creating an Agent

1. Create a directory for your agent (e.g. \`my-agent/\`)
2. Add \`agent-config.toml\` with credentials, repos, model config, and a schedule or webhook trigger
3. Add \`AGENTS.md\` with the system prompt — instructions the LLM follows each run
4. Verify with \`npx al status\`
5. Run with \`npx al start\`

## Example \`agent-config.toml\`

\`\`\`toml
credentials = ["anthropic-key", "github-token"]
repos = ["your-org/your-repo"]
schedule = "*/5 * * * *"

[model]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
thinkingLevel = "medium"
authType = "api_key"
\`\`\`

## Credentials

Credentials are managed by the user via \`al setup\` and stored in \`~/.action-llama-credentials/\`.

**IMPORTANT:** Agents MUST NEVER ask users for credentials directly (API keys, tokens, passwords, etc.). Agents MUST NEVER run \`al setup\` or interact with the credential system on behalf of the user. If a credential is missing at runtime, the agent should report the error and stop — the user will run \`al setup\` themselves.

## Documentation

Full docs: https://github.com/action-llama/action-llama/tree/main/docs

- [Creating Agents](https://github.com/action-llama/action-llama/blob/main/docs/creating-agents.md)
- [agent-config.toml Reference](https://github.com/action-llama/action-llama/blob/main/docs/agent-config-reference.md)
- [CLI Commands](https://github.com/action-llama/action-llama/blob/main/docs/commands.md)
- [Credentials](https://github.com/action-llama/action-llama/blob/main/docs/credentials.md)
- [Webhooks](https://github.com/action-llama/action-llama/blob/main/docs/webhooks.md)
- [Examples](https://github.com/action-llama/action-llama/tree/main/docs/examples)
`;

export interface ScaffoldAgent {
  name: string;
  config: AgentConfig;
}

export function scaffoldAgent(projectPath: string, agent: ScaffoldAgent): void {
  const agentPath = resolve(projectPath, agent.name);
  mkdirSync(agentPath, { recursive: true });

  // Strip `name` before serializing — it's derived from the directory name
  const { name: _, ...configToWrite } = agent.config;
  writeFileSync(
    resolve(agentPath, "agent-config.toml"),
    stringifyTOML(configToWrite as Record<string, unknown>) + "\n"
  );

  // Write a stub AGENTS.md if none exists
  const agentsMdPath = resolve(agentPath, "AGENTS.md");
  if (!existsSync(agentsMdPath)) {
    writeFileSync(agentsMdPath, `# ${agent.name} Agent\n\nCustom agent.\n`);
  }
}

export function scaffoldProject(
  projectPath: string,
  globalConfig: GlobalConfig,
  agents: ScaffoldAgent[] = [],
  projectName?: string
): void {
  mkdirSync(projectPath, { recursive: true });

  // Create package.json with @action-llama/action-llama dependency
  const pkgPath = resolve(projectPath, "package.json");
  if (!existsSync(pkgPath)) {
    const pkg = {
      name: projectName || "al-project",
      private: true,
      type: "module",
      dependencies: {
        "@action-llama/action-llama": "latest",
      },
    };
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  }

  // Write global config only if non-empty
  if (Object.keys(globalConfig).length > 0) {
    writeFileSync(
      resolve(projectPath, "config.json"),
      JSON.stringify(globalConfig, null, 2) + "\n"
    );
  }

  for (const agent of agents) {
    scaffoldAgent(projectPath, agent);
  }

  // Write project-level AGENTS.md for coding agents
  const agentsMdPath = resolve(projectPath, "AGENTS.md");
  if (!existsSync(agentsMdPath)) {
    writeFileSync(agentsMdPath, PROJECT_AGENTS_MD);
  }

  // Create workspace directory
  mkdirSync(resolve(projectPath, ".workspace"), { recursive: true });

  // Create .gitignore
  const gitignorePath = resolve(projectPath, ".gitignore");
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, ".workspace/\nnode_modules/\n");
  }
}
