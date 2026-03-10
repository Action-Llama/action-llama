import { mkdirSync, writeFileSync, existsSync, readFileSync, copyFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { stringify as stringifyTOML } from "smol-toml";
import type { GlobalConfig, AgentConfig } from "../shared/config.js";
import { writeCredentialField, writeCredentialFields } from "../shared/credentials.js";

export { writeCredentialField, writeCredentialFields };

/**
 * Resolve the path to the shipped AGENTS.md at the package root.
 * This module lives at src/setup/scaffold.ts (or dist/setup/scaffold.js),
 * so the package root is two directories up.
 */
function resolvePackageAgentsMd(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return resolve(thisFile, "..", "..", "..", "AGENTS.md");
}

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

  // Write a stub PLAYBOOK.md if none exists
  const playbookPath = resolve(agentPath, "PLAYBOOK.md");
  if (!existsSync(playbookPath)) {
    writeFileSync(playbookPath, `# ${agent.name} Agent\n\nCustom agent.\n`);
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
      resolve(projectPath, "config.toml"),
      stringifyTOML(globalConfig as Record<string, unknown>) + "\n"
    );
  }

  for (const agent of agents) {
    scaffoldAgent(projectPath, agent);
  }

  // Copy AGENTS.md (and CLAUDE.md alias) from the shipped package into the project.
  // We copy instead of symlinking so the files work immediately after `git clone`
  // without needing `npm install` first — important for agents that clone the repo.
  const packageAgentsMd = resolvePackageAgentsMd();
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const dest = resolve(projectPath, name);
    if (!existsSync(dest)) {
      try {
        copyFileSync(packageAgentsMd, dest);
      } catch {
        // Fallback: if the package can't be resolved (e.g. running from source
        // before npm install), skip the copy — the user can create it later.
      }
    }
  }

  // Create workspace directory
  mkdirSync(resolve(projectPath, ".workspace"), { recursive: true });

  // Create .gitignore
  const gitignorePath = resolve(projectPath, ".gitignore");
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, [
      "node_modules/",
      ".workspace/",
      ".al/",
      "*.log",
      ".DS_Store",
      "",
    ].join("\n"));
  }
}
