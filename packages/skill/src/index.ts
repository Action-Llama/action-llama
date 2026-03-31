import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contentDir = resolve(__dirname, "..", "content");

/** Absolute path to AGENTS.md (the shared AI reference doc). */
export const agentsMdPath = resolve(contentDir, "AGENTS.md");

/** Absolute path to the MCP server config template. */
export const mcpJsonPath = resolve(contentDir, "mcp.json");

/** Absolute path to the commands directory. */
export const commandsDir = resolve(contentDir, "commands");

/** Map of command name → absolute file path for each Claude Code slash command. */
export const commandPaths: Record<string, string> = {
  "new-agent": resolve(commandsDir, "new-agent.md"),
  "run": resolve(commandsDir, "run.md"),
  "debug": resolve(commandsDir, "debug.md"),
  "iterate": resolve(commandsDir, "iterate.md"),
  "status": resolve(commandsDir, "status.md"),
};
