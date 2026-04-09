/**
 * Test project scaffolding — creates temporary Action Llama projects
 * configured to use the mock LLM server.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";
import type { MockLLMServer } from "./mock-llm-server.js";

export interface TestProject {
  /** Absolute path to the project directory. */
  dir: string;
  /** Path to config.toml. */
  configPath: string;
  /** Path to .env.toml. */
  envTomlPath: string;
  /** Port the mock LLM server is running on. */
  mockPort: number;

  /** Add an agent to the project. */
  addAgent(name: string, opts: AgentOpts): void;

  /** Write a credential file. */
  writeCredential(type: string, instance: string, field: string, value: string): void;

  /** Clean up the temporary directory. */
  cleanup(): void;
}

export interface AgentOpts {
  /** SKILL.md body content (markdown, no frontmatter). */
  skill?: string;
  /** Model references from config.toml [models.*]. */
  models?: string[];
  /** Credential refs. */
  credentials?: string[];
  /** Cron schedule expression. */
  schedule?: string;
  /** Runtime configuration. */
  runtime?: { type: "container" | "host-user"; run_as?: string; groups?: string[] };
  /** Timeout in seconds. */
  timeout?: number;
}

/**
 * Create a test project in a temp directory, pre-configured to use the mock LLM.
 */
export function createTestProject(name: string, mockServer: MockLLMServer): TestProject {
  const dir = mkdtempSync(resolve(tmpdir(), `al-e2e-${name}-`));
  const configPath = resolve(dir, "config.toml");
  const envTomlPath = resolve(dir, ".env.toml");

  // Create directories
  mkdirSync(resolve(dir, "agents"), { recursive: true });

  // Write package.json
  writeFileSync(resolve(dir, "package.json"), JSON.stringify({
    name: `test-${name}`,
    version: "1.0.0",
    private: true,
    type: "module",
    dependencies: {
      "@action-llama/action-llama": "*",
    },
  }, null, 2) + "\n");

  // Write config.toml with mock model
  const config: Record<string, unknown> = {
    models: {
      mock: {
        provider: "openai",
        model: "mock-model",
        authType: "api_key",
        baseUrl: mockServer.baseUrl,
      },
    },
    local: {
      image: "node:20-alpine",
    },
  };
  writeFileSync(configPath, stringifyTOML(config) + "\n");

  // Write .env.toml
  writeFileSync(envTomlPath, stringifyTOML({ projectName: `test-${name}` }) + "\n");

  // Write mock API key credential (field name is "token" per openai-key.ts)
  const credsDir = resolve(dir, ".al-credentials");
  mkdirSync(resolve(credsDir, "openai_key", "default"), { recursive: true });
  writeFileSync(resolve(credsDir, "openai_key", "default", "token"), "mock-api-key");

  const project: TestProject = {
    dir,
    configPath,
    envTomlPath,
    mockPort: mockServer.port,

    addAgent(agentName: string, opts: AgentOpts): void {
      const agentDir = resolve(dir, "agents", agentName);
      mkdirSync(agentDir, { recursive: true });

      // Write SKILL.md
      const skillContent = [
        "---",
        `name: ${agentName}`,
        `description: Test agent ${agentName}`,
        "---",
        "",
        opts.skill ?? `# ${agentName}\n\nTest agent.\n`,
      ].join("\n");
      writeFileSync(resolve(agentDir, "SKILL.md"), skillContent);

      // Write config.toml
      const agentConfig: Record<string, unknown> = {};
      agentConfig.models = opts.models ?? ["mock"];
      if (opts.credentials?.length) agentConfig.credentials = opts.credentials;
      if (opts.schedule) agentConfig.schedule = opts.schedule;
      if (opts.timeout) agentConfig.timeout = opts.timeout;
      if (opts.runtime) agentConfig.runtime = opts.runtime;
      writeFileSync(resolve(agentDir, "config.toml"), stringifyTOML(agentConfig) + "\n");
    },

    writeCredential(type: string, instance: string, field: string, value: string): void {
      const credPath = resolve(credsDir, type, instance);
      mkdirSync(credPath, { recursive: true });
      writeFileSync(resolve(credPath, field), value);
    },

    cleanup(): void {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch { /* best effort */ }
    },
  };

  return project;
}
