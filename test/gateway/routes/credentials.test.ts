import { describe, it, expect, vi } from "vitest";
import { createServer } from "http";
import type { Server } from "http";
import { Router, sendJson } from "../../../src/gateway/router.js";
import { registerCredentialRoute } from "../../../src/gateway/routes/credentials.js";
import type { ContainerRegistration } from "../../../src/gateway/types.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function startTestServer(registry: Map<string, ContainerRegistration>): Promise<{ server: Server; port: number }> {
  const router = new Router();
  registerCredentialRoute(router, registry, logger as any);

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

describe("GET /credentials/:secret", () => {
  it("returns credentials for a valid secret", async () => {
    const registry = new Map<string, ContainerRegistration>();
    registry.set("test-secret", {
      containerName: "al-dev-1234",
      credentials: {
        github_token: { default: { token: "ghp_abc123" } },
        git_ssh: { default: { id_rsa: "ssh-key-data", username: "bot", email: "bot@test.com" } },
      },
    });

    const { server, port } = await startTestServer(registry);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/credentials/test-secret`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.github_token.default.token).toBe("ghp_abc123");
      expect(body.git_ssh.default.username).toBe("bot");
    } finally {
      server.close();
    }
  });

  it("returns 403 for an invalid secret", async () => {
    const registry = new Map<string, ContainerRegistration>();
    const { server, port } = await startTestServer(registry);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/credentials/bad-secret`);
      expect(res.status).toBe(403);
    } finally {
      server.close();
    }
  });

  it("returns 404 when no credentials are registered", async () => {
    const registry = new Map<string, ContainerRegistration>();
    registry.set("test-secret", { containerName: "al-dev-1234" });

    const { server, port } = await startTestServer(registry);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/credentials/test-secret`);
      expect(res.status).toBe(404);
    } finally {
      server.close();
    }
  });
});
