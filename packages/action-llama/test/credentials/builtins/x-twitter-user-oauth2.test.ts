import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer } from "http";

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

  describe("PKCE flow — server handler edge cases", () => {
    /**
     * Helper: override createServer mock for a single call so we control
     * exactly what requests the server handler receives.
     */
    function mockServerWithRequests(requests: Array<{ url: string }>) {
      let localHandler: ((req: any, res: any) => void) | null = null;

      vi.mocked(createServer).mockImplementationOnce((handler: any) => {
        localHandler = handler;
        const serverMock = {
          on: vi.fn(),
          close: vi.fn(),
          listen: vi.fn((_port: number, _host: string, cb: () => void) => {
            // Run the listen callback (logs authUrl, starts browser, sets timeout)
            cb();
            // Fire each request in sequence through the handler
            for (const reqSpec of requests) {
              const res = { writeHead: vi.fn(), end: vi.fn() };
              localHandler!(reqSpec, res);
            }
          }),
        };
        return serverMock;
      });
    }

    it("returns 404 and continues when request path is not /callback", async () => {
      let localHandler: ((req: any, res: any) => void) | null = null;
      const notFoundRes = { writeHead: vi.fn(), end: vi.fn() };

      vi.mocked(createServer).mockImplementationOnce((handler: any) => {
        localHandler = handler;
        const serverMock = {
          on: vi.fn(),
          close: vi.fn(),
          listen: vi.fn((_port: number, _host: string, cb: () => void) => {
            cb();
            // First: non-/callback request → should 404
            localHandler!({ url: "/health" }, notFoundRes);
            // Second: terminate the flow with an error callback
            const errorRes = { writeHead: vi.fn(), end: vi.fn() };
            localHandler!({ url: "/callback?error=abort_after_404" }, errorRes);
          }),
        };
        return serverMock;
      });

      mockedPassword
        .mockResolvedValueOnce("cid" as any)
        .mockResolvedValueOnce("csec" as any);

      await expect(
        xTwitterUserOauth2.prompt!({})
      ).rejects.toThrow("OAuth 2.0 authorization error: abort_after_404");

      expect(notFoundRes.writeHead).toHaveBeenCalledWith(404);
      expect(notFoundRes.end).toHaveBeenCalled();
    });

    it("rejects when code is missing from the callback URL", async () => {
      // No code parameter — state mismatch / invalid callback
      mockServerWithRequests([{ url: "/callback?state=whatever" }]);

      mockedPassword
        .mockResolvedValueOnce("cid" as any)
        .mockResolvedValueOnce("csec" as any);

      await expect(
        xTwitterUserOauth2.prompt!({})
      ).rejects.toThrow("OAuth 2.0 callback: missing code or state mismatch");
    });

    it("rejects when state does not match the expected value", async () => {
      // Code is present but state is wrong
      mockServerWithRequests([{ url: "/callback?code=authcode&state=wrong_state_value" }]);

      mockedPassword
        .mockResolvedValueOnce("cid" as any)
        .mockResolvedValueOnce("csec" as any);

      await expect(
        xTwitterUserOauth2.prompt!({})
      ).rejects.toThrow("OAuth 2.0 callback: missing code or state mismatch");
    });
  });

  describe("PKCE flow — token exchange", () => {
    /**
     * Build a createServer mock that:
     * 1. Captures the authUrl from console.log to extract the state
     * 2. Fires the success callback with the correct code + state
     * 3. Optionally tracks socket connections for shutdown coverage
     */
    function mockServerWithSuccessfulCallback() {
      let localHandler: ((req: any, res: any) => void) | null = null;
      let capturedState: string | null = null;
      const consoleSpy = vi.spyOn(console, "log").mockImplementation((...args: any[]) => {
        const msg = String(args[0] || "");
        // The listen callback logs the authUrl which contains `&state=<hex>`
        const match = msg.match(/[?&]state=([^&\s]+)/);
        if (match) capturedState = match[1];
      });

      const mockSocket = { on: vi.fn(), destroy: vi.fn() };
      let connectionHandler: ((sock: any) => void) | null = null;
      const serverMock = {
        on: vi.fn((event: string, handler: any) => {
          if (event === "connection") connectionHandler = handler;
        }),
        close: vi.fn(),
        listen: vi.fn((_port: number, _host: string, cb: () => void) => {
          cb(); // runs the listen callback → logs authUrl → capturedState is set
          // Exercise socket connection tracking (covers lines 98-99, 103)
          if (connectionHandler) {
            connectionHandler(mockSocket);
            // Simulate socket close event to cover connections.delete
            const closeHandler = mockSocket.on.mock.calls.find(
              (c: any[]) => c[0] === "close"
            )?.[1];
            if (closeHandler) closeHandler();
          }
          // Now fire the success callback with the real state
          const res = { writeHead: vi.fn(), end: vi.fn() };
          localHandler!({ url: `/callback?code=test_auth_code&state=${capturedState}` }, res);
        }),
      };

      vi.mocked(createServer).mockImplementationOnce((handler: any) => {
        localHandler = handler;
        return serverMock;
      });

      return { consoleSpy };
    }

    it("resolves with access_token and refresh_token when token exchange succeeds", async () => {
      const { consoleSpy } = mockServerWithSuccessfulCallback();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "at_abc123", refresh_token: "rt_xyz789" }),
      });

      mockedPassword
        .mockResolvedValueOnce("  my-client-id  " as any)
        .mockResolvedValueOnce("  my-client-secret  " as any);

      const result = await xTwitterUserOauth2.prompt!({});

      expect(result).toEqual({
        values: {
          client_id: "my-client-id",
          client_secret: "my-client-secret",
          access_token: "at_abc123",
          refresh_token: "rt_xyz789",
        },
      });

      consoleSpy.mockRestore();
    });

    it("uses empty string for refresh_token when server omits it", async () => {
      const { consoleSpy } = mockServerWithSuccessfulCallback();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "at_only" }), // no refresh_token
      });

      mockedPassword
        .mockResolvedValueOnce("cid" as any)
        .mockResolvedValueOnce("csec" as any);

      const result = await xTwitterUserOauth2.prompt!({});
      expect((result as any).values.refresh_token).toBe("");
      expect((result as any).values.access_token).toBe("at_only");

      consoleSpy.mockRestore();
    });

    it("rejects when token exchange HTTP response is not ok", async () => {
      const { consoleSpy } = mockServerWithSuccessfulCallback();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "Bad Request",
      });

      mockedPassword
        .mockResolvedValueOnce("cid" as any)
        .mockResolvedValueOnce("csec" as any);

      await expect(
        xTwitterUserOauth2.prompt!({})
      ).rejects.toThrow("Token exchange failed (400): Bad Request");

      consoleSpy.mockRestore();
    });

    it("rejects when token exchange response is missing access_token", async () => {
      const { consoleSpy } = mockServerWithSuccessfulCallback();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token_type: "bearer" }), // no access_token
      });

      mockedPassword
        .mockResolvedValueOnce("cid" as any)
        .mockResolvedValueOnce("csec" as any);

      await expect(
        xTwitterUserOauth2.prompt!({})
      ).rejects.toThrow("Token exchange response missing access_token");

      consoleSpy.mockRestore();
    });
  });

  describe("PKCE flow — timeout", () => {
    it("rejects after 2 minutes with a timeout error", async () => {
      vi.useFakeTimers();

      // Server that never fires any callback (simulates no user interaction)
      vi.mocked(createServer).mockImplementationOnce((_handler: any) => {
        return {
          on: vi.fn(),
          close: vi.fn(),
          listen: vi.fn((_port: number, _host: string, cb: () => void) => {
            cb(); // run listen callback but never fire a request
          }),
        };
      });

      mockedPassword
        .mockResolvedValueOnce("cid" as any)
        .mockResolvedValueOnce("csec" as any);

      // Attach error handler immediately so Node.js never sees an unhandled rejection
      let caughtError: Error | null = null;
      const promptPromise = xTwitterUserOauth2.prompt!({}).catch((e) => {
        caughtError = e;
      });

      // Advance fake timers by 2 minutes to trigger the timeout
      await vi.advanceTimersByTimeAsync(120_001);
      await promptPromise;

      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toBe("OAuth 2.0 authorization timed out (2 minutes)");

      vi.useRealTimers();
    });
  });

  describe("PKCE flow — shutdown with active connections (line 103 coverage)", () => {
    it("calls sock.destroy() on each active connection when the OAuth flow errors (covers shutdown body)", async () => {
      // Build a mock socket that we can spy on
      const mockSockDestroy = vi.fn();
      const mockSock = {
        destroy: mockSockDestroy,
        on: vi.fn(), // sock.on("close", ...) — we don't care about this in this test
      };

      let localHandler: ((req: any, res: any) => void) | null = null;

      // Override createServer for this one call so the "connection" event
      // handler fires synchronously with our mock socket.
      vi.mocked(createServer).mockImplementationOnce((handler: any) => {
        localHandler = handler;
        return {
          // When the server registers a "connection" listener, immediately
          // call it with mockSock so that connections.add(mockSock) runs.
          on: vi.fn((event: string, cb: (...args: any[]) => void) => {
            if (event === "connection") {
              cb(mockSock);
            }
          }),
          close: vi.fn(),
          listen: vi.fn((_port: number, _host: string, listenCb: () => void) => {
            listenCb(); // run the listen callback (opens browser, etc.)
            // Immediately fire an error callback so the flow rejects and calls shutdown()
            localHandler!(
              { url: "/callback?error=test_conn_cleanup" },
              { writeHead: vi.fn(), end: vi.fn() }
            );
          }),
        };
      });

      mockedPassword
        .mockResolvedValueOnce("test-cid" as any)
        .mockResolvedValueOnce("test-csec" as any);

      await expect(
        xTwitterUserOauth2.prompt!({})
      ).rejects.toThrow("OAuth 2.0 authorization error: test_conn_cleanup");

      // shutdown() ran and iterated over connections — sock.destroy() must have
      // been called exactly once (covers the for-loop body at line 103).
      expect(mockSockDestroy).toHaveBeenCalledTimes(1);
    });
  });
});
