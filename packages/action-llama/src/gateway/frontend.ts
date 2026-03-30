import { createRequire } from "module";
import { dirname, resolve, extname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";
import type { Hono } from "hono";
import type { Logger } from "../shared/logger.js";

export const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

/**
 * Attempt to resolve the @action-llama/frontend dist directory.
 * Checks (in order):
 *  1. Bundled frontend at dist/frontend/ (works after npm install)
 *  2. Workspace-linked @action-llama/frontend package (works in monorepo)
 */
export function resolveFrontendDist(): string | null {
  // Check bundled frontend (copied during build:assets)
  const bundled = resolve(dirname(fileURLToPath(import.meta.url)), "..", "frontend");
  if (existsSync(resolve(bundled, "index.html"))) {
    return bundled;
  }
  // Fall back to workspace-linked package
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve("@action-llama/frontend/package.json");
    const distDir = resolve(dirname(pkgPath), "dist");
    if (existsSync(resolve(distDir, "index.html"))) {
      return distDir;
    }
  } catch {
    // Package not available
  }
  return null;
}

/**
 * Register all frontend SPA serving routes:
 * - /assets/* — Vite-built assets with long-term caching headers
 * - SPA fallback routes for /login, /dashboard, /triggers, /chat
 *
 * Reads index.html once and reuses it for all SPA routes, eliminating
 * the previous duplication where it was read separately for dashboard and chat.
 */
export function registerSpaRoutes(app: Hono, frontendDist: string, logger: Logger): void {
  const indexHtml = readFileSync(resolve(frontendDist, "index.html"), "utf-8");

  logger.info({ path: frontendDist }, "Serving frontend from @action-llama/frontend");

  // Serve Vite-built assets (JS, CSS, images) with long-term caching
  app.get("/assets/*", (c) => {
    const filePath = resolve(frontendDist, c.req.path.slice(1));
    if (!filePath.startsWith(frontendDist + "/")) return c.notFound();
    try {
      const content = readFileSync(filePath);
      const mime = MIME_TYPES[extname(filePath)] || "application/octet-stream";
      return new Response(content, {
        headers: { "Content-Type": mime, "Cache-Control": "public, max-age=31536000, immutable" },
      });
    } catch {
      return c.notFound();
    }
  });

  // SPA fallback routes — all serve index.html for client-side routing
  app.get("/login", (c) => c.html(indexHtml));
  app.get("/dashboard", (c) => c.html(indexHtml));
  app.get("/dashboard/*", (c) => c.html(indexHtml));
  app.get("/triggers", (c) => c.html(indexHtml));
  app.get("/jobs", (c) => c.html(indexHtml));
  app.get("/chat", (c) => c.html(indexHtml));
  app.get("/chat/*", (c) => c.html(indexHtml));
}
