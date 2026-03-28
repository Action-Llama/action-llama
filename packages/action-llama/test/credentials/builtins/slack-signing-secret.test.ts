import { describe, it, expect } from "vitest";

import slackSigningSecret from "../../../src/credentials/builtins/slack-signing-secret.js";

describe("slack_signing_secret credential", () => {
  it("has correct id", () => {
    expect(slackSigningSecret.id).toBe("slack_signing_secret");
  });

  it("has a single secret field marked as secret", () => {
    expect(slackSigningSecret.fields).toHaveLength(1);
    expect(slackSigningSecret.fields[0].name).toBe("secret");
    expect(slackSigningSecret.fields[0].secret).toBe(true);
  });

  it("has no envVars (not injected into agents)", () => {
    expect(slackSigningSecret.envVars).toBeUndefined();
  });

  it("has helpUrl pointing to Slack API documentation", () => {
    expect(slackSigningSecret.helpUrl).toContain("slack.com");
  });

  describe("validate", () => {
    it("returns true for a valid signing secret", async () => {
      const result = await slackSigningSecret.validate!({ secret: "abc1234defgh" });
      expect(result).toBe(true);
    });

    it("throws when secret is empty string", async () => {
      await expect(slackSigningSecret.validate!({ secret: "" })).rejects.toThrow(
        "Signing secret is required"
      );
    });

    it("throws when secret is too short (less than 8 chars)", async () => {
      await expect(slackSigningSecret.validate!({ secret: "abc123" })).rejects.toThrow(
        "Signing secret must be at least 8 characters"
      );
    });

    it("returns true when secret is exactly 8 characters", async () => {
      const result = await slackSigningSecret.validate!({ secret: "abcdefgh" });
      expect(result).toBe(true);
    });

    it("throws when secret is undefined", async () => {
      await expect(slackSigningSecret.validate!({ secret: undefined as any })).rejects.toThrow(
        "Signing secret is required"
      );
    });
  });
});
