import { mkdirSync, writeFileSync, existsSync, copyFileSync, symlinkSync, lstatSync, realpathSync } from "fs";
import { resolve, relative } from "path";
import { fileURLToPath } from "url";
import { stringify as stringifyTOML } from "smol-toml";
import { stringify as stringifyYAML } from "yaml";
import type { GlobalConfig, AgentConfig } from "../shared/config.js";
import { writeCredentialField, writeCredentialFields } from "../shared/credentials.js";
import { CONSTANTS } from "../shared/constants.js";

export { writeCredentialField, writeCredentialFields };

/**
 * Resolve the package root directory.
 * This module lives at src/setup/scaffold.ts (or dist/setup/scaffold.js),
 * so the package root is two directories up.
 */
export function resolvePackageRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return resolve(thisFile, "..", "..", "..");
}

function resolveAgentReferenceMd(): string {
  return resolve(resolvePackageRoot(), "agent-docs", "AGENTS.md");
}

/** Check if a path exists as a symlink (even dangling). Returns false if nothing exists. */
function lstatSafe(path: string): boolean {
  try { return lstatSync(path).isSymbolicLink(); } catch { return false; }
}

export interface ScaffoldAgent {
  name: string;
  config: AgentConfig;
}

export function scaffoldAgent(projectPath: string, agent: ScaffoldAgent): void {
  const agentPath = resolve(projectPath, "agents", agent.name);
  mkdirSync(agentPath, { recursive: true });

  // Write a SKILL.md with YAML frontmatter if none exists
  const skillPath = resolve(agentPath, "SKILL.md");
  if (!existsSync(skillPath)) {
    // Strip `name` before serializing — it's derived from the directory name.
    // Also strip undefined values and model (inherited from global).
    const { name: _, model: _m, ...rest } = agent.config;
    const frontmatter: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined) frontmatter[k] = v;
    }
    const yamlStr = Object.keys(frontmatter).length > 0
      ? stringifyYAML(frontmatter).trimEnd()
      : "";
    writeFileSync(skillPath, `---\n${yamlStr}\n---\n\n# ${agent.name} Agent\n\nCustom agent.\n`);
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

  // Symlink AGENTS.md and CLAUDE.md to the package's agent-docs/AGENTS.md.
  // Uses a relative symlink so it works if the project moves.
  // Falls back to a regular copy if symlinks fail (e.g. Windows without Developer Mode)
  // or if the target doesn't exist (e.g. running from source before npm install).
  const agentRefMd = resolveAgentReferenceMd();
  const agentRefExists = existsSync(agentRefMd);
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const dest = resolve(projectPath, name);
    if (!existsSync(dest) && !lstatSafe(dest)) {
      if (agentRefExists) {
        try {
          const relTarget = relative(realpathSync(projectPath), agentRefMd);
          symlinkSync(relTarget, dest);
          continue;
        } catch {
          // Fall through to copy
        }
      }
      try {
        copyFileSync(agentRefMd, dest);
      } catch {
        // Skip if package can't be resolved
      }
    }
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
