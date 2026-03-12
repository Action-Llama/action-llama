import { describe, it, expect } from "vitest";
import { resolveWebhookSource, buildFilterFromTrigger } from "../../src/scheduler/webhook-setup.js";
import type { WebhookSourceConfig } from "../../src/shared/config.js";

const webhookSources: Record<string, WebhookSourceConfig> = {
  "my-github": { type: "github", credential: "default" },
  "my-sentry": { type: "sentry", credential: "default" },
  "my-linear": { type: "linear", credential: "default" },
};

describe("resolveWebhookSource", () => {
  it("returns matching source config", () => {
    const result = resolveWebhookSource("my-github", "agent1", webhookSources);
    expect(result).toEqual({ type: "github", credential: "default" });
  });

  it("throws for unknown source", () => {
    expect(() => resolveWebhookSource("missing", "agent1", webhookSources))
      .toThrow('Agent "agent1" references webhook source "missing"');
  });

  it("lists available sources in error message", () => {
    expect(() => resolveWebhookSource("missing", "agent1", webhookSources))
      .toThrow("my-github, my-sentry, my-linear");
  });

  it("shows (none) when no sources exist", () => {
    expect(() => resolveWebhookSource("missing", "agent1", {}))
      .toThrow("(none)");
  });
});

describe("buildFilterFromTrigger", () => {
  it("builds GitHub filter with events and actions", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-github", events: ["issues"], actions: ["opened"] },
      "github"
    );
    expect(filter).toEqual({ events: ["issues"], actions: ["opened"] });
  });

  it("builds GitHub filter with repos and branches", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-github", repos: ["acme/app"], branches: ["main"] },
      "github"
    );
    expect(filter).toEqual({ repos: ["acme/app"], branches: ["main"] });
  });

  it("builds Sentry filter with resources", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-sentry", resources: ["issue"] },
      "sentry"
    );
    expect(filter).toEqual({ resources: ["issue"] });
  });

  it("builds Linear filter with events and organizations", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-linear", events: ["Issue"], organizations: ["acme"] },
      "linear"
    );
    expect(filter).toEqual({ events: ["Issue"], organizations: ["acme"] });
  });

  it("returns undefined when no filter fields set", () => {
    expect(buildFilterFromTrigger({ source: "my-github" }, "github")).toBeUndefined();
    expect(buildFilterFromTrigger({ source: "my-sentry" }, "sentry")).toBeUndefined();
    expect(buildFilterFromTrigger({ source: "my-linear" }, "linear")).toBeUndefined();
  });

  it("returns undefined for unknown provider type", () => {
    expect(buildFilterFromTrigger({ source: "x", events: ["a"] }, "unknown")).toBeUndefined();
  });
});
