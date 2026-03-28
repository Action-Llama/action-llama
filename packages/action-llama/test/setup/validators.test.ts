import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  validateGitHubToken,
  validateSentryToken,
  validateSentryProjects,
  validateAnthropicApiKey,
  validateOAuthTokenFormat,
  validateNetlifyToken,
  validateXTwitterToken,
  validateBugsnagToken,
} from "../../src/setup/validators.js";

describe("validateGitHubToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns user and repos on success", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ login: "octocat" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ owner: { login: "octocat" }, name: "hello-world", full_name: "octocat/hello-world" }]),
      });

    const result = await validateGitHubToken("ghp_test");
    expect(result.user).toBe("octocat");
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].fullName).toBe("octocat/hello-world");
  });

  it("throws on auth failure", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(validateGitHubToken("bad")).rejects.toThrow("GitHub auth failed: 401");
  });

  it("throws when repos fetch fails", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ login: "octocat" }),
      })
      .mockResolvedValueOnce({ ok: false, status: 403 });

    await expect(validateGitHubToken("ghp_test")).rejects.toThrow("GitHub repos fetch failed: 403");
  });
});

describe("validateSentryToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns organizations on success", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ slug: "myorg", name: "My Org" }]),
    });

    const result = await validateSentryToken("sntrys_test");
    expect(result.organizations).toHaveLength(1);
    expect(result.organizations[0].slug).toBe("myorg");
  });

  it("throws on auth failure", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });
    await expect(validateSentryToken("bad")).rejects.toThrow("Sentry auth failed: 401");
  });
});

describe("validateSentryProjects", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns projects", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ slug: "web-app", name: "Web App" }]),
    });

    const result = await validateSentryProjects("token", "myorg");
    expect(result.projects).toHaveLength(1);
  });

  it("throws on fetch failure", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(validateSentryProjects("token", "myorg")).rejects.toThrow(
      "Sentry projects fetch failed: 500"
    );
  });
});

describe("validateAnthropicApiKey", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true on valid key", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const result = await validateAnthropicApiKey("sk-ant-api-test");
    expect(result).toBe(true);
  });

  it("throws on invalid key", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Invalid key"),
    });
    await expect(validateAnthropicApiKey("bad")).rejects.toThrow(
      "Anthropic API key validation failed (401)"
    );
  });
});

describe("validateOAuthTokenFormat", () => {
  it("returns true for valid oauth token", () => {
    expect(validateOAuthTokenFormat("sk-ant-oat-abcdef")).toBe(true);
  });

  it("throws for non-oauth token", () => {
    expect(() => validateOAuthTokenFormat("sk-ant-api-xyz")).toThrow(
      "does not look like an Anthropic OAuth token"
    );
  });
});

describe("validateNetlifyToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns user info on success", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ email: "user@example.com", full_name: "John Doe" }),
    });

    const result = await validateNetlifyToken("netlify_test_token");
    expect(result.user).toBe("user@example.com");
    expect(result.fullName).toBe("John Doe");
  });

  it("throws on auth failure", async () => {
    mockFetch.mockResolvedValue({ 
      ok: false, 
      status: 401,
      text: () => Promise.resolve("Unauthorized")
    });
    
    await expect(validateNetlifyToken("bad_token")).rejects.toThrow("Netlify auth failed (401): Unauthorized");
  });
});

describe("validateXTwitterToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true on valid bearer token", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const result = await validateXTwitterToken("valid-bearer-token");
    expect(result).toBe(true);
  });

  it("throws on auth failure", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    });
    await expect(validateXTwitterToken("bad-token")).rejects.toThrow(
      "X (Twitter) API token validation failed (401): Unauthorized"
    );
  });
});

describe("validateBugsnagToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns user info on success", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "user-1", name: "Alice", email: "alice@example.com" }),
    });

    const result = await validateBugsnagToken("valid-token");
    expect(result.user).toBe("alice@example.com");
    expect(result.name).toBe("Alice");
    expect(result.id).toBe("user-1");
  });

  it("throws on auth failure", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    });
    await expect(validateBugsnagToken("bad-token")).rejects.toThrow(
      "Bugsnag auth failed (401): Unauthorized"
    );
  });
});
