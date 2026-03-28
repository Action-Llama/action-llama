import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/setup/validators.js", () => ({
  validateGitHubToken: vi.fn(),
}));

import githubToken from "../../../src/credentials/builtins/github-token.js";
import * as validators from "../../../src/setup/validators.js";

const mockedValidateGitHubToken = vi.mocked(validators.validateGitHubToken);

describe("github_token credential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct id", () => {
    expect(githubToken.id).toBe("github_token");
  });

  it("has a single token field marked as secret", () => {
    expect(githubToken.fields).toHaveLength(1);
    expect(githubToken.fields[0].name).toBe("token");
    expect(githubToken.fields[0].secret).toBe(true);
  });

  it("maps token field to GITHUB_TOKEN env var", () => {
    expect(githubToken.envVars?.token).toBe("GITHUB_TOKEN");
  });

  it("has a helpUrl pointing to github.com", () => {
    expect(githubToken.helpUrl).toContain("github.com");
  });

  it("has agentContext with GITHUB_TOKEN reference", () => {
    expect(githubToken.agentContext).toContain("GITHUB_TOKEN");
  });

  describe("validate", () => {
    it("calls validateGitHubToken with the provided token", async () => {
      mockedValidateGitHubToken.mockResolvedValue({ user: "alice", repos: [] });

      await githubToken.validate!({ token: "ghp_abc123" });

      expect(mockedValidateGitHubToken).toHaveBeenCalledWith("ghp_abc123");
    });

    it("returns true when validation succeeds", async () => {
      mockedValidateGitHubToken.mockResolvedValue({ user: "alice", repos: [] });

      const result = await githubToken.validate!({ token: "ghp_valid" });
      expect(result).toBe(true);
    });

    it("throws when validateGitHubToken throws", async () => {
      mockedValidateGitHubToken.mockRejectedValue(new Error("GitHub auth failed: 401"));

      await expect(githubToken.validate!({ token: "bad-token" })).rejects.toThrow(
        "GitHub auth failed: 401"
      );
    });
  });
});
