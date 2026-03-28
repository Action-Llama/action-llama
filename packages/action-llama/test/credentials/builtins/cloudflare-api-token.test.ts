import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/cloud/cloudflare/api.js", () => ({
  verifyToken: vi.fn(),
}));

import cloudflareApiToken from "../../../src/credentials/builtins/cloudflare-api-token.js";
import * as cloudflareApi from "../../../src/cloud/cloudflare/api.js";

const mockedVerifyToken = vi.mocked(cloudflareApi.verifyToken);

describe("cloudflare_api_token credential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct id", () => {
    expect(cloudflareApiToken.id).toBe("cloudflare_api_token");
  });

  it("has a single api_token field marked as secret", () => {
    expect(cloudflareApiToken.fields).toHaveLength(1);
    expect(cloudflareApiToken.fields[0].name).toBe("api_token");
    expect(cloudflareApiToken.fields[0].secret).toBe(true);
  });

  it("maps api_token field to CLOUDFLARE_API_TOKEN env var", () => {
    expect(cloudflareApiToken.envVars?.api_token).toBe("CLOUDFLARE_API_TOKEN");
  });

  it("has helpUrl pointing to Cloudflare dashboard", () => {
    expect(cloudflareApiToken.helpUrl).toContain("cloudflare.com");
  });

  it("has agentContext with CLOUDFLARE_API_TOKEN reference", () => {
    expect(cloudflareApiToken.agentContext).toContain("CLOUDFLARE_API_TOKEN");
  });

  describe("validate", () => {
    it("returns true when verifyToken returns true", async () => {
      mockedVerifyToken.mockResolvedValueOnce(true);

      const result = await cloudflareApiToken.validate!({ api_token: "cf-test-token" });
      expect(result).toBe(true);
      expect(mockedVerifyToken).toHaveBeenCalledWith("cf-test-token");
    });

    it("throws when verifyToken returns false", async () => {
      mockedVerifyToken.mockResolvedValueOnce(false);

      await expect(cloudflareApiToken.validate!({ api_token: "bad-token" })).rejects.toThrow(
        "Cloudflare API token is not active"
      );
    });

    it("propagates error thrown by verifyToken", async () => {
      mockedVerifyToken.mockRejectedValueOnce(new Error("Network error"));

      await expect(cloudflareApiToken.validate!({ api_token: "bad-token" })).rejects.toThrow(
        "Network error"
      );
    });
  });
});
