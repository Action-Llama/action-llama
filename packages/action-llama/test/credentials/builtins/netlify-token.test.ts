import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/setup/validators.js", () => ({
  validateNetlifyToken: vi.fn(),
  validateBugsnagToken: vi.fn(),
  validateGitHubToken: vi.fn(),
}));

import netlifyToken from "../../../src/credentials/builtins/netlify-token.js";
import * as validators from "../../../src/setup/validators.js";

const mockedValidateNetlifyToken = vi.mocked(validators.validateNetlifyToken);

describe("netlify_token credential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct id", () => {
    expect(netlifyToken.id).toBe("netlify_token");
  });

  it("has a single token field marked as secret", () => {
    expect(netlifyToken.fields).toHaveLength(1);
    expect(netlifyToken.fields[0].name).toBe("token");
    expect(netlifyToken.fields[0].secret).toBe(true);
  });

  it("maps token field to NETLIFY_AUTH_TOKEN env var", () => {
    expect(netlifyToken.envVars?.token).toBe("NETLIFY_AUTH_TOKEN");
  });

  it("has helpUrl pointing to Netlify", () => {
    expect(netlifyToken.helpUrl).toContain("netlify.com");
  });

  it("has agentContext with NETLIFY_AUTH_TOKEN reference", () => {
    expect(netlifyToken.agentContext).toContain("NETLIFY_AUTH_TOKEN");
  });

  describe("validate", () => {
    it("returns true when validateNetlifyToken resolves", async () => {
      mockedValidateNetlifyToken.mockResolvedValueOnce(undefined as any);

      const result = await netlifyToken.validate!({ token: "test-token" });
      expect(result).toBe(true);
      expect(mockedValidateNetlifyToken).toHaveBeenCalledWith("test-token");
    });

    it("throws when validateNetlifyToken throws", async () => {
      mockedValidateNetlifyToken.mockRejectedValueOnce(new Error("Invalid Netlify token"));

      await expect(netlifyToken.validate!({ token: "bad-token" })).rejects.toThrow(
        "Invalid Netlify token"
      );
    });
  });
});
