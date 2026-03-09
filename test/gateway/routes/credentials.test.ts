import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { registerCredentialRoute } from "../../../src/gateway/routes/credentials.js";
import type { ContainerRegistration } from "../../../src/gateway/types.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function createTestApp(registry: Map<string, ContainerRegistration>): Hono {
  const app = new Hono();
  registerCredentialRoute(app, registry, logger as any);
  return app;
}

describe("GET /credentials/:secret", () => {
  it("returns credentials for a valid secret", async () => {
    const registry = new Map<string, ContainerRegistration>();
    registry.set("test-secret", {
      containerName: "al-dev-1234", agentName: "dev",
      credentials: {
        github_token: { default: { token: "ghp_abc123" } },
        git_ssh: { default: { id_rsa: "ssh-key-data", username: "bot", email: "bot@test.com" } },
      },
    });

    const app = createTestApp(registry);
    const res = await app.request("/credentials/test-secret");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.github_token.default.token).toBe("ghp_abc123");
    expect(body.git_ssh.default.username).toBe("bot");
  });

  it("returns 403 for an invalid secret", async () => {
    const registry = new Map<string, ContainerRegistration>();
    const app = createTestApp(registry);
    const res = await app.request("/credentials/bad-secret");
    expect(res.status).toBe(403);
  });

  it("returns 404 when no credentials are registered", async () => {
    const registry = new Map<string, ContainerRegistration>();
    registry.set("test-secret", { containerName: "al-dev-1234" });

    const app = createTestApp(registry);
    const res = await app.request("/credentials/test-secret");
    expect(res.status).toBe(404);
  });
});
