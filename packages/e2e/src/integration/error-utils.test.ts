/**
 * Integration tests: shared/errors.ts utility functions — no Docker required.
 *
 * The shared/errors.ts module defines custom error classes and the
 * isUnrecoverableError() function which determines whether an agent error
 * text should trigger the unrecoverable error handling path.
 *
 * Functions tested:
 *   - ConfigError, CredentialError, AgentError — custom error classes
 *   - isUnrecoverableError(text) — matches known unrecoverable error patterns
 *   - UNRECOVERABLE_PATTERNS — all patterns are tested
 *   - UNRECOVERABLE_THRESHOLD — constant is defined
 *
 * Covers:
 *   - shared/errors.ts: ConfigError.name, CredentialError.name, AgentError.name
 *   - shared/errors.ts: isUnrecoverableError() — all UNRECOVERABLE_PATTERNS
 *   - shared/errors.ts: isUnrecoverableError() — case-insensitive matching
 *   - shared/errors.ts: isUnrecoverableError() — false for normal text
 *   - shared/errors.ts: UNRECOVERABLE_THRESHOLD — value is 3
 */

import { describe, it, expect } from "vitest";

const {
  ConfigError,
  CredentialError,
  AgentError,
  isUnrecoverableError,
  UNRECOVERABLE_PATTERNS,
  UNRECOVERABLE_THRESHOLD,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/errors.js"
);

describe("integration: shared/errors.ts (no Docker required)", () => {

  // ── Custom error classes ───────────────────────────────────────────────────

  describe("ConfigError", () => {
    it("has name 'ConfigError'", () => {
      const err = new ConfigError("test");
      expect(err.name).toBe("ConfigError");
      expect(err instanceof Error).toBe(true);
      expect(err.message).toBe("test");
    });

    it("accepts cause option", () => {
      const cause = new Error("root cause");
      const err = new ConfigError("wrapper", { cause });
      expect(err.message).toBe("wrapper");
    });
  });

  describe("CredentialError", () => {
    it("has name 'CredentialError'", () => {
      const err = new CredentialError("test");
      expect(err.name).toBe("CredentialError");
      expect(err instanceof Error).toBe(true);
    });
  });

  describe("AgentError", () => {
    it("has name 'AgentError'", () => {
      const err = new AgentError("test");
      expect(err.name).toBe("AgentError");
      expect(err instanceof Error).toBe(true);
    });
  });

  // ── isUnrecoverableError ──────────────────────────────────────────────────

  describe("isUnrecoverableError", () => {
    it("returns false for normal text", () => {
      expect(isUnrecoverableError("everything is fine")).toBe(false);
      expect(isUnrecoverableError("")).toBe(false);
      expect(isUnrecoverableError("task completed successfully")).toBe(false);
    });

    it("matches 'permission denied' (case-insensitive)", () => {
      expect(isUnrecoverableError("Permission Denied")).toBe(true);
      expect(isUnrecoverableError("permission denied to execute")).toBe(true);
    });

    it("matches 'could not read from remote repository'", () => {
      expect(isUnrecoverableError("fatal: could not read from remote repository")).toBe(true);
    });

    it("matches 'resource not accessible by personal access token'", () => {
      expect(isUnrecoverableError("Resource not accessible by personal access token")).toBe(true);
    });

    it("matches 'bad credentials'", () => {
      expect(isUnrecoverableError("Bad credentials")).toBe(true);
    });

    it("matches 'authentication failed'", () => {
      expect(isUnrecoverableError("Authentication failed for https://...")).toBe(true);
    });

    it("matches 'the requested url returned error: 403'", () => {
      expect(isUnrecoverableError("error: The requested URL returned error: 403")).toBe(true);
    });

    it("matches 'denied to ' pattern", () => {
      expect(isUnrecoverableError("Remote: Permission to user/repo.git denied to other-user")).toBe(true);
    });

    it("UNRECOVERABLE_PATTERNS has expected entries", () => {
      expect(Array.isArray(UNRECOVERABLE_PATTERNS)).toBe(true);
      expect(UNRECOVERABLE_PATTERNS.length).toBeGreaterThan(0);
      expect(UNRECOVERABLE_PATTERNS).toContain("permission denied");
      expect(UNRECOVERABLE_PATTERNS).toContain("bad credentials");
    });

    it("UNRECOVERABLE_THRESHOLD is 3", () => {
      expect(UNRECOVERABLE_THRESHOLD).toBe(3);
    });
  });
});
