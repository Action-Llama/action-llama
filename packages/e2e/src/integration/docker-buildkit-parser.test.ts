/**
 * Integration tests: docker/local-runtime.ts parseBuildKitLine() — no Docker required.
 *
 * parseBuildKitLine() is a pure function that parses a single line of Docker
 * BuildKit stderr output and returns a human-readable string, or undefined for
 * noise that should be skipped.
 *
 * Parsing rules:
 *   - "#N [step/total] description" → "Step step/total: description"
 *   - "#N ERROR message" → "Error: message"
 *   - "#N ..." (other BuildKit metadata) → undefined (skipped)
 *   - Empty line → undefined
 *   - ANSI escape codes are stripped before processing
 *   - Other lines (compiler errors, etc.) → returned as-is
 *
 * Test scenarios (no Docker required):
 *   1. Empty string → undefined
 *   2. Step line "#5 [2/4] RUN npm install" → "Step 2/4: RUN npm install"
 *   3. Error line "#5 ERROR message" → "Error: message"
 *   4. BuildKit metadata "#5 DONE 0.3s" → undefined
 *   5. BuildKit progress "#5 sha256:abc 2MB/5MB" → undefined
 *   6. ANSI escape codes stripped before processing
 *   7. Plain text (non-#N lines) → returned as-is
 *   8. Whitespace-only line → undefined
 *   9. Step with single-digit step number
 *   10. Step with multi-digit numbers
 *   11. Multiple ANSI codes in one line stripped
 *
 * Covers:
 *   - docker/local-runtime.ts: parseBuildKitLine() empty/whitespace → undefined
 *   - docker/local-runtime.ts: parseBuildKitLine() step match → "Step N/M: ..."
 *   - docker/local-runtime.ts: parseBuildKitLine() ERROR match → "Error: ..."
 *   - docker/local-runtime.ts: parseBuildKitLine() BuildKit noise → undefined
 *   - docker/local-runtime.ts: parseBuildKitLine() ANSI stripping
 *   - docker/local-runtime.ts: parseBuildKitLine() passthrough for other lines
 */

import { describe, it, expect } from "vitest";

const { parseBuildKitLine } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/docker/local-runtime.js"
);

describe(
  "integration: docker/local-runtime.ts parseBuildKitLine() (no Docker required)",
  { timeout: 10_000 },
  () => {
    // ── Empty / whitespace ────────────────────────────────────────────────────

    it("returns undefined for empty string", () => {
      expect(parseBuildKitLine("")).toBeUndefined();
    });

    it("returns undefined for whitespace-only string", () => {
      expect(parseBuildKitLine("   ")).toBeUndefined();
    });

    it("returns undefined for newline-only string", () => {
      expect(parseBuildKitLine("\n")).toBeUndefined();
    });

    // ── Step lines ────────────────────────────────────────────────────────────

    it("parses step line with correct format", () => {
      const result = parseBuildKitLine("#5 [2/4] RUN npm install");
      expect(result).toBe("Step 2/4: RUN npm install");
    });

    it("parses step line with single-digit step number", () => {
      const result = parseBuildKitLine("#1 [1/3] FROM node:20-alpine");
      expect(result).toBe("Step 1/3: FROM node:20-alpine");
    });

    it("parses step line with multi-digit numbers", () => {
      const result = parseBuildKitLine("#12 [10/12] RUN apk add --no-cache git");
      expect(result).toBe("Step 10/12: RUN apk add --no-cache git");
    });

    it("parses step line with long description", () => {
      const result = parseBuildKitLine("#3 [3/5] COPY package.json package-lock.json ./");
      expect(result).toBe("Step 3/5: COPY package.json package-lock.json ./");
    });

    it("step line returns string (not undefined)", () => {
      const result = parseBuildKitLine("#5 [2/4] RUN npm install");
      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
    });

    // ── Error lines ────────────────────────────────────────────────────────────

    it("parses ERROR line correctly", () => {
      const result = parseBuildKitLine("#5 ERROR failed to solve: rpc error");
      expect(result).toBe("Error: failed to solve: rpc error");
    });

    it("parses ERROR line with simple message", () => {
      const result = parseBuildKitLine("#3 ERROR command not found");
      expect(result).toBe("Error: command not found");
    });

    it("error line returns string starting with 'Error:'", () => {
      const result = parseBuildKitLine("#1 ERROR some failure");
      expect(result).toBeDefined();
      expect(result!.startsWith("Error:")).toBe(true);
    });

    // ── BuildKit noise (skipped) ─────────────────────────────────────────────

    it("returns undefined for BuildKit DONE metadata", () => {
      expect(parseBuildKitLine("#5 DONE 0.3s")).toBeUndefined();
    });

    it("returns undefined for BuildKit sha256 progress", () => {
      expect(parseBuildKitLine("#5 sha256:abc123 2MB/5MB")).toBeUndefined();
    });

    it("returns undefined for other #N prefixed BuildKit lines", () => {
      expect(parseBuildKitLine("#2 CACHED")).toBeUndefined();
    });

    it("returns undefined for #N with whitespace content that starts with digit", () => {
      // Any line starting with "#N " that doesn't match step/error patterns → undefined
      expect(parseBuildKitLine("#99 INIT")).toBeUndefined();
    });

    // ── ANSI escape code stripping ──────────────────────────────────────────

    it("strips ANSI escape codes before parsing", () => {
      // ANSI bold+reset around a step line
      const ansiLine = "\x1b[1m#5 [2/4] RUN npm install\x1b[0m";
      const result = parseBuildKitLine(ansiLine);
      expect(result).toBe("Step 2/4: RUN npm install");
    });

    it("strips multiple ANSI codes before processing", () => {
      const ansiLine = "\x1b[31m#3\x1b[0m \x1b[32mERROR\x1b[0m some error message";
      const result = parseBuildKitLine(ansiLine);
      expect(result).toBe("Error: some error message");
    });

    it("returns undefined for empty string after ANSI stripping", () => {
      // Only ANSI codes → empty after stripping → undefined
      const result = parseBuildKitLine("\x1b[1m\x1b[0m");
      expect(result).toBeUndefined();
    });

    // ── Passthrough for other lines ───────────────────────────────────────────

    it("returns plain text unchanged when it does not match any special format", () => {
      const result = parseBuildKitLine("Cannot find module 'some-module'");
      expect(result).toBe("Cannot find module 'some-module'");
    });

    it("returns compiler error text that does not start with #", () => {
      const result = parseBuildKitLine("Error: ENOMEM: not enough memory");
      expect(result).toBe("Error: ENOMEM: not enough memory");
    });

    it("returns npm error text as-is", () => {
      const result = parseBuildKitLine("npm ERR! missing script: build");
      expect(result).toBe("npm ERR! missing script: build");
    });
  },
);
