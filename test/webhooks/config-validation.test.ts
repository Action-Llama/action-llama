import { describe, it, expect } from "vitest";
import { validateAgentConfig } from "../../src/shared/config.js";
import type { AgentConfig } from "../../src/shared/config.js";

const baseConfig: AgentConfig = {
  name: "test",
  credentials: [],
  model: { provider: "anthropic", model: "test", thinkingLevel: "off", authType: "api_key" },
};

describe("validateAgentConfig", () => {
  it("accepts agent with schedule only", () => {
    expect(() => validateAgentConfig({ ...baseConfig, schedule: "*/5 * * * *" })).not.toThrow();
  });

  it("accepts agent with webhooks only", () => {
    expect(() =>
      validateAgentConfig({
        ...baseConfig,
        webhooks: [{ type: "github", source: "MyOrg", events: ["issues"] }],
      })
    ).not.toThrow();
  });

  it("accepts agent with both schedule and webhooks", () => {
    expect(() =>
      validateAgentConfig({
        ...baseConfig,
        schedule: "*/5 * * * *",
        webhooks: [{ type: "github", source: "MyOrg", events: ["issues"] }],
      })
    ).not.toThrow();
  });

  it("rejects agent with neither schedule nor webhooks", () => {
    expect(() => validateAgentConfig(baseConfig)).toThrow(
      'Agent "test" must have a schedule, webhooks, or both.'
    );
  });

  it("rejects agent with empty webhooks array", () => {
    expect(() => validateAgentConfig({ ...baseConfig, webhooks: [] })).toThrow(
      'Agent "test" must have a schedule, webhooks, or both.'
    );
  });
});
