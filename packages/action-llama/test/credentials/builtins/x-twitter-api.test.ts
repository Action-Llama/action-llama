import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/setup/validators.js", () => ({
  validateXTwitterToken: vi.fn(),
}));

import xTwitterApi from "../../../src/credentials/builtins/x-twitter-api.js";
import * as validators from "../../../src/setup/validators.js";

const mockedValidateXTwitterToken = vi.mocked(validators.validateXTwitterToken);

describe("x_twitter_api credential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct id", () => {
    expect(xTwitterApi.id).toBe("x_twitter_api");
  });

  it("has three fields: consumer_key, consumer_secret, bearer_token", () => {
    expect(xTwitterApi.fields).toHaveLength(3);
    const names = xTwitterApi.fields.map((f) => f.name);
    expect(names).toContain("consumer_key");
    expect(names).toContain("consumer_secret");
    expect(names).toContain("bearer_token");
  });

  it("all fields are marked as secret", () => {
    for (const field of xTwitterApi.fields) {
      expect(field.secret).toBe(true);
    }
  });

  it("maps consumer_key to X_CONSUMER_KEY env var", () => {
    expect(xTwitterApi.envVars?.consumer_key).toBe("X_CONSUMER_KEY");
  });

  it("maps consumer_secret to X_CONSUMER_SECRET env var", () => {
    expect(xTwitterApi.envVars?.consumer_secret).toBe("X_CONSUMER_SECRET");
  });

  it("maps bearer_token to X_BEARER_TOKEN env var", () => {
    expect(xTwitterApi.envVars?.bearer_token).toBe("X_BEARER_TOKEN");
  });

  it("has helpUrl pointing to developer.x.com", () => {
    expect(xTwitterApi.helpUrl).toContain("developer.x.com");
  });

  describe("validate", () => {
    it("validates using the bearer_token field", async () => {
      mockedValidateXTwitterToken.mockResolvedValue(undefined as any);

      await xTwitterApi.validate!({ consumer_key: "ck", consumer_secret: "cs", bearer_token: "my-bearer" });

      expect(mockedValidateXTwitterToken).toHaveBeenCalledWith("my-bearer");
    });

    it("returns true when validation succeeds", async () => {
      mockedValidateXTwitterToken.mockResolvedValue(undefined as any);

      const result = await xTwitterApi.validate!({
        consumer_key: "ck",
        consumer_secret: "cs",
        bearer_token: "valid-token",
      });
      expect(result).toBe(true);
    });

    it("throws when validateXTwitterToken throws", async () => {
      mockedValidateXTwitterToken.mockRejectedValue(new Error("X auth failed: 401"));

      await expect(
        xTwitterApi.validate!({ consumer_key: "ck", consumer_secret: "cs", bearer_token: "bad" })
      ).rejects.toThrow("X auth failed: 401");
    });
  });
});
