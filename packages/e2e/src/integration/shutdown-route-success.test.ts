/**
 * Integration tests: execution/routes/shutdown.ts registerShutdownRoute() 
 * success path — no Docker required.
 *
 * The shutdown route's success path (killing a container and unregistering it)
 * requires a registered container entry in the ContainerRegistry but does NOT
 * require an actual Docker container running. By registering a fake container
 * entry and providing a no-op killContainer callback, we can exercise the full
 * success path without Docker.
 *
 * Test scenarios (no Docker required):
 *   1. POST /shutdown with valid secret → 200 { killed: true, container: name }
 *   2. Container is unregistered from registry after kill
 *   3. Second request with same secret → 403 (container unregistered)
 *   4. killContainer callback is called with correct container name
 *   5. logger.error is called with shutdown reason and details
 *   6. Response includes the container name
 *
 * Covers:
 *   - execution/routes/shutdown.ts: POST /shutdown valid secret → 200 killed:true
 *   - execution/routes/shutdown.ts: containerRegistry.unregister() called after kill
 *   - execution/routes/shutdown.ts: logger.error called with container/reason/details
 *   - execution/routes/shutdown.ts: killContainer called with containerName
 */

import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "crypto";

const { Hono } = await import(
  /* @vite-ignore */
  "/tmp/repo/node_modules/hono/dist/index.js"
);

const {
  registerShutdownRoute,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/routes/shutdown.js"
);

const {
  ContainerRegistry,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/container-registry.js"
);

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };
}

describe(
  "integration: execution/routes/shutdown.ts success path (no Docker required)",
  { timeout: 15_000 },
  () => {
    it("POST /shutdown with valid secret → 200 { killed: true, container }", async () => {
      const app = new Hono();
      const registry = new ContainerRegistry();
      const logger = makeLogger();
      const killFn = vi.fn(async () => {});

      const secret = randomUUID();
      const containerName = "al-test-container-abc12345";

      await registry.register(secret, { containerName, agentName: "test-agent", instanceId: "test-instance-01" });

      registerShutdownRoute(app, registry, killFn, logger);

      const res = await app.request("/shutdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.killed).toBe(true);
      expect(body.container).toBe(containerName);
    });

    it("killContainer is called with the correct container name", async () => {
      const app = new Hono();
      const registry = new ContainerRegistry();
      const logger = makeLogger();
      const killFn = vi.fn(async () => {});

      const secret = randomUUID();
      const containerName = "al-shutdown-test-xyz99999";

      await registry.register(secret, { containerName, agentName: "agent-a", instanceId: "instance-a01" });
      registerShutdownRoute(app, registry, killFn, logger);

      await app.request("/shutdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });

      expect(killFn).toHaveBeenCalledWith(containerName);
    });

    it("container is unregistered after shutdown", async () => {
      const app = new Hono();
      const registry = new ContainerRegistry();
      const logger = makeLogger();
      const killFn = vi.fn(async () => {});

      const secret = randomUUID();

      await registry.register(secret, { containerName: "al-container-b01", agentName: "agent-b", instanceId: "instance-b01" });
      registerShutdownRoute(app, registry, killFn, logger);

      await app.request("/shutdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });

      // After shutdown, the registry entry should be gone
      expect(registry.get(secret)).toBeUndefined();
    });

    it("second request with same secret → 403 (container already unregistered)", async () => {
      const app = new Hono();
      const registry = new ContainerRegistry();
      const logger = makeLogger();
      const killFn = vi.fn(async () => {});

      const secret = randomUUID();

      await registry.register(secret, { containerName: "al-container-c01", agentName: "agent-c", instanceId: "instance-c01" });
      registerShutdownRoute(app, registry, killFn, logger);

      // First request succeeds
      const firstRes = await app.request("/shutdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      expect(firstRes.status).toBe(200);

      // Second request fails (already unregistered)
      const secondRes = await app.request("/shutdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      expect(secondRes.status).toBe(403);
    });

    it("logger.error is called on successful shutdown", async () => {
      const app = new Hono();
      const registry = new ContainerRegistry();
      const logger = makeLogger();
      const killFn = vi.fn(async () => {});

      const secret = randomUUID();

      await registry.register(secret, { containerName: "al-container-d01", agentName: "agent-d", instanceId: "instance-d01" });
      registerShutdownRoute(app, registry, killFn, logger);

      await app.request("/shutdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, reason: "test-reason", details: "test-details" }),
      });

      expect(logger.error).toHaveBeenCalled();
    });

    it("reason and details are passed to logger", async () => {
      const app = new Hono();
      const registry = new ContainerRegistry();
      const logger = makeLogger();
      const killFn = vi.fn(async () => {});

      const secret = randomUUID();

      await registry.register(secret, { containerName: "al-container-e01", agentName: "agent-e", instanceId: "instance-e01" });
      registerShutdownRoute(app, registry, killFn, logger);

      await app.request("/shutdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, reason: "crashed", details: "OOM" }),
      });

      const errorCall = logger.error.mock.calls[0];
      expect(errorCall[0]).toMatchObject({ reason: "crashed", details: "OOM" });
    });
  },
);
