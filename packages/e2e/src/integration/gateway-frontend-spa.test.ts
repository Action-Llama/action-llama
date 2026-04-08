/**
 * Integration tests: gateway/frontend.ts registerSpaRoutes() — no Docker required.
 *
 * registerSpaRoutes() serves the Vite-built React SPA:
 *   - /assets/* — static asset files with long-term cache headers
 *   - SPA fallback routes (/login, /dashboard, /activity, /triggers, /jobs, /stats, /chat, /chat/*)
 *     all return index.html for client-side routing
 *
 * Tests construct a minimal fake frontend dist directory and register the routes
 * on a Hono app without starting a real HTTP server or Docker.
 *
 * Covers:
 *   - gateway/frontend.ts: registerSpaRoutes() — /login returns index.html HTML
 *   - gateway/frontend.ts: registerSpaRoutes() — /dashboard returns index.html
 *   - gateway/frontend.ts: registerSpaRoutes() — /dashboard/* returns index.html
 *   - gateway/frontend.ts: registerSpaRoutes() — /activity returns index.html
 *   - gateway/frontend.ts: registerSpaRoutes() — /triggers returns index.html
 *   - gateway/frontend.ts: registerSpaRoutes() — /jobs returns index.html
 *   - gateway/frontend.ts: registerSpaRoutes() — /stats returns index.html
 *   - gateway/frontend.ts: registerSpaRoutes() — /chat returns index.html
 *   - gateway/frontend.ts: registerSpaRoutes() — /chat/* returns index.html
 *   - gateway/frontend.ts: registerSpaRoutes() — /assets/:file returns file with correct MIME type
 *   - gateway/frontend.ts: registerSpaRoutes() — /assets/:file .js → text/javascript charset=utf-8
 *   - gateway/frontend.ts: registerSpaRoutes() — /assets/:file .css → text/css charset=utf-8
 *   - gateway/frontend.ts: registerSpaRoutes() — /assets/nonexistent.js → 404
 *   - gateway/frontend.ts: registerSpaRoutes() — /assets/ path traversal attempt → 404
 *   - gateway/frontend.ts: registerSpaRoutes() — logger.info called with frontendDist path
 */

import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const { Hono } = await import(
  /* @vite-ignore */
  "/tmp/repo/node_modules/hono/dist/index.js"
);

const {
  registerSpaRoutes,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/gateway/frontend.js"
);

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
}

/** Create a minimal fake frontend dist directory with index.html and some assets. */
function makeFrontendDist(): string {
  const dir = mkdtempSync(join(tmpdir(), "al-frontend-dist-test-"));
  const assetsDir = join(dir, "assets");
  mkdirSync(assetsDir, { recursive: true });

  // Write index.html
  writeFileSync(join(dir, "index.html"), `<!DOCTYPE html>
<html><head><title>Test SPA</title></head>
<body><div id="root"></div></body>
</html>`);

  // Write a JS asset
  writeFileSync(join(assetsDir, "index-abc123.js"), "console.log('hello spa');");

  // Write a CSS asset
  writeFileSync(join(assetsDir, "style-xyz.css"), "body { margin: 0; }");

  // Write an SVG asset
  writeFileSync(join(assetsDir, "icon.svg"), "<svg><circle r='10'/></svg>");

  return dir;
}

describe("integration: gateway/frontend.ts registerSpaRoutes() (no Docker required)", { timeout: 20_000 }, () => {
  const frontendDist = makeFrontendDist();

  function makeApp() {
    const app = new Hono();
    const logger = makeLogger();
    registerSpaRoutes(app, frontendDist, logger);
    return { app, logger };
  }

  // ── SPA fallback routes ───────────────────────────────────────────────────

  it("GET /login returns index.html content", async () => {
    const { app } = makeApp();
    const res = await app.request("/login");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Test SPA");
    expect(body).toContain("<div id=\"root\">");
  });

  it("GET /dashboard returns index.html content", async () => {
    const { app } = makeApp();
    const res = await app.request("/dashboard");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Test SPA");
  });

  it("GET /dashboard/* (subpath) returns index.html", async () => {
    const { app } = makeApp();
    const res = await app.request("/dashboard/agents/my-agent");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Test SPA");
  });

  it("GET /activity returns index.html", async () => {
    const { app } = makeApp();
    const res = await app.request("/activity");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Test SPA");
  });

  it("GET /triggers returns index.html", async () => {
    const { app } = makeApp();
    const res = await app.request("/triggers");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Test SPA");
  });

  it("GET /jobs returns index.html", async () => {
    const { app } = makeApp();
    const res = await app.request("/jobs");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Test SPA");
  });

  it("GET /stats returns index.html", async () => {
    const { app } = makeApp();
    const res = await app.request("/stats");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Test SPA");
  });

  it("GET /chat returns index.html", async () => {
    const { app } = makeApp();
    const res = await app.request("/chat");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Test SPA");
  });

  it("GET /chat/* (subpath) returns index.html", async () => {
    const { app } = makeApp();
    const res = await app.request("/chat/session-abc");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Test SPA");
  });

  // ── Asset serving ─────────────────────────────────────────────────────────

  it("GET /assets/index-abc123.js returns JS file with correct MIME type", async () => {
    const { app } = makeApp();
    const res = await app.request("/assets/index-abc123.js");
    expect(res.status).toBe(200);
    const contentType = res.headers.get("Content-Type") || "";
    expect(contentType).toContain("text/javascript");
    expect(contentType).toContain("charset=utf-8");
    const body = await res.text();
    expect(body).toContain("hello spa");
  });

  it("GET /assets/style-xyz.css returns CSS file with correct MIME type", async () => {
    const { app } = makeApp();
    const res = await app.request("/assets/style-xyz.css");
    expect(res.status).toBe(200);
    const contentType = res.headers.get("Content-Type") || "";
    expect(contentType).toContain("text/css");
    const body = await res.text();
    expect(body).toContain("margin: 0");
  });

  it("GET /assets/icon.svg returns SVG file with correct MIME type", async () => {
    const { app } = makeApp();
    const res = await app.request("/assets/icon.svg");
    expect(res.status).toBe(200);
    const contentType = res.headers.get("Content-Type") || "";
    expect(contentType).toContain("image/svg+xml");
  });

  it("GET /assets/index-abc123.js includes long-term cache headers", async () => {
    const { app } = makeApp();
    const res = await app.request("/assets/index-abc123.js");
    expect(res.status).toBe(200);
    const cacheControl = res.headers.get("Cache-Control") || "";
    expect(cacheControl).toContain("max-age=31536000");
    expect(cacheControl).toContain("immutable");
  });

  it("GET /assets/nonexistent.js returns 404", async () => {
    const { app } = makeApp();
    const res = await app.request("/assets/nonexistent.js");
    expect(res.status).toBe(404);
  });

  it("path traversal attempt on /assets/ is rejected with 404", async () => {
    const { app } = makeApp();
    // Attempt to access files outside the assets directory via path traversal
    const res = await app.request("/assets/../../package.json");
    expect(res.status).toBe(404);
  });

  // ── Logger ────────────────────────────────────────────────────────────────

  it("logger.info is called with frontendDist path during setup", () => {
    const app = new Hono();
    const logger = makeLogger();
    registerSpaRoutes(app, frontendDist, logger);

    expect(logger.info).toHaveBeenCalledOnce();
    const firstCall = logger.info.mock.calls[0];
    // First arg should be the metadata object, second should be the message
    expect(firstCall[0]).toMatchObject({ path: frontendDist });
    expect(firstCall[1]).toContain("Serving frontend");
  });
});
