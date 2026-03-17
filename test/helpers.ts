import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";
import type { GlobalConfig, AgentConfig } from "../src/shared/config.js";

// --- Factories ---

const DEFAULT_MODEL = {
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  thinkingLevel: "medium" as const,
  authType: "api_key" as const,
};

/** Build a model config with optional overrides. */
export function makeModel(overrides?: Partial<typeof DEFAULT_MODEL>): typeof DEFAULT_MODEL {
  return { ...DEFAULT_MODEL, ...overrides };
}

/** Build an AgentConfig with sensible defaults. Override any field. */
export function makeAgentConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    name: "test-agent",
    credentials: ["github_token:default"],
    model: makeModel(),
    schedule: "*/5 * * * *",
    params: {},
    ...overrides,
  };
}

/** Build a GlobalConfig with optional overrides. */
export function makeGlobalConfig(overrides?: Partial<GlobalConfig>): GlobalConfig {
  return { ...overrides };
}

// --- Temp project scaffolding ---

export interface TmpProjectOptions {
  global?: Partial<GlobalConfig>;
  agents?: Partial<AgentConfig>[];
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

  const globalConfig = makeGlobalConfig(opts?.global);

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
    // Strip name before writing (matches scaffold behavior)
    const { name: _, ...configToWrite } = agent;
    writeFileSync(
      resolve(agentPath, "agent-config.toml"),
      stringifyTOML(configToWrite as Record<string, unknown>)
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
