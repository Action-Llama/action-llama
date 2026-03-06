import { describe, it, expect, vi } from "vitest";
import { createServer } from "http";
import type { Server } from "http";
import { Router } from "../../../src/gateway/router.js";
import { registerLogRoute } from "../../../src/gateway/routes/logs.js";
import type { ContainerRegistration } from "../../../src/gateway/types.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function startTestServer(registry: Map<string, ContainerRegistration>): Promise<{ server: Server; port: number }> {
  const router = new Router();
  registerLogRoute(router, registry, logger as any);

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

describe("POST /logs/:secret", () => {
  it("forwards log lines to onLogLine callback", async () => {
    const lines: string[] = [];
    const registry = new Map<string, ContainerRegistration>();
    registry.set("test-secret", {
      containerName: "al-dev-1234",
      onLogLine: (line) => lines.push(line),
    });

    const { server, port } = await startTestServer(registry);
    try {
      const logLine1 = JSON.stringify({ _log: true, level: "info", msg: "hello", ts: 1 });
      const logLine2 = JSON.stringify({ _log: true, level: "info", msg: "world", ts: 2 });

      const res = await fetch(`http://127.0.0.1:${port}/logs/test-secret`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: `${logLine1}\n${logLine2}`,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.forwarded).toBe(2);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe(logLine1);
      expect(lines[1]).toBe(logLine2);
    } finally {
      server.close();
    }
  });

  it("returns 403 for an invalid secret", async () => {
    const registry = new Map<string, ContainerRegistration>();
    const { server, port } = await startTestServer(registry);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/logs/bad-secret`, {
        method: "POST",
        body: "test",
      });
      expect(res.status).toBe(403);
    } finally {
      server.close();
    }
  });

  it("returns ok with forwarded=0 when no onLogLine callback", async () => {
    const registry = new Map<string, ContainerRegistration>();
    registry.set("test-secret", { containerName: "al-dev-1234" });

    const { server, port } = await startTestServer(registry);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/logs/test-secret`, {
        method: "POST",
        body: "some log line",
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.forwarded).toBe(0);
    } finally {
      server.close();
    }
  });

  it("skips empty lines", async () => {
    const lines: string[] = [];
    const registry = new Map<string, ContainerRegistration>();
    registry.set("test-secret", {
      containerName: "al-dev-1234",
      onLogLine: (line) => lines.push(line),
    });

    const { server, port } = await startTestServer(registry);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/logs/test-secret`, {
        method: "POST",
        body: "line1\n\n\nline2\n",
      });
      const body = await res.json();
      expect(body.forwarded).toBe(2);
      expect(lines).toEqual(["line1", "line2"]);
    } finally {
      server.close();
    }
  });
});
