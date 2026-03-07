import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";
import type { GlobalConfig, AgentConfig } from "../src/shared/config.js";

export interface TmpProjectOptions {
  global?: Partial<GlobalConfig>;
  agents?: Partial<AgentConfig>[];
}

const DEFAULT_MODEL = {
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  thinkingLevel: "medium" as const,
  authType: "api_key" as const,
};

const DEFAULT_GLOBAL: GlobalConfig = {};

const DEFAULT_AGENTS: AgentConfig[] = [
  {
    name: "dev",
    credentials: ["github_token:default"],
    model: DEFAULT_MODEL,
    schedule: "*/5 * * * *",
    params: { repos: ["acme/app"], triggerLabel: "agent", assignee: "bot" },
  },
  {
    name: "reviewer",
    credentials: ["github_token:default"],
    model: DEFAULT_MODEL,
    schedule: "*/5 * * * *",
    params: { repos: ["acme/app"] },
  },
  {
    name: "devops",
    credentials: ["github_token:default"],
    model: DEFAULT_MODEL,
    schedule: "*/15 * * * *",
    params: { repos: ["acme/app"] },
  },
];

export function makeTmpProject(opts?: TmpProjectOptions): string {
  const dir = mkdtempSync(join(tmpdir(), "al-cmd-"));

  const globalConfig: GlobalConfig = {
    ...DEFAULT_GLOBAL,
    ...opts?.global,
  };
  if (Object.keys(globalConfig).length > 0) {
    writeFileSync(resolve(dir, "config.toml"), stringifyTOML(globalConfig as Record<string, unknown>));
  }

  const agents = opts?.agents
    ? opts.agents.map((a, i) => ({ ...DEFAULT_AGENTS[i], ...a }))
    : DEFAULT_AGENTS;

  for (const agent of agents) {
    const agentPath = resolve(dir, agent.name!);
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
