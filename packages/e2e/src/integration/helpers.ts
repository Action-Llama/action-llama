import type { ModelConfig, AgentConfig } from "@action-llama/action-llama/internals/config";

const DEFAULT_MODEL: ModelConfig = {
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  thinkingLevel: "medium" as const,
  authType: "api_key" as const,
};

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
