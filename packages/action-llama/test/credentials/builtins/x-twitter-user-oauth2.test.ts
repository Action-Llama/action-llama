import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock child_process to prevent browser from being opened
vi.mock("child_process", () => ({
  exec: vi.fn(),
}));

// Mock http to prevent a real server from being started and to immediately
// simulate an OAuth callback so the PKCE flow resolves/rejects fast.
let capturedHandler: ((req: any, res: any) => void) | null = null;

vi.mock("http", () => ({
  createServer: vi.fn((handler: (req: any, res: any) => void) => {
    capturedHandler = handler;
    return {
      on: vi.fn(),
      close: vi.fn(),
      listen: vi.fn((_port: number, _host: string, callback: () => void) => {
        // Call the listen callback immediately (no real port is opened)
        callback();
        // Immediately invoke the captured handler with an error callback request
        // so that runPkceFlow rejects right away instead of hanging for 2 minutes.
        if (capturedHandler) {
          const mockReq = { url: "/callback?error=test_abort" };
          const mockRes = { writeHead: vi.fn(), end: vi.fn() };
          capturedHandler(mockReq, mockRes);
        }
      }),
    };
  }),
}));

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  password: vi.fn(),
  input: vi.fn(),
  select: vi.fn(),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { confirm, password } from "@inquirer/prompts";
import xTwitterUserOauth2 from "../../../src/credentials/builtins/x-twitter-user-oauth2.js";

const mockedConfirm = vi.mocked(confirm);
const mockedPassword = vi.mocked(password);

describe("x_twitter_user_oauth2 credential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    capturedHandler = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("metadata", () => {
    it("has correct id", () => {
      expect(xTwitterUserOauth2.id).toBe("x_twitter_user_oauth2");
    });

    it("has correct label", () => {
      expect(xTwitterUserOauth2.label).toBe("X (Twitter) User OAuth 2.0 Credentials");
    });

    it("has a helpUrl pointing to developer portal", () => {
      expect(xTwitterUserOauth2.helpUrl).toBe("https://developer.x.com/en/portal/dashboard");
    });

    it("has 4 fields", () => {
      expect(xTwitterUserOauth2.fields).toHaveLength(4);
    });

    it("has client_id field that is secret", () => {
      const field = xTwitterUserOauth2.fields.find((f) => f.name === "client_id");
      expect(field).toBeDefined();
      expect(field!.secret).toBe(true);
    });

    it("has client_secret field that is secret", () => {
      const field = xTwitterUserOauth2.fields.find((f) => f.name === "client_secret");
      expect(field).toBeDefined();
      expect(field!.secret).toBe(true);
    });

    it("has access_token field that is secret", () => {
      const field = xTwitterUserOauth2.fields.find((f) => f.name === "access_token");
      expect(field).toBeDefined();
      expect(field!.secret).toBe(true);
    });

    it("has refresh_token field that is secret", () => {
      const field = xTwitterUserOauth2.fields.find((f) => f.name === "refresh_token");
      expect(field).toBeDefined();
      expect(field!.secret).toBe(true);
    });

    it("maps all envVars correctly", () => {
      expect(xTwitterUserOauth2.envVars).toEqual({
        client_id: "X_OAUTH2_CLIENT_ID",
        client_secret: "X_OAUTH2_CLIENT_SECRET",
        access_token: "X_OAUTH2_ACCESS_TOKEN",
        refresh_token: "X_OAUTH2_REFRESH_TOKEN",
      });
    });

    it("has agentContext string describing env vars", () => {
      expect(typeof xTwitterUserOauth2.agentContext).toBe("string");
      expect(xTwitterUserOauth2.agentContext).toContain("X_OAUTH2_ACCESS_TOKEN");
    });

    it("has a prompt function", () => {
      expect(typeof xTwitterUserOauth2.prompt).toBe("function");
    });

    it("has a validate function", () => {
      expect(typeof xTwitterUserOauth2.validate).toBe("function");
    });
  });

  describe("validate", () => {
    it("returns true when access token is valid", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { username: "testuser" } }),
      });

      const result = await xTwitterUserOauth2.validate!({
        client_id: "cid",
        client_secret: "csecret",
        access_token: "valid-token",
        refresh_token: "refresh-token",
      });

      expect(result).toBe(true);
    });

    it("calls the X API users/me endpoint with Bearer token", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {} }),
      });

      await xTwitterUserOauth2.validate!({
        client_id: "cid",
        client_secret: "csecret",
        access_token: "my-access-token",
        refresh_token: "",
      });

      expect(mockFetch).toHaveBeenCalledWith("https://api.x.com/2/users/me", {
        headers: { Authorization: "Bearer my-access-token" },
      });
    });

    it("throws when API response is not ok", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      await expect(
        xTwitterUserOauth2.validate!({
          client_id: "cid",
          client_secret: "csecret",
          access_token: "bad-token",
          refresh_token: "",
        })
      ).rejects.toThrow("X OAuth 2.0 token validation failed (401)");
    });

    it("logs authenticated username when available", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { username: "myhandle" } }),
      });

      await xTwitterUserOauth2.validate!({
        client_id: "cid",
        client_secret: "csecret",
        access_token: "valid-token",
        refresh_token: "",
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("@myhandle")
      );
      consoleSpy.mockRestore();
    });

    it("does not throw when response has no username", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {} }),
      });

      await expect(
        xTwitterUserOauth2.validate!({
          client_id: "cid",
          client_secret: "csecret",
          access_token: "valid-token",
          refresh_token: "",
        })
      ).resolves.toBe(true);
    });
  });

  describe("prompt — existing credentials", () => {
    it("asks to reuse when both access_token and client_id are present", async () => {
      mockedConfirm.mockResolvedValue(true as any);

      await xTwitterUserOauth2.prompt!({
        client_id: "existing-client-id",
        client_secret: "existing-secret",
        access_token: "existing-token",
        refresh_token: "existing-refresh",
      });

      expect(mockedConfirm).toHaveBeenCalledOnce();
      const call = mockedConfirm.mock.calls[0][0] as any;
      expect(call.default).toBe(true);
    });

    it("returns existing values when user chooses to reuse", async () => {
      const existing = {
        client_id: "existing-client-id",
        client_secret: "existing-secret",
        access_token: "existing-token",
        refresh_token: "existing-refresh",
      };
      mockedConfirm.mockResolvedValue(true as any);

      const result = await xTwitterUserOauth2.prompt!(existing);

      expect(result).toEqual({ values: existing });
    });

    it("does not ask to reuse when access_token is missing", async () => {
      // When no access_token the reuse prompt is skipped and the PKCE flow runs.
      // The http mock immediately fires an error callback so prompt() rejects fast.
      mockedPassword
        .mockResolvedValueOnce("new-client-id" as any)
        .mockResolvedValueOnce("new-client-secret" as any);

      await expect(
        xTwitterUserOauth2.prompt!({ client_id: "cid", client_secret: "csec" })
      ).rejects.toThrow("OAuth 2.0 authorization error");

      // The reuse confirm prompt must NOT have been shown
      expect(mockedConfirm).not.toHaveBeenCalled();
      // The password prompts for client_id and client_secret were called
      expect(mockedPassword).toHaveBeenCalledTimes(2);
    });
  });
});
