import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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

describe("Gateway log endpoints authentication", () => {
  let gateway: any;
  const TEST_API_KEY = "test-secret-key-123";
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  beforeAll(async () => {
    const mockFrontendDist = createMockFrontendDist();
    gateway = await startGateway({
      port: 0, // Random port
      logger,
      apiKey: TEST_API_KEY,
      projectPath: "/tmp", // Required for log routes to be registered
      webUI: true, // Enable dashboard routes
      frontendDistPath: mockFrontendDist,
      statusTracker: {
        getAllAgents: () => [],
        getSchedulerInfo: () => ({}),
        getRecentLogs: () => [],
        getInstances: () => [],
        on: vi.fn(),
        removeListener: vi.fn(),
      } as any, // Mock status tracker
    });
  });

  afterAll(async () => {
    await gateway.close();
  });

  it("should protect /api/logs/scheduler endpoint", async () => {
    const addr = gateway.server.address() as any;
    const baseUrl = `http://localhost:${addr.port}`;

    // Without auth - should return 401
    const res1 = await fetch(`${baseUrl}/api/logs/scheduler`);
    expect(res1.status).toBe(401);
    const body1 = await res1.json();
    expect(body1.error).toBe("Unauthorized");

    // With valid auth - should return 200
    const res2 = await fetch(`${baseUrl}/api/logs/scheduler`, {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
    expect(res2.status).toBe(200);
  });

  it("should protect /api/logs/agents/:name endpoint", async () => {
    const addr = gateway.server.address() as any;
    const baseUrl = `http://localhost:${addr.port}`;

    // Without auth - should return 401
    const res1 = await fetch(`${baseUrl}/api/logs/agents/test-agent`);
    expect(res1.status).toBe(401);

    // With valid auth - should return 200
    const res2 = await fetch(`${baseUrl}/api/logs/agents/test-agent`, {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
    expect(res2.status).toBe(200);
  });

  it("should protect /api/logs/agents/:name/:instanceId endpoint", async () => {
    const addr = gateway.server.address() as any;
    const baseUrl = `http://localhost:${addr.port}`;

    // Without auth - should return 401
    const res1 = await fetch(`${baseUrl}/api/logs/agents/test-agent/1`);
    expect(res1.status).toBe(401);

    // With valid auth - should return 200
    const res2 = await fetch(`${baseUrl}/api/logs/agents/test-agent/1`, {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
    expect(res2.status).toBe(200);
  });

  it("should serve SPA for dashboard sub-routes (SPA handles auth client-side)", async () => {
    const addr = gateway.server.address() as any;
    const baseUrl = `http://localhost:${addr.port}`;

    // Browser request without auth - SPA mode serves index.html
    const res1 = await fetch(`${baseUrl}/dashboard/agents/test-agent/logs`, {
      headers: { Accept: "text/html" },
      redirect: "manual",
    });
    // SPA mode: serves index.html, client handles auth redirect
    expect(res1.status).toBe(200);
    const html = await res1.text();
    expect(html).toContain('<div id="root">');
  });
});