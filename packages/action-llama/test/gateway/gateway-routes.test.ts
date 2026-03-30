/**
 * Tests for gateway routes that were previously uncovered:
 * - /assets/* static file serving (success + 404)
 * - /login SPA route
 * - /chat and /chat/* SPA routes
 * - Log routes warn when projectPath set but no apiKey
 * - controlDeps routes registration
 * - unregisterContainer releases locks/calls (logging paths)
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { startGateway } from "../../src/gateway/index.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function createMockFrontendDist(): string {
  const dir = mkdtempSync(join(tmpdir(), "mock-frontend-"));
  writeFileSync(join(dir, "index.html"), '<!DOCTYPE html><html><body><div id="root"></div></body></html>');
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets", "app.js"), 'console.log("app");');
  writeFileSync(join(dir, "assets", "style.css"), 'body { margin: 0; }');
  return dir;
}

function mockStatusTracker() {
  return {
    getAllAgents: () => [],
    getSchedulerInfo: () => null,
    getRecentLogs: () => [],
    on: vi.fn(),
    removeListener: vi.fn(),
    isPaused: vi.fn(() => false),
    isAgentEnabled: vi.fn(() => true),
  } as any;
}

// ── /assets/* static file serving ────────────────────────────────────────────

describe("Gateway /assets/* static file serving", () => {
  let gateway: any;
  let frontendDist: string;
  const logger = makeLogger();
  const TEST_API_KEY = "test-key-assets-123";

  beforeAll(async () => {
    frontendDist = createMockFrontendDist();
    gateway = await startGateway({
      port: 0,
      logger,
      apiKey: TEST_API_KEY,
      webUI: true,
      statusTracker: mockStatusTracker(),
      frontendDistPath: frontendDist,
    });
  });

  afterAll(async () => {
    await gateway.close();
    rmSync(frontendDist, { recursive: true, force: true });
  });

  it("serves a JavaScript asset file with correct content-type", async () => {
    const addr = gateway.server.address() as any;
    const res = await fetch(`http://localhost:${addr.port}/assets/app.js`, {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('console.log("app")');
    expect(res.headers.get("content-type")).toContain("text/javascript");
  });

  it("serves a CSS asset file with correct content-type", async () => {
    const addr = gateway.server.address() as any;
    const res = await fetch(`http://localhost:${addr.port}/assets/style.css`, {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("margin: 0");
    expect(res.headers.get("content-type")).toContain("text/css");
  });

  it("returns 404 for a missing asset file (catch block)", async () => {
    const addr = gateway.server.address() as any;
    const res = await fetch(`http://localhost:${addr.port}/assets/missing-file-xyz.js`, {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
    expect(res.status).toBe(404);
  });

  it("sets long-term caching headers for assets", async () => {
    const addr = gateway.server.address() as any;
    const res = await fetch(`http://localhost:${addr.port}/assets/app.js`, {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=31536000");
  });
});

// ── /login SPA route ──────────────────────────────────────────────────────────

describe("Gateway /login SPA route", () => {
  let gateway: any;
  let frontendDist: string;
  const logger = makeLogger();
  const TEST_API_KEY = "test-key-login-456";

  beforeAll(async () => {
    frontendDist = createMockFrontendDist();
    gateway = await startGateway({
      port: 0,
      logger,
      apiKey: TEST_API_KEY,
      webUI: true,
      statusTracker: mockStatusTracker(),
      frontendDistPath: frontendDist,
    });
  });

  afterAll(async () => {
    await gateway.close();
    rmSync(frontendDist, { recursive: true, force: true });
  });

  it("serves index.html at /login", async () => {
    const addr = gateway.server.address() as any;
    const res = await fetch(`http://localhost:${addr.port}/login`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<div id="root">');
    expect(res.headers.get("content-type")).toContain("text/html");
  });
});

// ── /chat and /chat/* SPA routes ──────────────────────────────────────────────

describe("Gateway /chat SPA routes", () => {
  let gateway: any;
  let frontendDist: string;
  const logger = makeLogger();
  const TEST_API_KEY = "test-key-chat-789";

  beforeAll(async () => {
    frontendDist = createMockFrontendDist();
    gateway = await startGateway({
      port: 0,
      logger,
      apiKey: TEST_API_KEY,
      webUI: true,
      statusTracker: mockStatusTracker(),
      frontendDistPath: frontendDist,
    });
  });

  afterAll(async () => {
    await gateway.close();
    rmSync(frontendDist, { recursive: true, force: true });
  });

  it("serves index.html at /chat", async () => {
    const addr = gateway.server.address() as any;
    // /api/chat/* requires auth, but /chat SPA route does not need auth
    const res = await fetch(`http://localhost:${addr.port}/chat`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<div id="root">');
  });

  it("serves index.html at /chat/* paths", async () => {
    const addr = gateway.server.address() as any;
    const res = await fetch(`http://localhost:${addr.port}/chat/session-123`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<div id="root">');
  });
});

// ── Log routes warning when projectPath set but no apiKey ──────────────────────

describe("Gateway log routes warning without apiKey", () => {
  let gateway: any;
  const logger = makeLogger();

  beforeAll(async () => {
    gateway = await startGateway({
      port: 0,
      logger,
      projectPath: "/tmp/fake-project",
      // No apiKey — should trigger warning
    });
  });

  afterAll(async () => {
    await gateway.close();
  });

  it("logs a warning when projectPath is set but no apiKey (log routes disabled)", () => {
    expect(logger.warn).toHaveBeenCalledWith(
      "Log API routes disabled — gateway API key required for security."
    );
  });
});

// ── controlDeps routes registration ──────────────────────────────────────────

describe("Gateway controlDeps routes", () => {
  let gateway: any;
  const logger = makeLogger();
  const TEST_API_KEY = "test-control-key-abc";

  beforeAll(async () => {
    const controlDeps = {
      killInstance: vi.fn(async () => false),
      killAgent: vi.fn(async () => ({ killed: 0 })),
      pauseScheduler: vi.fn(async () => {}),
      resumeScheduler: vi.fn(async () => {}),
    };

    gateway = await startGateway({
      port: 0,
      logger,
      apiKey: TEST_API_KEY,
      controlDeps,
    });
  });

  afterAll(async () => {
    await gateway.close();
  });

  it("registers control routes when controlDeps is provided", async () => {
    const addr = gateway.server.address() as any;
    // Control routes require auth, so 401 confirms the route was registered
    const res = await fetch(`http://localhost:${addr.port}/control/instances`);
    expect(res.status).toBe(401);
  });
});

// ── unregisterContainer releases locks and logs ──────────────────────────────

describe("Gateway unregisterContainer releases locks and fails calls", () => {
  let gateway: any;
  const logger = makeLogger();

  beforeEach(async () => {
    logger.info = vi.fn();
    logger.warn = vi.fn();
    logger.error = vi.fn();
    logger.debug = vi.fn();

    gateway = await startGateway({
      port: 0,
      logger,
    });
  });

  afterEach(async () => {
    await gateway.close();
  });

  it("logs 'released locks on container cleanup' when locks are released", async () => {
    const secret = "test-secret-locks-" + Date.now();
    const instanceId = "test-instance-locks-" + Date.now();
    const reg = {
      agentName: "test-agent",
      instanceId,
      agentDir: "/tmp/test",
    } as any;

    // Register the container
    await gateway.registerContainer(secret, reg);

    // Acquire a lock held by this instance
    const lockResult = gateway.lockStore.acquire("resource://test/lock-1", instanceId, 60);
    expect(lockResult.ok).toBe(true);

    // Now unregister — should release the lock and log it
    await gateway.unregisterContainer(secret);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "test-agent",
        instance: instanceId,
        released: 1,
      }),
      "released locks on container cleanup"
    );
  });

  it("logs 'failed pending calls on container cleanup' when calls exist", async () => {
    const secret = "test-secret-calls-" + Date.now();
    const instanceId = "test-instance-calls-" + Date.now();
    const reg = {
      agentName: "test-agent-calls",
      instanceId,
      agentDir: "/tmp/test",
    } as any;

    // Register the container
    await gateway.registerContainer(secret, reg);

    // Create a pending call from this instance in the callStore
    // The callStore.failAllByCaller(instanceId) should return > 0 if there are pending calls
    gateway.callStore.create({
      callerAgent: "test-agent-calls",
      callerInstanceId: instanceId,
      targetAgent: "target-agent",
      context: "test context",
      depth: 0,
    });

    // Unregister — should fail the call and log it
    await gateway.unregisterContainer(secret);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "test-agent-calls",
        instance: instanceId,
        failedCalls: 1,
      }),
      "failed pending calls on container cleanup"
    );
  });
});
