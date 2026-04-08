/**
 * Targeted test to cover the path traversal guard in registerSpaRoutes.
 * (frontend.ts line 64: if (!filePath.startsWith(frontendDist + "/")) return c.notFound())
 *
 * This test uses vi.mock for path to intercept resolve calls and return a path
 * that falls outside frontendDist, triggering the path traversal guard.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { Hono } from "hono";
import { createRequire } from "module";

// Use createRequire to obtain the original path.resolve before vi.mock intercepts it.
// This avoids infinite recursion in the mock.
const _require = createRequire(import.meta.url);
const originalPath = _require("path");
const originalResolve = originalPath.resolve.bind(originalPath);

// Mock path — keep everything real except resolve, which we override
// to simulate a path traversal escape for specific inputs.
vi.mock("path", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    resolve: (...args: string[]) => {
      // When the route handler resolves an asset path, we intercept it to
      // return a path that escapes frontendDist ("/fake/frontend/dist").
      if (args.length >= 2 && args[0] === "/fake/frontend/dist") {
        // Return a path that does NOT start with "/fake/frontend/dist/"
        return "/fake/etc/passwd";
      }
      // For all other calls (e.g., resolving __dirname in frontend.ts imports),
      // use the real resolve captured before the mock.
      return originalResolve(...args);
    },
  };
});

// Mock fs so readFileSync returns index.html during setup
const mockReadFileSync = vi.fn();
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: (...args: any[]) => mockReadFileSync(...args),
  };
});

import { registerSpaRoutes } from "../../src/gateway/frontend.js";

const FRONTEND_DIST = "/fake/frontend/dist";
const INDEX_HTML = "<html><body>SPA</body></html>";

describe("registerSpaRoutes — path traversal guard", () => {
  afterEach(() => {
    mockReadFileSync.mockReset();
  });

  it("returns 404 when resolved asset path falls outside frontendDist", async () => {
    // readFileSync returns index.html for registerSpaRoutes setup
    mockReadFileSync.mockReturnValue(INDEX_HTML);

    const app = new Hono();
    const logger = {
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(),
    } as any;
    registerSpaRoutes(app, FRONTEND_DIST, logger);

    // Request any asset — path.resolve is mocked to return "/fake/etc/passwd"
    // which does NOT start with "/fake/frontend/dist/", triggering the guard.
    const res = await app.request("/assets/evil.css");

    // The path traversal guard fires and returns 404
    expect(res.status).toBe(404);
  });
});
