import { mkdirSync, writeFileSync, existsSync, readFileSync, copyFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { stringify as stringifyTOML } from "smol-toml";
import type { GlobalConfig, AgentConfig } from "../shared/config.js";
import { writeCredentialField, writeCredentialFields } from "../shared/credentials.js";
import { CONSTANTS } from "../shared/constants.js";

export { writeCredentialField, writeCredentialFields };

/**
 * Resolve the package root directory.
 * This module lives at src/setup/scaffold.ts (or dist/setup/scaffold.js),
 * so the package root is two directories up.
 */
function resolvePackageRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return resolve(thisFile, "..", "..", "..");
}

function resolvePackageAgentsMd(): string {
  return resolve(resolvePackageRoot(), "AGENTS.md");
}

export interface ScaffoldAgent {
  name: string;
  config: AgentConfig;
}

export function scaffoldAgent(projectPath: string, agent: ScaffoldAgent): void {
  const agentPath = resolve(projectPath, "agents", agent.name);
  mkdirSync(agentPath, { recursive: true });

  // Strip `name` before serializing — it's derived from the directory name
  const { name: _, ...configToWrite } = agent.config;
  writeFileSync(
    resolve(agentPath, "agent-config.toml"),
    stringifyTOML(configToWrite as Record<string, unknown>) + "\n"
  );

  // Write a stub ACTIONS.md if none exists
  const actionsPath = resolve(agentPath, "ACTIONS.md");
  if (!existsSync(actionsPath)) {
    writeFileSync(actionsPath, `# ${agent.name} Agent\n\nCustom agent.\n`);
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

  mkdirSync(resolve(projectPath, "agents"), { recursive: true });

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

  // Copy skills/ directory from the shipped package so AGENTS.md links resolve
  // without needing node_modules.
  const packageSkillsDir = resolve(resolvePackageRoot(), "skills");
  try {
    const skillFiles = readdirSync(packageSkillsDir).filter((f) => f.endsWith(".md"));
    if (skillFiles.length > 0) {
      const destSkillsDir = resolve(projectPath, "skills");
      mkdirSync(destSkillsDir, { recursive: true });
      for (const file of skillFiles) {
        const dest = resolve(destSkillsDir, file);
        if (!existsSync(dest)) {
          copyFileSync(resolve(packageSkillsDir, file), dest);
        }
      }
    }
  } catch {
    // Fallback: skip if skills directory can't be read
  }

  // Write project Dockerfile (base image for all agents)
  const dockerfilePath = resolve(projectPath, "Dockerfile");
  if (!existsSync(dockerfilePath)) {
    writeFileSync(dockerfilePath, [
      "# Project base image — shared by all agents in this project.",
      "# This extends the Action Llama base image.",
      "#",
      "# SAFE TO CUSTOMIZE:",
      "#   - Add system packages (RUN apk add ...)",
      "#   - Set environment variables (ENV ...)",
      "#   - Install language runtimes or CLI tools",
      "#",
      "# DO NOT MODIFY:",
      "#   - The FROM line — Action Llama rewrites it at build time to the correct base image",
      "#",
      "# Examples:",
      "#   RUN apk add --no-cache python3 py3-pip",
      "#   RUN apk add --no-cache github-cli",
      "#   ENV MY_VAR=value",
      "",
      `FROM ${CONSTANTS.DEFAULT_IMAGE}`,
      "",
    ].join("\n"));
  }

  // Create workspace directory
  mkdirSync(resolve(projectPath, ".workspace"), { recursive: true });

  // Create .env.toml with projectName
  const envTomlPath = resolve(projectPath, ".env.toml");
  if (!existsSync(envTomlPath) && projectName) {
    writeFileSync(envTomlPath, `projectName = "${projectName}"\n`);
  }

  // Create .gitignore
  const gitignorePath = resolve(projectPath, ".gitignore");
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, [
      "node_modules/",
      ".workspace/",
      ".al/",
      ".env.toml",
      "*.log",
      ".DS_Store",
      "",
    ].join("\n"));
  }
}
