import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { safeCompare, authMiddleware } from "../../src/control/auth.js";

const API_KEY = "test-api-key-abc123";

function makeApp(apiKey: string, sessionStore?: any) {
  const app = new Hono();
  app.use("/*", authMiddleware(apiKey, sessionStore));
  app.get("/protected", (c) => c.json({ ok: true }));
  return app;
}

describe("safeCompare", () => {
  it("returns true for identical strings", () => {
    expect(safeCompare("hello", "hello")).toBe(true);
  });

  it("returns false for different strings of same length", () => {
    expect(safeCompare("abc", "xyz")).toBe(false);
  });

  it("returns false for strings of different lengths", () => {
    expect(safeCompare("short", "much-longer-string")).toBe(false);
  });

  it("returns true for empty strings", () => {
    expect(safeCompare("", "")).toBe(true);
  });
});

describe("authMiddleware", () => {
  describe("Bearer token authentication", () => {
    it("allows request with correct Bearer token", async () => {
      const app = makeApp(API_KEY);
      const res = await app.request("/protected", {
        headers: { Authorization: `Bearer ${API_KEY}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    it("rejects request with wrong Bearer token", async () => {
      const app = makeApp(API_KEY);
      const res = await app.request("/protected", {
        headers: { Authorization: "Bearer wrong-key" },
      });
      expect(res.status).toBe(401);
    });

    it("rejects request with no Authorization header", async () => {
      const app = makeApp(API_KEY);
      const res = await app.request("/protected");
      expect(res.status).toBe(401);
    });
  });

  describe("session cookie authentication", () => {
    it("allows request with correct al_session cookie (no session store)", async () => {
      const app = makeApp(API_KEY);
      const res = await app.request("/protected", {
        headers: { Cookie: `al_session=${API_KEY}` },
      });
      expect(res.status).toBe(200);
    });

    it("rejects request with wrong al_session cookie (no session store)", async () => {
      const app = makeApp(API_KEY);
      const res = await app.request("/protected", {
        headers: { Cookie: "al_session=bad-cookie" },
      });
      expect(res.status).toBe(401);
    });

    it("allows request with valid session ID when session store is provided", async () => {
      const sessionStore = {
        getSession: vi.fn().mockResolvedValue({ userId: "user1" }),
      };
      const app = makeApp(API_KEY, sessionStore);
      const res = await app.request("/protected", {
        headers: { Cookie: "al_session=valid-session-id" },
      });
      expect(res.status).toBe(200);
      expect(sessionStore.getSession).toHaveBeenCalledWith("valid-session-id");
    });

    it("rejects request with invalid session ID when session store is provided", async () => {
      const sessionStore = {
        getSession: vi.fn().mockResolvedValue(null),
      };
      const app = makeApp(API_KEY, sessionStore);
      const res = await app.request("/protected", {
        headers: { Cookie: "al_session=invalid-session-id" },
      });
      expect(res.status).toBe(401);
    });

    it("handles multiple cookies in the Cookie header", async () => {
      const app = makeApp(API_KEY);
      const res = await app.request("/protected", {
        headers: { Cookie: `other=value; al_session=${API_KEY}; another=val` },
      });
      expect(res.status).toBe(200);
    });
  });

  describe("browser redirect behavior", () => {
    it("redirects to /login for HTML requests on 401", async () => {
      const app = makeApp(API_KEY);
      const res = await app.request("/protected", {
        headers: { Accept: "text/html,application/xhtml+xml" },
      });
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/login");
    });

    it("returns JSON error for API clients on 401", async () => {
      const app = makeApp(API_KEY);
      const res = await app.request("/protected", {
        headers: { Accept: "application/json" },
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    });
  });
});
