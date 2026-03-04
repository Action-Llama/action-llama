import { mkdirSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import type { GlobalConfig, AgentConfig } from "../shared/config.js";
import { writeCredential } from "../shared/credentials.js";
import { loadDefinitionAgentsMd, isBuiltinDefinition } from "../agents/definitions/loader.js";

export { writeCredential };

export interface ScaffoldAgent {
  name: string;
  template: string;
  config: AgentConfig;
}

export function scaffoldAgent(projectPath: string, agent: ScaffoldAgent): void {
  const agentPath = resolve(projectPath, agent.name);
  mkdirSync(agentPath, { recursive: true });

  // Strip `name` before serializing — it's derived from the directory name
  const { name: _, ...configToWrite } = agent.config;
  writeFileSync(
    resolve(agentPath, "config.json"),
    JSON.stringify(configToWrite, null, 2) + "\n"
  );

  // Write AGENTS.md
  let agentsMd: string;
  if (isBuiltinDefinition(agent.template)) {
    agentsMd = loadDefinitionAgentsMd(agent.template);
  } else {
    agentsMd = `# ${agent.name} Agent\n\nCustom agent.\n`;
  }
  writeFileSync(resolve(agentPath, "AGENTS.md"), agentsMd);

}

export function scaffoldProject(
  projectPath: string,
  globalConfig: GlobalConfig,
  agents: ScaffoldAgent[],
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

  // Create workspace directory
  mkdirSync(resolve(projectPath, ".workspace"), { recursive: true });

  // Create .gitignore
  const gitignorePath = resolve(projectPath, ".gitignore");
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, ".workspace/\nnode_modules/\n");
  }
}
