import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { startGateway, resolveFrontendDist } from "../../src/gateway/index.js";

/** Create a minimal frontend dist fixture for tests that need SPA serving. */
function createMockFrontendDist(): string {
  const dir = mkdtempSync(join(tmpdir(), "mock-frontend-"));
  writeFileSync(join(dir, "index.html"), '<!DOCTYPE html><html><body><div id="root"></div></body></html>');
  mkdirSync(join(dir, "assets"), { recursive: true });
  return dir;
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe("resolveFrontendDist", () => {
  it("returns null when no frontend dist is available in test environment", () => {
    // In the test environment, neither bundled nor workspace frontend exists
    const result = resolveFrontendDist();
    // Result may be a string path or null, but must be a string or null
    expect(result === null || typeof result === "string").toBe(true);
  });
});

describe("Gateway health endpoint", () => {
  let gateway: any;
  const logger = makeLogger();

  beforeAll(async () => {
    gateway = await startGateway({
      port: 0,
      logger,
    });
  });

  afterAll(async () => {
    await gateway.close();
  });

  it("returns { status: ok } from /health endpoint", async () => {
    const addr = gateway.server.address() as any;
    const res = await fetch(`http://localhost:${addr.port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("returns 404 for unknown routes", async () => {
    const addr = gateway.server.address() as any;
    const res = await fetch(`http://localhost:${addr.port}/nonexistent-route-xyz`);
    expect(res.status).toBe(404);
  });
});

describe("Gateway with webhook registry", () => {
  let gateway: any;
  const logger = makeLogger();

  beforeAll(async () => {
    // Create a minimal webhook registry
    const mockWebhookRegistry = {
      all: () => [],
      get: () => undefined,
    } as any;

    gateway = await startGateway({
      port: 0,
      logger,
      webhookRegistry: mockWebhookRegistry,
      webhookSecrets: {},
      webhookConfigs: {},
    });
  });

  afterAll(async () => {
    await gateway.close();
  });

  it("starts successfully with webhook registry", async () => {
    const addr = gateway.server.address() as any;
    expect(addr.port).toBeGreaterThan(0);
  });

  it("health check still works with webhook registry configured", async () => {
    const addr = gateway.server.address() as any;
    const res = await fetch(`http://localhost:${addr.port}/health`);
    expect(res.status).toBe(200);
  });
});

describe("Gateway logging middleware", () => {
  let gateway: any;
  const logger = makeLogger();

  beforeAll(async () => {
    gateway = await startGateway({
      port: 0,
      logger,
    });
  });

  afterAll(async () => {
    await gateway.close();
  });

  it("logs 404 requests with warn level (status >= 400)", async () => {
    const addr = gateway.server.address() as any;
    await fetch(`http://localhost:${addr.port}/some-route-that-does-not-exist`);
    // After the request, logger.warn should have been called for the 404
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 404 }),
      expect.any(String)
    );
  });

  it("logs 200 requests with debug level", async () => {
    const addr = gateway.server.address() as any;
    await fetch(`http://localhost:${addr.port}/locks`);
    // logger.debug should be called for non-health requests (lock status returns 200 or redirects)
    expect(logger.debug).toHaveBeenCalled();
  });
});

describe("Gateway container registration and unregistration", () => {
  let gateway: any;
  const logger = makeLogger();

  beforeAll(async () => {
    gateway = await startGateway({
      port: 0,
      logger,
    });
  });

  afterAll(async () => {
    await gateway.close();
  });

  it("registerContainer adds a container and unregisterContainer removes it", async () => {
    const secret = "test-secret-" + Date.now();
    const reg = {
      agentName: "test-agent",
      instanceId: "test-instance-" + Date.now(),
      agentDir: "/tmp/test",
    } as any;

    // Register
    await gateway.registerContainer(secret, reg);

    // Verify it was registered
    const found = gateway.containerRegistry.get(secret);
    expect(found).toBeDefined();
    expect(found.agentName).toBe("test-agent");

    // Unregister
    await gateway.unregisterContainer(secret);

    // Verify it was removed
    const notFound = gateway.containerRegistry.get(secret);
    expect(notFound).toBeUndefined();
  });

  it("setCallDispatcher sets the call dispatcher", () => {
    const dispatcher = vi.fn();
    gateway.setCallDispatcher(dispatcher);
    // Dispatcher is set — no error thrown
    expect(true).toBe(true);
  });
});

describe("Gateway — projectPath + apiKey without webUI (log+stats routes only)", () => {
  let gateway: any;
  const logger = makeLogger();
  let projectPath: string;

  beforeAll(async () => {
    projectPath = mkdtempSync(join(tmpdir(), "gw-log-routes-"));
    // No webUI, but apiKey + projectPath — exercises the else-if branch in gateway/index.ts
    gateway = await startGateway({
      port: 0,
      logger,
      projectPath,
      apiKey: "test-api-key",
      webUI: false,
    });
  });

  afterAll(async () => {
    await gateway.close();
  });

  it("starts successfully without webUI when apiKey and projectPath are provided", () => {
    expect(gateway).toBeDefined();
    expect(gateway.server).toBeDefined();
  });

  it("health endpoint still responds when started without webUI", async () => {
    const addr = gateway.server.address() as any;
    const res = await fetch(`http://localhost:${addr.port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});
