import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
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
    credentials: ["github-token"],
    model: DEFAULT_MODEL,
    schedule: "*/5 * * * *",
    prompt: "Poll GitHub for new issues with the trigger label and implement any found.",
    repos: ["acme/app"],
    params: { triggerLabel: "agent", assignee: "bot" },
  },
  {
    name: "reviewer",
    credentials: ["github-token"],
    model: DEFAULT_MODEL,
    schedule: "*/5 * * * *",
    prompt: "Poll GitHub for open PRs that need review, review them, and merge if appropriate.",
    repos: ["acme/app"],
  },
  {
    name: "devops",
    credentials: ["github-token"],
    model: DEFAULT_MODEL,
    schedule: "*/15 * * * *",
    prompt: "Poll for new errors from GitHub Actions failures and Sentry, file issues for any new ones found.",
    repos: ["acme/app"],
  },
];

export function makeTmpProject(opts?: TmpProjectOptions): string {
  const dir = mkdtempSync(join(tmpdir(), "al-cmd-"));

  const globalConfig: GlobalConfig = {
    ...DEFAULT_GLOBAL,
    ...opts?.global,
  };
  if (Object.keys(globalConfig).length > 0) {
    writeFileSync(resolve(dir, "config.json"), JSON.stringify(globalConfig));
  }

  const agents = opts?.agents
    ? opts.agents.map((a, i) => ({ ...DEFAULT_AGENTS[i], ...a }))
    : DEFAULT_AGENTS;

  for (const agent of agents) {
    const agentPath = resolve(dir, agent.name!);
    mkdirSync(agentPath, { recursive: true });
    // Strip name before writing (matches scaffold behavior)
    const { name: _, ...configToWrite } = agent;
    writeFileSync(resolve(agentPath, "config.json"), JSON.stringify(configToWrite));
  }

  // Create state dirs and default state files
  const STATE_FILES: Record<string, { name: string; content: object }> = {
    dev: { name: "active-issues.json", content: { issues: {} } },
    reviewer: { name: "reviewed-prs.json", content: { prs: {} } },
    devops: { name: "known-errors.json", content: { errors: {} } },
  };

  for (const agent of agents) {
    const stateDir = resolve(dir, ".al", "state", agent.name!);
    mkdirSync(stateDir, { recursive: true });
    // Write default state files for known agent names
    const stateInfo = STATE_FILES[agent.name!];
    if (stateInfo) {
      writeFileSync(resolve(stateDir, stateInfo.name), JSON.stringify(stateInfo.content));
    }
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
