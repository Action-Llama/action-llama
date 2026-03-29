import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch;

import linearOAuth from "../../../src/credentials/builtins/linear-oauth.js";

describe("linear_oauth credential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("metadata", () => {
    it("has correct id", () => {
      expect(linearOAuth.id).toBe("linear_oauth");
    });

    it("has correct label", () => {
      expect(linearOAuth.label).toBe("Linear OAuth2 Token");
    });

    it("has correct description", () => {
      expect(typeof linearOAuth.description).toBe("string");
      expect(linearOAuth.description.length).toBeGreaterThan(0);
    });

    it("has helpUrl pointing to Linear OAuth docs", () => {
      expect(linearOAuth.helpUrl).toBe("https://developers.linear.app/docs/oauth/authentication");
    });

    it("has 4 fields", () => {
      expect(linearOAuth.fields).toHaveLength(4);
    });

    it("has client_id field that is not secret", () => {
      const field = linearOAuth.fields.find((f) => f.name === "client_id");
      expect(field).toBeDefined();
      expect(field!.secret).toBe(false);
    });

    it("has client_secret field that is secret", () => {
      const field = linearOAuth.fields.find((f) => f.name === "client_secret");
      expect(field).toBeDefined();
      expect(field!.secret).toBe(true);
    });

    it("has access_token field that is secret", () => {
      const field = linearOAuth.fields.find((f) => f.name === "access_token");
      expect(field).toBeDefined();
      expect(field!.secret).toBe(true);
    });

    it("has refresh_token field that is secret", () => {
      const field = linearOAuth.fields.find((f) => f.name === "refresh_token");
      expect(field).toBeDefined();
      expect(field!.secret).toBe(true);
    });

    it("maps all envVars correctly", () => {
      expect(linearOAuth.envVars).toEqual({
        client_id: "LINEAR_CLIENT_ID",
        client_secret: "LINEAR_CLIENT_SECRET",
        access_token: "LINEAR_ACCESS_TOKEN",
        refresh_token: "LINEAR_REFRESH_TOKEN",
      });
    });

    it("has agentContext referencing LINEAR_ACCESS_TOKEN", () => {
      expect(typeof linearOAuth.agentContext).toBe("string");
      expect(linearOAuth.agentContext).toContain("LINEAR_ACCESS_TOKEN");
    });

    it("has a validate function", () => {
      expect(typeof linearOAuth.validate).toBe("function");
    });

    it("does not have a prompt function", () => {
      expect(linearOAuth.prompt).toBeUndefined();
    });
  });

  describe("validate", () => {
    it("returns true when access token is valid", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { viewer: { id: "user1", name: "Alice" } } }),
      });

      const result = await linearOAuth.validate!({
        client_id: "cid",
        client_secret: "csecret",
        access_token: "valid-token",
        refresh_token: "refresh-token",
      });

      expect(result).toBe(true);
    });

    it("calls the Linear GraphQL endpoint with Bearer token", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { viewer: { id: "user1", name: "Alice" } } }),
      });

      await linearOAuth.validate!({
        client_id: "cid",
        client_secret: "csecret",
        access_token: "my-token",
        refresh_token: "",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.linear.app/graphql",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer my-token",
            "Content-Type": "application/json",
          }),
        })
      );
    });

    it("throws when access_token is empty string", async () => {
      await expect(
        linearOAuth.validate!({
          client_id: "cid",
          client_secret: "csecret",
          access_token: "",
          refresh_token: "",
        })
      ).rejects.toThrow("Linear OAuth token is required");
    });

    it("throws 'Invalid Linear OAuth token' when response status is 401", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      await expect(
        linearOAuth.validate!({
          client_id: "cid",
          client_secret: "csecret",
          access_token: "bad-token",
          refresh_token: "",
        })
      ).rejects.toThrow("Invalid Linear OAuth token");
    });

    it("throws 'Linear API error' for non-401 error status", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(
        linearOAuth.validate!({
          client_id: "cid",
          client_secret: "csecret",
          access_token: "some-token",
          refresh_token: "",
        })
      ).rejects.toThrow("Linear API error: 500");
    });

    it("throws when response contains GraphQL errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ errors: [{ message: "Unauthorized" }] }),
      });

      await expect(
        linearOAuth.validate!({
          client_id: "cid",
          client_secret: "csecret",
          access_token: "token-with-errors",
          refresh_token: "",
        })
      ).rejects.toThrow("Invalid Linear OAuth token or insufficient permissions");
    });
  });
});
