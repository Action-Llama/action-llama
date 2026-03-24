import { mkdirSync, writeFileSync, existsSync, copyFileSync, symlinkSync, lstatSync, realpathSync } from "fs";
import { resolve, relative } from "path";

// ---------------------------------------------------------------------------
// Claude Code slash-command templates (.claude/commands/*.md)
// ---------------------------------------------------------------------------

export const CLAUDE_COMMANDS: Record<string, string> = {
  "new-agent": `# Create a new agent

Create a new Action Llama agent named \`$ARGUMENTS\`.

## Steps

1. Ask the user for:
   - **Trigger type**: \`schedule\` (cron), \`webhook\`, or both
   - If schedule: a cron expression (e.g. \`*/5 * * * *\`)
   - If webhook: the provider and event (e.g. \`github\` / \`issues.opened\`)
   - **Credentials** needed (e.g. \`github_token\`, \`slack_webhook\`)
   - A one-sentence description of what the agent should do

2. Use \`al_agents\` to list existing agents and avoid name conflicts.

3. Create \`agents/$ARGUMENTS/SKILL.md\` with:
   - YAML frontmatter containing the trigger config and credentials
   - Do NOT include \`name\` or \`model\` in the frontmatter — name is derived from the directory, model is inherited from project config
   - A markdown body with clear instructions for the agent
   - Reference AGENTS.md (symlinked at project root) for the full SKILL.md specification

4. Confirm the agent was created and suggest next steps:
   - \`al doctor\` to verify credentials
   - \`/run\` to test it
`,

  "run": `# Run an agent

Trigger an agent run and report the results.

## Steps

1. Call \`al_status\` to check if the scheduler is running.
   - If not running, call \`al_start\` to start it and wait for it to become ready.

2. Ask the user which agent to run (or use \`$ARGUMENTS\` if provided).
   - If unclear, call \`al_agents\` to list available agents.

3. Call \`al_run\` with the agent name.

4. Wait a few seconds, then call \`al_logs\` with the agent name, \`lines: 200\`, to fetch the run output.
   - If the run is still in progress, wait and poll logs again.

5. Summarize the result:
   - What the agent did (key actions, commits, API calls)
   - Whether it succeeded or failed
   - Any warnings or errors
`,

  "debug": `# Debug a failing agent

Diagnose why an agent is failing and suggest fixes.

## Steps

1. Identify the agent to debug (use \`$ARGUMENTS\` if provided, otherwise ask).

2. Call \`al_logs\` with the agent name, \`level: "warn"\`, \`lines: 500\` to pull recent warnings and errors.

3. Call \`al_agents\` with the agent name to read its full config and SKILL.md body.

4. Analyze the logs and agent configuration to identify the root cause. Common issues:
   - Missing or expired credentials
   - Malformed SKILL.md frontmatter
   - Instructions that lead to tool errors
   - Rate limiting or API failures
   - Docker/container issues

5. Present a diagnosis with:
   - **Root cause**: What's going wrong and why
   - **Evidence**: Relevant log lines
   - **Fix**: Concrete changes to make (SKILL.md edits, credential updates, config changes)

6. Offer to apply the fix directly.
`,

  "iterate": `# Iterate on an agent

Run an agent, analyze its output, and improve its instructions. Repeats up to 3 cycles or until the agent runs cleanly.

## Rules

- Only modify the markdown body (instructions) of SKILL.md, not the YAML frontmatter, unless you ask the user first.
- Stop iterating when the agent completes without errors or after 3 cycles.

## Steps (per cycle)

1. Call \`al_status\` to ensure the scheduler is running. Start it with \`al_start\` if needed.

2. Call \`al_run\` with the agent name (use \`$ARGUMENTS\` if provided).

3. Wait for the run to complete, then call \`al_logs\` with \`lines: 300\` to get the full output.

4. Analyze the result:
   - Did the agent complete its task successfully?
   - Were there errors, unnecessary steps, or suboptimal behavior?

5. If improvements are needed:
   - Read the current SKILL.md file
   - Edit the instruction body to address the issues found
   - Explain what you changed and why
   - Start the next cycle

6. If the run was clean, report success and summarize what was changed across all cycles.
`,

  "status": `# Status overview

Show a rich overview of the Action Llama project status.

## Steps

1. Call \`al_status\` and \`al_agents\` in parallel to gather scheduler state and agent details.

2. Present a formatted overview:

   **Scheduler**: running/stopped, uptime, gateway URL

   **Agents**:
   | Agent | State | Trigger | Last Run | Next Run |
   |-------|-------|---------|----------|----------|
   | ...   | ...   | ...     | ...      | ...      |

   Include schedule expressions, webhook configs, and credential status for each agent.

3. Add actionable suggestions if relevant:
   - Agents that are paused or erroring
   - Agents that haven't run recently
   - Missing credentials flagged by \`al_agents\`
`,
};

/**
 * Scaffold Claude Code slash commands into .claude/commands/.
 * Skips files that already exist to avoid overwriting user customizations.
 */
export function scaffoldClaudeCommands(projectPath: string): void {
  const commandsDir = resolve(projectPath, ".claude", "commands");
  mkdirSync(commandsDir, { recursive: true });
  for (const [name, content] of Object.entries(CLAUDE_COMMANDS)) {
    const filePath = resolve(commandsDir, `${name}.md`);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, content);
    }
  }
}
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

  // Create .mcp.json for Claude Code MCP integration
  const mcpJsonPath = resolve(projectPath, ".mcp.json");
  if (!existsSync(mcpJsonPath)) {
    writeFileSync(mcpJsonPath, JSON.stringify({
      mcpServers: {
        "action-llama": {
          command: "al",
          args: ["mcp", "serve"],
        },
      },
    }, null, 2) + "\n");
  }

  // Scaffold Claude Code slash commands
  scaffoldClaudeCommands(projectPath);
}
