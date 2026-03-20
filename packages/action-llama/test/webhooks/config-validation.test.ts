import { describe, it, expect } from "vitest";
import { validateAgentConfig } from "../../src/shared/config.js";
import { makeAgentConfig } from "../helpers.js";

const baseConfig = makeAgentConfig({ name: "test", credentials: [], schedule: undefined });

describe("validateAgentConfig", () => {
  it("accepts agent with schedule only", () => {
    expect(() => validateAgentConfig({ ...baseConfig, schedule: "*/5 * * * *" })).not.toThrow();
  });

  it("accepts agent with webhooks only", () => {
    expect(() =>
      validateAgentConfig({
        ...baseConfig,
        webhooks: [{ source: "my-github", events: ["issues"] }],
      })
    ).not.toThrow();
  });

  it("accepts agent with both schedule and webhooks", () => {
    expect(() =>
      validateAgentConfig({
        ...baseConfig,
        schedule: "*/5 * * * *",
        webhooks: [{ source: "my-github", events: ["issues"] }],
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

  it("accepts agent with scale = 0 and no schedule or webhooks", () => {
    expect(() => validateAgentConfig({ ...baseConfig, scale: 0 })).not.toThrow();
  });

  it("accepts agent with scale = 0 and a schedule", () => {
    expect(() => validateAgentConfig({ ...baseConfig, scale: 0, schedule: "*/5 * * * *" })).not.toThrow();
  });
});
