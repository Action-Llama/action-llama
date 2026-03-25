import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { startGateway } from "../../src/gateway/index.js";

/** Create a minimal frontend dist fixture for tests that need SPA serving. */
function createMockFrontendDist(): string {
  const dir = mkdtempSync(join(tmpdir(), "mock-frontend-"));
  writeFileSync(join(dir, "index.html"), '<!DOCTYPE html><html><body><div id="root"></div></body></html>');
  mkdirSync(join(dir, "assets"), { recursive: true });
  return dir;
}

function mockStatusTracker() {
  return {
    getAllAgents: () => [],
    getSchedulerInfo: () => null,
    getRecentLogs: () => [],
    on: vi.fn(),
    removeListener: vi.fn(),
  } as any;
}

describe("dashboard auth via startGateway", () => {
  describe("webUI enabled without apiKey", () => {
    let gateway: any;
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    beforeAll(async () => {
      gateway = await startGateway({
        port: 0,
        logger,
        webUI: true,
        statusTracker: mockStatusTracker(),
        // No apiKey
      });
    });

    afterAll(async () => {
      await gateway.close();
    });

    it("logs an error when dashboard requested without api key", () => {
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Dashboard UI requested but no API key configured")
      );
    });

    it("does not serve /dashboard", async () => {
      const addr = gateway.server.address() as any;
      const res = await fetch(`http://localhost:${addr.port}/dashboard`);
      expect(res.status).toBe(404);
    });

    it("does not serve /dashboard/api/status-stream", async () => {
      const addr = gateway.server.address() as any;
      const res = await fetch(`http://localhost:${addr.port}/dashboard/api/status-stream`);
      expect(res.status).toBe(404);
    });

    it("does not redirect / to /dashboard", async () => {
      const addr = gateway.server.address() as any;
      const res = await fetch(`http://localhost:${addr.port}/`, { redirect: "manual" });
      // No redirect registered — 404
      expect(res.status).toBe(404);
    });
  });

  describe("webUI enabled with apiKey", () => {
    let gateway: any;
    const TEST_API_KEY = "test-dashboard-key-456";
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    beforeAll(async () => {
      const mockFrontendDist = createMockFrontendDist();
      gateway = await startGateway({
        port: 0,
        logger,
        apiKey: TEST_API_KEY,
        webUI: true,
        statusTracker: mockStatusTracker(),
        frontendDistPath: mockFrontendDist,
      });
    });

    afterAll(async () => {
      await gateway.close();
    });

    it("serves SPA for unauthenticated browser requests (SPA handles auth)", async () => {
      const addr = gateway.server.address() as any;
      const res = await fetch(`http://localhost:${addr.port}/dashboard`, {
        headers: { Accept: "text/html" },
        redirect: "manual",
      });
      // SPA mode: serves index.html, client-side JS handles auth redirect
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<div id="root">');
    });

    it("returns 401 for unauthenticated API requests", async () => {
      const addr = gateway.server.address() as any;
      const res = await fetch(`http://localhost:${addr.port}/api/dashboard/status`, {
        headers: { Accept: "application/json" },
      });
      expect(res.status).toBe(401);
    });

    it("serves dashboard to authenticated requests", async () => {
      const addr = gateway.server.address() as any;
      const res = await fetch(`http://localhost:${addr.port}/dashboard`, {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });
      expect(res.status).toBe(200);
    });

    it("protects SSE status stream", async () => {
      const addr = gateway.server.address() as any;
      const res = await fetch(`http://localhost:${addr.port}/dashboard/api/status-stream`, {
        headers: { Accept: "application/json" },
      });
      expect(res.status).toBe(401);
    });

    it("redirects / to /dashboard", async () => {
      const addr = gateway.server.address() as any;
      const res = await fetch(`http://localhost:${addr.port}/`, {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        redirect: "manual",
      });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/dashboard");
    });
  });
});
