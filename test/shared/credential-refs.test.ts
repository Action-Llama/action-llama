import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDiscoverAgents = vi.fn();
const mockLoadAgentConfig = vi.fn();
vi.mock("../../src/shared/config.js", () => ({
  discoverAgents: (...args: any[]) => mockDiscoverAgents(...args),
  loadAgentConfig: (...args: any[]) => mockLoadAgentConfig(...args),
}));

import { collectCredentialRefs, WEBHOOK_SECRET_TYPES } from "../../src/shared/credential-refs.js";

describe("collectCredentialRefs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("collects agent credential refs", () => {
    mockDiscoverAgents.mockReturnValue(["dev", "reviewer"]);
    mockLoadAgentConfig
      .mockReturnValueOnce({ name: "dev", credentials: ["github_token"] })
      .mockReturnValueOnce({ name: "reviewer", credentials: ["github_token", "slack_token"] });

    const refs = collectCredentialRefs("/tmp/project", {});
    expect(refs).toEqual(new Set(["github_token", "slack_token"]));
  });

  it("collects webhook secret refs from agent triggers", () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadAgentConfig.mockReturnValue({
      name: "dev",
      credentials: ["github_token"],
      webhooks: [{ source: "my-github", events: ["issues"] }],
    });

    const refs = collectCredentialRefs("/tmp/project", {
      webhooks: { "my-github": { type: "github", credential: "MyOrg" } },
    });
    expect(refs).toContain("github_webhook_secret:MyOrg");
    expect(refs).toContain("github_token");
  });

  it("skips webhook secrets when source has no credential", () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadAgentConfig.mockReturnValue({
      name: "dev",
      credentials: [],
      webhooks: [{ source: "my-github", events: ["issues"] }],
    });

    const refs = collectCredentialRefs("/tmp/project", {
      webhooks: { "my-github": { type: "github" } },
    });
    expect(refs.size).toBe(0);
  });

  it("returns empty set when no agents", () => {
    mockDiscoverAgents.mockReturnValue([]);
    const refs = collectCredentialRefs("/tmp/project", {});
    expect(refs.size).toBe(0);
  });

  it("deduplicates refs across agents", () => {
    mockDiscoverAgents.mockReturnValue(["a", "b"]);
    mockLoadAgentConfig
      .mockReturnValueOnce({ name: "a", credentials: ["github_token"] })
      .mockReturnValueOnce({ name: "b", credentials: ["github_token"] });

    const refs = collectCredentialRefs("/tmp/project", {});
    expect(refs.size).toBe(1);
  });
});

describe("WEBHOOK_SECRET_TYPES", () => {
  it("maps github to github_webhook_secret", () => {
    expect(WEBHOOK_SECRET_TYPES.github).toBe("github_webhook_secret");
  });

  it("maps sentry to sentry_client_secret", () => {
    expect(WEBHOOK_SECRET_TYPES.sentry).toBe("sentry_client_secret");
  });
});
