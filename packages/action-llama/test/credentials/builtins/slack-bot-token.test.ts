import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import slackBotToken from "../../../src/credentials/builtins/slack-bot-token.js";

describe("slack_bot_token credential", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("has correct id", () => {
    expect(slackBotToken.id).toBe("slack_bot_token");
  });

  it("has a single token field marked as secret", () => {
    expect(slackBotToken.fields).toHaveLength(1);
    expect(slackBotToken.fields[0].name).toBe("token");
    expect(slackBotToken.fields[0].secret).toBe(true);
  });

  it("maps token field to SLACK_BOT_TOKEN env var", () => {
    expect(slackBotToken.envVars?.token).toBe("SLACK_BOT_TOKEN");
  });

  it("has helpUrl pointing to Slack API", () => {
    expect(slackBotToken.helpUrl).toContain("slack.com");
  });

  it("has agentContext with SLACK_BOT_TOKEN reference", () => {
    expect(slackBotToken.agentContext).toContain("SLACK_BOT_TOKEN");
  });

  describe("validate", () => {
    it("returns true when Slack auth.test returns ok", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, user: "testbot" }),
      });

      const result = await slackBotToken.validate!({ token: "xoxb-test-token" });
      expect(result).toBe(true);

      expect(mockFetch).toHaveBeenCalledWith("https://slack.com/api/auth.test", {
        method: "POST",
        headers: {
          Authorization: "Bearer xoxb-test-token",
          "Content-Type": "application/json",
        },
      });
    });

    it("throws when token is missing", async () => {
      await expect(slackBotToken.validate!({ token: "" })).rejects.toThrow(
        "Slack bot token is required"
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("throws with error message when Slack returns ok=false", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: false, error: "invalid_auth" }),
      });

      await expect(slackBotToken.validate!({ token: "xoxb-bad-token" })).rejects.toThrow(
        "Invalid Slack bot token: invalid_auth"
      );
    });

    it("throws when token is not provided (undefined)", async () => {
      await expect(slackBotToken.validate!({ token: undefined as any })).rejects.toThrow(
        "Slack bot token is required"
      );
    });
  });
});
