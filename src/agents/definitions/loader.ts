import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { validateDefinition } from "./schema.js";
import type { AgentDefinition } from "./schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BUILTIN_NAMES = ["dev", "reviewer", "devops"];

function builtinDir(name: string): string {
  return resolve(__dirname, name);
}

/**
 * Load a definition by built-in name or filesystem path.
 */
export function loadDefinition(nameOrPath: string): AgentDefinition {
  let defDir: string;

  if (BUILTIN_NAMES.includes(nameOrPath)) {
    defDir = builtinDir(nameOrPath);
  } else {
    defDir = resolve(nameOrPath);
  }

  const jsonPath = resolve(defDir, "config-definition.json");
  if (!existsSync(jsonPath)) {
    throw new Error(
      `Agent definition not found at ${jsonPath}. ` +
      `Provide a built-in name (${BUILTIN_NAMES.join(", ")}) or a path to a definition directory.`
    );
  }

  const raw = JSON.parse(readFileSync(jsonPath, "utf-8"));
  return validateDefinition(raw);
}

/**
 * Load the AGENTS.md from a definition package.
 */
export function loadDefinitionAgentsMd(nameOrPath: string): string {
  let defDir: string;

  if (BUILTIN_NAMES.includes(nameOrPath)) {
    defDir = builtinDir(nameOrPath);
  } else {
    defDir = resolve(nameOrPath);
  }

  const mdPath = resolve(defDir, "AGENTS.md");
  if (!existsSync(mdPath)) {
    throw new Error(
      `No AGENTS.md found in definition at ${defDir}. ` +
      `Create an AGENTS.md in the definition directory.`
    );
  }

  return readFileSync(mdPath, "utf-8");
}

/**
 * List all built-in definitions.
 */
export function listBuiltinDefinitions(): AgentDefinition[] {
  return BUILTIN_NAMES.map((name) => loadDefinition(name));
}

/**
 * Check if a name corresponds to a built-in definition.
 */
export function isBuiltinDefinition(nameOrPath: string): boolean {
  return BUILTIN_NAMES.includes(nameOrPath);
}

