import { describe, it, expect } from "vitest";
import { validateAgentConfig } from "../../src/shared/config.js";
import type { AgentConfig } from "../../src/shared/config.js";

const baseConfig: AgentConfig = {
  name: "test",
  credentials: [],
  model: { provider: "anthropic", model: "test", thinkingLevel: "off", authType: "api_key" },
  prompt: "do stuff",
  repos: ["acme/app"],
};

describe("validateAgentConfig", () => {
  it("accepts agent with schedule only", () => {
    expect(() => validateAgentConfig({ ...baseConfig, schedule: "*/5 * * * *" })).not.toThrow();
  });

  it("accepts agent with webhooks only", () => {
    expect(() =>
      validateAgentConfig({
        ...baseConfig,
        webhooks: {
          filters: [{ source: "github", events: ["issues"] }],
        },
      })
    ).not.toThrow();
  });

  it("accepts agent with both schedule and webhooks", () => {
    expect(() =>
      validateAgentConfig({
        ...baseConfig,
        schedule: "*/5 * * * *",
        webhooks: {
          filters: [{ source: "github", events: ["issues"] }],
        },
      })
    ).not.toThrow();
  });

  it("rejects agent with neither schedule nor webhooks", () => {
    expect(() => validateAgentConfig(baseConfig)).toThrow(
      'Agent "test" must have a schedule, webhooks, or both.'
    );
  });
});
