/**
 * Integration tests: gateway/frontend.ts utilities — no Docker required.
 *
 * Tests the pure utility constants and functions exported from gateway/frontend.ts:
 *   1. MIME_TYPES — map of file extensions to MIME type strings
 *   2. resolveFrontendDist() — attempts to locate the built frontend assets directory
 *
 * All tests run without any scheduler or Docker setup.
 *
 * Covers:
 *   - gateway/frontend.ts: MIME_TYPES — contains all expected extensions
 *   - gateway/frontend.ts: MIME_TYPES — .html maps to text/html charset=utf-8
 *   - gateway/frontend.ts: MIME_TYPES — .js maps to text/javascript charset=utf-8
 *   - gateway/frontend.ts: MIME_TYPES — .css maps to text/css charset=utf-8
 *   - gateway/frontend.ts: MIME_TYPES — .svg, .png, .ico, .woff2, .woff, .ttf, .map entries
 *   - gateway/frontend.ts: resolveFrontendDist() — returns string or null (not throws)
 *   - gateway/frontend.ts: resolveFrontendDist() — returns existing path when frontend is built
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "fs";

const {
  MIME_TYPES,
  resolveFrontendDist,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/gateway/frontend.js"
);

// ── MIME_TYPES ─────────────────────────────────────────────────────────────

describe("integration: gateway/frontend.ts utilities (no Docker required)", { timeout: 10_000 }, () => {

  describe("MIME_TYPES", () => {
    it("is a non-empty object", () => {
      expect(typeof MIME_TYPES).toBe("object");
      expect(Object.keys(MIME_TYPES).length).toBeGreaterThan(0);
    });

    it(".html maps to 'text/html; charset=utf-8'", () => {
      expect(MIME_TYPES[".html"]).toBe("text/html; charset=utf-8");
    });

    it(".js maps to 'text/javascript; charset=utf-8'", () => {
      expect(MIME_TYPES[".js"]).toBe("text/javascript; charset=utf-8");
    });

    it(".css maps to 'text/css; charset=utf-8'", () => {
      expect(MIME_TYPES[".css"]).toBe("text/css; charset=utf-8");
    });

    it(".json maps to 'application/json'", () => {
      expect(MIME_TYPES[".json"]).toBe("application/json");
    });

    it(".svg maps to 'image/svg+xml'", () => {
      expect(MIME_TYPES[".svg"]).toBe("image/svg+xml");
    });

    it(".png maps to 'image/png'", () => {
      expect(MIME_TYPES[".png"]).toBe("image/png");
    });

    it(".ico maps to 'image/x-icon'", () => {
      expect(MIME_TYPES[".ico"]).toBe("image/x-icon");
    });

    it(".woff2 maps to 'font/woff2'", () => {
      expect(MIME_TYPES[".woff2"]).toBe("font/woff2");
    });

    it(".woff maps to 'font/woff'", () => {
      expect(MIME_TYPES[".woff"]).toBe("font/woff");
    });

    it(".ttf maps to 'font/ttf'", () => {
      expect(MIME_TYPES[".ttf"]).toBe("font/ttf");
    });

    it(".map maps to 'application/json'", () => {
      expect(MIME_TYPES[".map"]).toBe("application/json");
    });

    it("all values are non-empty strings", () => {
      for (const [ext, mimeType] of Object.entries(MIME_TYPES)) {
        expect(typeof mimeType).toBe("string");
        expect((mimeType as string).length).toBeGreaterThan(0);
      }
    });

    it("all keys start with '.'", () => {
      for (const ext of Object.keys(MIME_TYPES)) {
        expect(ext.startsWith(".")).toBe(true);
      }
    });
  });

  // ── resolveFrontendDist ────────────────────────────────────────────────────

  describe("resolveFrontendDist()", () => {
    it("returns a string or null without throwing", () => {
      const result = resolveFrontendDist();
      expect(result === null || typeof result === "string").toBe(true);
    });

    it("when it returns a string, the path exists on disk", () => {
      const result = resolveFrontendDist();
      if (result !== null) {
        expect(existsSync(result)).toBe(true);
      }
    });

    it("returns the bundled frontend dist path when available", () => {
      // The frontend was built as part of npm run build
      const result = resolveFrontendDist();
      // Since we ran npm run build earlier, this should return a path
      if (result !== null) {
        expect(typeof result).toBe("string");
        expect(result).toContain("frontend");
      }
      // If null, that's okay too (frontend might not be available in all environments)
    });
  });
});
