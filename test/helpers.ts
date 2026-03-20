import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";
import { stringify as stringifyYAML } from "yaml";
import type { GlobalConfig, AgentConfig, ModelConfig } from "../src/shared/config.js";

// --- Factories ---

const DEFAULT_MODEL: ModelConfig = {
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  thinkingLevel: "medium" as const,
  authType: "api_key" as const,
};

/** Default model name used in test config.toml [models.*] */
export const DEFAULT_MODEL_NAME = "sonnet";

/** Build a model config with optional overrides. */
export function makeModel(overrides?: Partial<ModelConfig>): ModelConfig {
  return { ...DEFAULT_MODEL, ...overrides };
}

/** Build an AgentConfig with sensible defaults. Override any field. */
export function makeAgentConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    name: "test-agent",
    credentials: ["github_token"],
    models: [makeModel()],
    schedule: "*/5 * * * *",
    params: {},
    ...overrides,
  };
}

/** Build a GlobalConfig with optional overrides. */
export function makeGlobalConfig(overrides?: Partial<GlobalConfig>): GlobalConfig {
  return {
    models: { [DEFAULT_MODEL_NAME]: makeModel() },
    ...overrides,
  };
}

// --- Temp project scaffolding ---

export interface TmpProjectOptions {
  global?: Partial<GlobalConfig>;
  agents?: Partial<AgentConfig>[];
  /** Named model definitions to write to config.toml. Defaults to { sonnet: DEFAULT_MODEL }. */
  modelDefs?: Record<string, ModelConfig>;
  /** Model names to reference in agent SKILL.md. Defaults to ["sonnet"]. */
  modelNames?: string[];
}

const DEFAULT_AGENTS: AgentConfig[] = [
  makeAgentConfig({
    name: "dev",
    params: { repos: ["acme/app"], triggerLabel: "agent", assignee: "bot" },
  }),
  makeAgentConfig({
    name: "reviewer",
    params: { repos: ["acme/app"] },
  }),
  makeAgentConfig({
    name: "devops",
    schedule: "*/15 * * * *",
    params: { repos: ["acme/app"] },
  }),
];

export function makeTmpProject(opts?: TmpProjectOptions): string {
  const dir = mkdtempSync(join(tmpdir(), "al-cmd-"));

  const modelDefs = opts?.modelDefs ?? { [DEFAULT_MODEL_NAME]: makeModel() };
  const modelNames = opts?.modelNames ?? [DEFAULT_MODEL_NAME];

  const globalConfig = makeGlobalConfig({ models: modelDefs, ...opts?.global });

  // [cloud] and [server] belong in environment files, not config.toml.
  // For test convenience, write them to .env.toml (Layer 2 overrides) which
  // bypasses the config.toml restriction while achieving the same merged result.
  const { cloud, server, ...projectConfig } = globalConfig as Record<string, unknown>;
  if (Object.keys(projectConfig).length > 0) {
    writeFileSync(resolve(dir, "config.toml"), stringifyTOML(projectConfig));
  }

  const envOverrides: Record<string, unknown> = {};
  if (cloud) envOverrides.cloud = cloud;
  if (server) envOverrides.server = server;
  if (Object.keys(envOverrides).length > 0) {
    writeFileSync(resolve(dir, ".env.toml"), stringifyTOML(envOverrides));
  }

  const agents = opts?.agents
    ? opts.agents.map((a, i) => ({ ...DEFAULT_AGENTS[i], ...a }))
    : DEFAULT_AGENTS;

  for (const agent of agents) {
    const agentPath = resolve(dir, "agents", agent.name!);
    mkdirSync(agentPath, { recursive: true });
    // Write SKILL.md with model name references (not inline model configs).
    // Strip name and models (resolved at load time from config.toml).
    const { name: _, models: _m, ...configToWrite } = agent;
    const frontmatter: Record<string, unknown> = { ...configToWrite, models: modelNames };
    const yamlStr = stringifyYAML(frontmatter).trimEnd();
    writeFileSync(
      resolve(agentPath, "SKILL.md"),
      `---\n${yamlStr}\n---\n\n# ${agent.name} Agent\n\nCustom agent.\n`
    );
  }

  return dir;
}

/** Captures console.log output during fn execution */
export async function captureLog(fn: () => Promise<void>): Promise<string> {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...args: any[]) => logs.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.log = orig;
  }
  return logs.join("\n");
}

/** Captures console.error output during fn execution */
export async function captureError(fn: () => Promise<void>): Promise<string> {
  const logs: string[] = [];
  const orig = console.error;
  console.error = (...args: any[]) => logs.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.error = orig;
  }
  return logs.join("\n");
}
