import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDiscoverAgents = vi.fn();
const mockLoadAgentConfig = vi.fn();
vi.mock("../../src/shared/config.js", () => ({
  discoverAgents: (...args: any[]) => mockDiscoverAgents(...args),
  loadAgentConfig: (...args: any[]) => mockLoadAgentConfig(...args),
}));

import { collectCredentialRefs, credentialRefsToRelativePaths, WEBHOOK_SECRET_TYPES } from "../../src/shared/credential-refs.js";

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
    expect(refs).toEqual(new Set(["github_token", "slack_token", "gateway_api_key:default"]));
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
    expect(refs.size).toBe(1); // Only the implicit gateway_api_key:default
  });

  it("returns empty set when no agents", () => {
    mockDiscoverAgents.mockReturnValue([]);
    const refs = collectCredentialRefs("/tmp/project", {});
    expect(refs.size).toBe(1); // Only the implicit gateway_api_key:default
  });

  it("deduplicates refs across agents", () => {
    mockDiscoverAgents.mockReturnValue(["a", "b"]);
    mockLoadAgentConfig
      .mockReturnValueOnce({ name: "a", credentials: ["github_token"] })
      .mockReturnValueOnce({ name: "b", credentials: ["github_token"] });

    const refs = collectCredentialRefs("/tmp/project", {});
    expect(refs.size).toBe(2); // github_token + gateway_api_key:default
  });
});

describe("credentialRefsToRelativePaths", () => {
  it("converts refs to relative paths", () => {
    const refs = new Set(["github_token:default", "github_token:MyOrg", "slack_token"]);
    const paths = credentialRefsToRelativePaths(refs);
    expect(paths).toContain("github_token/default");
    expect(paths).toContain("github_token/MyOrg");
    expect(paths).toContain("slack_token/default");
    expect(paths).toHaveLength(3);
  });

  it("handles empty set", () => {
    const refs = new Set<string>();
    const paths = credentialRefsToRelativePaths(refs);
    expect(paths).toEqual([]);
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
