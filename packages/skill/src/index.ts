import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");

/** Absolute path to the plugin root (contains .claude-plugin/, skills/, .mcp.json). */
export const pluginDir = packageRoot;

/** Absolute path to the skills directory. */
export const skillsDir = resolve(packageRoot, "skills");

/** Absolute path to the MCP server config. */
export const mcpJsonPath = resolve(packageRoot, ".mcp.json");

/** Absolute path to the plugin manifest. */
export const pluginJsonPath = resolve(packageRoot, ".claude-plugin", "plugin.json");
