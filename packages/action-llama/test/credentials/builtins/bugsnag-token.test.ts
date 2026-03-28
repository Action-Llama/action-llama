import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/setup/validators.js", () => ({
  validateBugsnagToken: vi.fn(),
  validateNetlifyToken: vi.fn(),
  validateGitHubToken: vi.fn(),
}));

import bugsnagToken from "../../../src/credentials/builtins/bugsnag-token.js";
import * as validators from "../../../src/setup/validators.js";

const mockedValidateBugsnagToken = vi.mocked(validators.validateBugsnagToken);

describe("bugsnag_token credential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct id", () => {
    expect(bugsnagToken.id).toBe("bugsnag_token");
  });

  it("has a single token field marked as secret", () => {
    expect(bugsnagToken.fields).toHaveLength(1);
    expect(bugsnagToken.fields[0].name).toBe("token");
    expect(bugsnagToken.fields[0].secret).toBe(true);
  });

  it("maps token field to BUGSNAG_AUTH_TOKEN env var", () => {
    expect(bugsnagToken.envVars?.token).toBe("BUGSNAG_AUTH_TOKEN");
  });

  it("has helpUrl pointing to Bugsnag", () => {
    expect(bugsnagToken.helpUrl).toContain("bugsnag.com");
  });

  it("has agentContext with BUGSNAG_AUTH_TOKEN reference", () => {
    expect(bugsnagToken.agentContext).toContain("BUGSNAG_AUTH_TOKEN");
  });

  describe("validate", () => {
    it("returns true when validateBugsnagToken resolves", async () => {
      mockedValidateBugsnagToken.mockResolvedValueOnce(undefined as any);

      const result = await bugsnagToken.validate!({ token: "test-token" });
      expect(result).toBe(true);
      expect(mockedValidateBugsnagToken).toHaveBeenCalledWith("test-token");
    });

    it("throws when validateBugsnagToken throws", async () => {
      mockedValidateBugsnagToken.mockRejectedValueOnce(new Error("Invalid Bugsnag token"));

      await expect(bugsnagToken.validate!({ token: "bad-token" })).rejects.toThrow(
        "Invalid Bugsnag token"
      );
    });
  });
});
