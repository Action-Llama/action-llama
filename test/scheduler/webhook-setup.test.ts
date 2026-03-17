import { describe, it, expect } from "vitest";
import { resolveWebhookSource, buildFilterFromTrigger, validateTriggerFields } from "../../src/scheduler/webhook-setup.js";
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

  it("builds GitHub filter with orgs", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-github", orgs: ["acme", "other-org"] },
      "github"
    );
    expect(filter).toEqual({ orgs: ["acme", "other-org"] });
  });

  it("builds GitHub filter with singular org", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-github", org: "acme" },
      "github"
    );
    expect(filter).toEqual({ orgs: ["acme"] });
  });

  it("merges singular org and plural orgs together", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-github", org: "acme", orgs: ["other-org"] },
      "github"
    );
    expect(filter).toEqual({ orgs: ["acme", "other-org"] });
  });
});

describe("validateTriggerFields", () => {
  it("returns no errors for valid github fields", () => {
    const errors = validateTriggerFields(
      { source: "my-github", events: ["issues"], repos: ["acme/app"], org: "acme" },
      "github",
      "agent1"
    );
    expect(errors).toEqual([]);
  });

  it("returns no errors for valid sentry fields", () => {
    const errors = validateTriggerFields(
      { source: "my-sentry", resources: ["issue"] },
      "sentry",
      "agent1"
    );
    expect(errors).toEqual([]);
  });

  it("flags unrecognized fields", () => {
    const errors = validateTriggerFields(
      { source: "my-github", events: ["issues"], repository: "foo" } as any,
      "github",
      "agent1"
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('unrecognized field "repository"');
    expect(errors[0]).toContain('Did you mean "repos"');
  });

  it("flags provider-specific invalid fields (sentry trigger with repos)", () => {
    const errors = validateTriggerFields(
      { source: "my-sentry", repos: ["acme/app"] } as any,
      "sentry",
      "agent1"
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('unrecognized field "repos"');
  });

  it("flags all non-source fields for unknown provider type", () => {
    const errors = validateTriggerFields(
      { source: "x", events: ["a"], repos: ["b"] } as any,
      "unknown",
      "agent1"
    );
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('"events"');
    expect(errors[1]).toContain('"repos"');
  });
});
