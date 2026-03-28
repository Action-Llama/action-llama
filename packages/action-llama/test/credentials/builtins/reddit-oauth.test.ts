import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch;

import redditOAuth from "../../../src/credentials/builtins/reddit-oauth.js";

describe("reddit_oauth credential", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("metadata", () => {
    it("has correct id", () => {
      expect(redditOAuth.id).toBe("reddit_oauth");
    });

    it("has correct label", () => {
      expect(redditOAuth.label).toBe("Reddit OAuth2 Credentials");
    });

    it("has a helpUrl pointing to reddit apps", () => {
      expect(redditOAuth.helpUrl).toBe("https://www.reddit.com/prefs/apps");
    });

    it("has 5 fields", () => {
      expect(redditOAuth.fields).toHaveLength(5);
    });

    it("has client_id field that is not secret", () => {
      const field = redditOAuth.fields.find((f) => f.name === "client_id");
      expect(field).toBeDefined();
      expect(field!.secret).toBe(false);
    });

    it("has client_secret field that is secret", () => {
      const field = redditOAuth.fields.find((f) => f.name === "client_secret");
      expect(field).toBeDefined();
      expect(field!.secret).toBe(true);
    });

    it("has password field that is secret", () => {
      const field = redditOAuth.fields.find((f) => f.name === "password");
      expect(field).toBeDefined();
      expect(field!.secret).toBe(true);
    });

    it("has user_agent field that is not secret", () => {
      const field = redditOAuth.fields.find((f) => f.name === "user_agent");
      expect(field).toBeDefined();
      expect(field!.secret).toBe(false);
    });

    it("maps all envVars correctly", () => {
      expect(redditOAuth.envVars).toEqual({
        client_id: "REDDIT_CLIENT_ID",
        client_secret: "REDDIT_CLIENT_SECRET",
        username: "REDDIT_USERNAME",
        password: "REDDIT_PASSWORD",
        user_agent: "REDDIT_USER_AGENT",
      });
    });

    it("has agentContext string describing env vars", () => {
      expect(typeof redditOAuth.agentContext).toBe("string");
      expect(redditOAuth.agentContext).toContain("REDDIT_CLIENT_ID");
    });
  });

  describe("validate", () => {
    const validValues = {
      client_id: "my-client-id",
      client_secret: "my-client-secret",
      username: "myuser",
      password: "mypassword",
      user_agent: "script:mybot:v1.0 (by u/myuser)",
    };

    it("returns true on successful authentication", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "test-token", token_type: "bearer" }),
      });

      const result = await redditOAuth.validate!(validValues);

      expect(result).toBe(true);
    });

    it("calls reddit access_token endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "test-token" }),
      });

      await redditOAuth.validate!(validValues);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://www.reddit.com/api/v1/access_token",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("sends Basic auth header with base64 encoded client_id:client_secret", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "test-token" }),
      });

      await redditOAuth.validate!(validValues);

      const expectedAuth = Buffer.from("my-client-id:my-client-secret").toString("base64");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Basic ${expectedAuth}`,
          }),
        })
      );
    });

    it("sends User-Agent header", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "test-token" }),
      });

      await redditOAuth.validate!(validValues);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "User-Agent": validValues.user_agent,
          }),
        })
      );
    });

    it("throws when client_id is empty", async () => {
      await expect(
        redditOAuth.validate!({ ...validValues, client_id: "" })
      ).rejects.toThrow("Reddit client ID is required");
    });

    it("throws when client_secret is empty", async () => {
      await expect(
        redditOAuth.validate!({ ...validValues, client_secret: "" })
      ).rejects.toThrow("Reddit client secret is required");
    });

    it("throws when username is empty", async () => {
      await expect(
        redditOAuth.validate!({ ...validValues, username: "" })
      ).rejects.toThrow("Reddit username is required");
    });

    it("throws when password is empty", async () => {
      await expect(
        redditOAuth.validate!({ ...validValues, password: "" })
      ).rejects.toThrow("Reddit password is required");
    });

    it("throws when user_agent is empty", async () => {
      await expect(
        redditOAuth.validate!({ ...validValues, user_agent: "" })
      ).rejects.toThrow("Reddit user agent is required");
    });

    it("throws on 401 response with invalid credentials message", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401, statusText: "Unauthorized" });

      await expect(redditOAuth.validate!(validValues)).rejects.toThrow(
        "Invalid Reddit credentials or app configuration"
      );
    });

    it("throws on 429 response with rate limit message", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 429, statusText: "Too Many Requests" });

      await expect(redditOAuth.validate!(validValues)).rejects.toThrow(
        "Reddit API rate limit exceeded - try again later"
      );
    });

    it("throws on other non-ok response with status code", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: "Internal Server Error" });

      await expect(redditOAuth.validate!(validValues)).rejects.toThrow(
        "Reddit API error: 500 Internal Server Error"
      );
    });

    it("throws when response contains an error field", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: "invalid_grant",
          error_description: "invalid username/password",
        }),
      });

      await expect(redditOAuth.validate!(validValues)).rejects.toThrow(
        "Reddit OAuth error: invalid_grant - invalid username/password"
      );
    });

    it("throws when response error has no description", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: "some_error" }),
      });

      await expect(redditOAuth.validate!(validValues)).rejects.toThrow(
        "Reddit OAuth error: some_error - Check your credentials"
      );
    });

    it("throws when access_token is missing from response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token_type: "bearer" }),
      });

      await expect(redditOAuth.validate!(validValues)).rejects.toThrow(
        "No access token received from Reddit - check your credentials"
      );
    });
  });
});
