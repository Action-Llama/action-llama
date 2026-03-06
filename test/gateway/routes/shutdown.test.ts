import { describe, it, expect, vi } from "vitest";
import { createServer } from "http";
import type { Server } from "http";
import { Router } from "../../../src/gateway/router.js";
import { registerShutdownRoute } from "../../../src/gateway/routes/shutdown.js";
import type { ContainerRegistration } from "../../../src/gateway/types.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function startTestServer(
  registry: Map<string, ContainerRegistration>,
  killFn: (name: string) => Promise<void>
): Promise<{ server: Server; port: number }> {
  const router = new Router();
  registerShutdownRoute(router, registry, killFn, logger as any);

  const server = createServer(async (req, res) => {
    const handled = await router.handle(req, res);
    if (!handled) {
      res.writeHead(404);
      res.end();
    }
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

describe("POST /shutdown", () => {
  it("kills container and returns success for valid secret", async () => {
    const killFn = vi.fn().mockResolvedValue(undefined);
    const registry = new Map<string, ContainerRegistration>();
    registry.set("test-secret", { containerName: "al-dev-1234" });

    const { server, port } = await startTestServer(registry, killFn);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/shutdown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: "test-secret", reason: "test" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.killed).toBe(true);
      expect(body.container).toBe("al-dev-1234");
      expect(killFn).toHaveBeenCalledWith("al-dev-1234");
      // Secret should be removed from registry
      expect(registry.has("test-secret")).toBe(false);
    } finally {
      server.close();
    }
  });

  it("returns 403 for invalid secret", async () => {
    const killFn = vi.fn();
    const registry = new Map<string, ContainerRegistration>();

    const { server, port } = await startTestServer(registry, killFn);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/shutdown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: "bad-secret" }),
      });
      expect(res.status).toBe(403);
      expect(killFn).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  it("returns 400 for missing secret", async () => {
    const killFn = vi.fn();
    const registry = new Map<string, ContainerRegistration>();

    const { server, port } = await startTestServer(registry, killFn);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/shutdown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "no secret" }),
      });
      expect(res.status).toBe(400);
    } finally {
      server.close();
    }
  });
});
