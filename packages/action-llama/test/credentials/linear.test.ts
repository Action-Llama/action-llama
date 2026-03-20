import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import linearToken from "../../src/credentials/builtins/linear-token.js";
import linearOAuth from "../../src/credentials/builtins/linear-oauth.js";
import linearWebhookSecret from "../../src/credentials/builtins/linear-webhook-secret.js";

// Mock fetch for testing API validation
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("Linear credentials", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("linear_token", () => {
    it("has correct metadata", () => {
      expect(linearToken.id).toBe("linear_token");
      expect(linearToken.label).toBe("Linear Personal API Token");
      expect(linearToken.helpUrl).toBe("https://linear.app/settings/api");
      expect(linearToken.fields).toEqual([
        { name: "token", label: "API Token", description: "Linear personal API token (lin_api_...)", secret: true }
      ]);
      expect(linearToken.envVars).toEqual({ token: "LINEAR_API_TOKEN" });
    });

    it("validates successfully with good token", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { viewer: { id: "user-123", name: "Test User" } } })
      });

      const result = await linearToken.validate({ token: "valid-token" });
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          "Authorization": "valid-token",
          "Content-Type": "application/json"
        },
        body: expect.stringContaining("viewer")
      });
    });

    it("fails validation with 401 response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401
      });

      await expect(linearToken.validate({ token: "invalid-token" }))
        .rejects.toThrow("Invalid Linear token");
    });

    it("fails validation with GraphQL errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ errors: [{ message: "Invalid token" }] })
      });

      await expect(linearToken.validate({ token: "invalid-token" }))
        .rejects.toThrow("Invalid Linear token or insufficient permissions");
    });

    it("fails validation with empty token", async () => {
      await expect(linearToken.validate({ token: "" }))
        .rejects.toThrow("Linear token is required");
    });

    it("fails validation with non-401 API error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500
      });

      await expect(linearToken.validate({ token: "some-token" }))
        .rejects.toThrow("Linear API error: 500");
    });
  });

  describe("linear_oauth", () => {
    it("has correct metadata", () => {
      expect(linearOAuth.id).toBe("linear_oauth");
      expect(linearOAuth.label).toBe("Linear OAuth2 Token");
      expect(linearOAuth.helpUrl).toBe("https://developers.linear.app/docs/oauth/authentication");
      expect(linearOAuth.fields).toEqual([
        { name: "client_id", label: "Client ID", description: "Linear OAuth application client ID", secret: false },
        { name: "client_secret", label: "Client Secret", description: "Linear OAuth application client secret", secret: true },
        { name: "access_token", label: "Access Token", description: "OAuth2 access token", secret: true },
        { name: "refresh_token", label: "Refresh Token", description: "OAuth2 refresh token (optional)", secret: true }
      ]);
      expect(linearOAuth.envVars).toEqual({
        client_id: "LINEAR_CLIENT_ID",
        client_secret: "LINEAR_CLIENT_SECRET",
        access_token: "LINEAR_ACCESS_TOKEN",
        refresh_token: "LINEAR_REFRESH_TOKEN"
      });
    });

    it("validates successfully with good OAuth token", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { viewer: { id: "user-123", name: "Test User" } } })
      });

      const result = await linearOAuth.validate({
        client_id: "client-123",
        client_secret: "secret-456",
        access_token: "access-token-789",
        refresh_token: "refresh-token-abc"
      });

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          "Authorization": "Bearer access-token-789",
          "Content-Type": "application/json"
        },
        body: expect.stringContaining("viewer")
      });
    });

    it("fails validation with 401 response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401
      });

      await expect(linearOAuth.validate({
        client_id: "client-123",
        client_secret: "secret-456",
        access_token: "invalid-token",
        refresh_token: ""
      })).rejects.toThrow("Invalid Linear OAuth token");
    });

    it("fails validation with empty access token", async () => {
      await expect(linearOAuth.validate({
        client_id: "client-123",
        client_secret: "secret-456",
        access_token: "",
        refresh_token: ""
      })).rejects.toThrow("Linear OAuth token is required");
    });
  });

  describe("linear_webhook_secret", () => {
    it("has correct metadata", () => {
      expect(linearWebhookSecret.id).toBe("linear_webhook_secret");
      expect(linearWebhookSecret.label).toBe("Linear Webhook Secret");
      expect(linearWebhookSecret.helpUrl).toBe("https://developers.linear.app/docs/webhooks");
      expect(linearWebhookSecret.fields).toEqual([
        { name: "secret", label: "Webhook Secret", description: "Linear webhook secret for HMAC validation", secret: true }
      ]);
      expect(linearWebhookSecret.envVars).toEqual({});
    });

    it("validates successfully with good secret", async () => {
      const result = await linearWebhookSecret.validate({ secret: "good-webhook-secret" });
      expect(result).toBe(true);
    });

    it("fails validation with short secret", async () => {
      await expect(linearWebhookSecret.validate({ secret: "short" }))
        .rejects.toThrow("Linear webhook secret must be at least 8 characters");
    });

    it("fails validation with empty secret", async () => {
      await expect(linearWebhookSecret.validate({ secret: "" }))
        .rejects.toThrow("Linear webhook secret must be at least 8 characters");
    });

    it("fails validation with missing secret", async () => {
      await expect(linearWebhookSecret.validate({}))
        .rejects.toThrow("Linear webhook secret must be at least 8 characters");
    });
  });
});