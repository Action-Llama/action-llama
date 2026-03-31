import { mkdirSync, writeFileSync, existsSync, readFileSync, copyFileSync, symlinkSync, lstatSync, realpathSync, readdirSync } from "fs";
import { execSync } from "child_process";
import { resolve, relative } from "path";
import { agentsMdPath, commandsDir, mcpJsonPath as skillMcpJsonPath } from "@action-llama/skill";

/**
 * Scaffold Claude Code slash commands into .claude/commands/.
 * Copies command files from @action-llama/skill content.
 * Skips files that already exist to avoid overwriting user customizations.
 */
export function scaffoldClaudeCommands(projectPath: string): void {
  const destDir = resolve(projectPath, ".claude", "commands");
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(commandsDir)) {
    if (!entry.endsWith(".md")) continue;
    const dest = resolve(destDir, entry);
    if (!existsSync(dest)) {
      copyFileSync(resolve(commandsDir, entry), dest);
    }
  }
}
import { fileURLToPath } from "url";
import { stringify as stringifyTOML } from "smol-toml";
import { stringify as stringifyYAML } from "yaml";
import type { GlobalConfig, AgentConfig } from "../shared/config.js";
import { writeCredentialField, writeCredentialFields } from "../shared/credentials.js";
import { CONSTANTS, VERSION } from "../shared/constants.js";

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

  // Write portable SKILL.md if none exists
  const skillPath = resolve(agentPath, "SKILL.md");
  if (!existsSync(skillPath)) {
    const frontmatter: Record<string, unknown> = { name: agent.name };
    if (agent.config.description) frontmatter.description = agent.config.description;
    if (agent.config.license) frontmatter.license = agent.config.license;
    if (agent.config.compatibility) frontmatter.compatibility = agent.config.compatibility;
    const yamlStr = stringifyYAML(frontmatter).trimEnd();
    writeFileSync(skillPath, `---\n${yamlStr}\n---\n\n# ${agent.name} Agent\n\nCustom agent.\n`);
  }

  // Write per-agent config.toml if none exists
  const configPath = resolve(agentPath, "config.toml");
  if (!existsSync(configPath)) {
    const { name: _, models: _m, description: _d, license: _l, compatibility: _c, ...runtimeFields } = agent.config;
    const runtimeConfig: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(runtimeFields)) {
      if (v !== undefined) runtimeConfig[k] = v;
    }
    writeFileSync(configPath, Object.keys(runtimeConfig).length > 0
      ? stringifyTOML(runtimeConfig) + "\n"
      : "");
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
    let basePkg: Record<string, unknown> = {};
    try {
      execSync("npm init -y", { cwd: projectPath, stdio: "pipe" });
      basePkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    } catch {
      // npm init not available — use defaults
    }
    const pkg = {
      name: (basePkg.name as string) || projectName || "al-project",
      version: (basePkg.version as string) || "1.0.0",
      private: true,
      type: "module",
      dependencies: {
        "@action-llama/action-llama": VERSION,
        "@action-llama/skill": VERSION,
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

  // Symlink AGENTS.md and CLAUDE.md to @action-llama/skill's content/AGENTS.md.
  // Uses a relative symlink so it works if the project moves.
  // Falls back to a regular copy if symlinks fail (e.g. Windows without Developer Mode)
  // or if the target doesn't exist (e.g. running from source before npm install).
  const agentRefExists = existsSync(agentsMdPath);
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const dest = resolve(projectPath, name);
    if (!existsSync(dest) && !lstatSafe(dest)) {
      if (agentRefExists) {
        try {
          const relTarget = relative(realpathSync(projectPath), agentsMdPath);
          symlinkSync(relTarget, dest);
          continue;
        } catch {
          // Fall through to copy
        }
      }
      try {
        copyFileSync(agentsMdPath, dest);
      } catch {
        // Skip if package can't be resolved
      }
    }
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

  // Create .mcp.json for Claude Code MCP integration
  const mcpJsonDest = resolve(projectPath, ".mcp.json");
  if (!existsSync(mcpJsonDest)) {
    copyFileSync(skillMcpJsonPath, mcpJsonDest);
  }

  // Scaffold Claude Code slash commands
  scaffoldClaudeCommands(projectPath);
}
