/**
 * Integration tests: shared/server.ts and control/auth.ts safeCompare
 * — no Docker required.
 *
 * 1. validateServerConfig (shared/server.ts)
 *    Pure validation function with no external dependencies. Has ZERO
 *    existing test coverage.
 *
 *    Test scenarios:
 *      - valid config with only host returns correct defaults
 *      - invalid config (non-object) throws ConfigError
 *      - missing host throws ConfigError
 *      - invalid port (out of range, non-integer) throws ConfigError
 *      - invalid basePath (relative path) throws ConfigError
 *      - valid config with all fields preserved
 *
 * 2. safeCompare (control/auth.ts)
 *    Timing-safe string comparison. Used for API key validation.
 *    Has no direct test coverage (only tested via integration with HTTP layer).
 *
 *    Test scenarios:
 *      - equal strings → true
 *      - unequal strings of same length → false
 *      - strings of different length → false
 *      - empty strings → true
 *      - one empty, one non-empty → false
 *
 * Covers:
 *   - shared/server.ts: validateServerConfig() all validation branches
 *   - control/auth.ts: safeCompare() all cases
 */

import { describe, it, expect } from "vitest";

const { validateServerConfig } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/server.js"
);

const { safeCompare } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/control/auth.js"
);

// ── validateServerConfig ──────────────────────────────────────────────────────

describe("integration: validateServerConfig (no Docker required)", () => {

  it("accepts minimal config with just host", () => {
    const config = validateServerConfig({ host: "192.168.1.1" });
    expect(config.host).toBe("192.168.1.1");
  });

  it("throws ConfigError when input is not an object", () => {
    expect(() => validateServerConfig("string-input")).toThrow("must be an object");
    expect(() => validateServerConfig(null)).toThrow("must be an object");
    expect(() => validateServerConfig(42)).toThrow("must be an object");
  });

  it("throws ConfigError when host is missing", () => {
    expect(() => validateServerConfig({ port: 22 })).toThrow("host");
  });

  it("throws ConfigError when host is not a string", () => {
    expect(() => validateServerConfig({ host: 123 })).toThrow("host");
  });

  it("throws ConfigError for port = 0 (out of range)", () => {
    expect(() => validateServerConfig({ host: "example.com", port: 0 })).toThrow("port");
  });

  it("throws ConfigError for port = 65536 (out of range)", () => {
    expect(() => validateServerConfig({ host: "example.com", port: 65536 })).toThrow("port");
  });

  it("throws ConfigError for non-integer port", () => {
    expect(() => validateServerConfig({ host: "example.com", port: 22.5 })).toThrow("port");
  });

  it("accepts port = 22 (valid)", () => {
    const config = validateServerConfig({ host: "example.com", port: 22 });
    expect(config.port).toBe(22);
  });

  it("accepts port = 65535 (upper boundary)", () => {
    const config = validateServerConfig({ host: "example.com", port: 65535 });
    expect(config.port).toBe(65535);
  });

  it("accepts port = 1 (lower boundary)", () => {
    const config = validateServerConfig({ host: "example.com", port: 1 });
    expect(config.port).toBe(1);
  });

  it("throws ConfigError for relative basePath", () => {
    expect(() => validateServerConfig({ host: "example.com", basePath: "relative/path" })).toThrow("basePath");
  });

  it("accepts absolute basePath", () => {
    const config = validateServerConfig({ host: "example.com", basePath: "/opt/action-llama" });
    expect(config.basePath).toBe("/opt/action-llama");
  });

  it("preserves optional fields (user, keyPath, expose, etc.)", () => {
    const config = validateServerConfig({
      host: "my-server.com",
      port: 2222,
      user: "ubuntu",
      keyPath: "/home/user/.ssh/id_rsa",
      basePath: "/srv/app",
      expose: false,
      provider: "hetzner",
    });
    expect(config.host).toBe("my-server.com");
    expect(config.port).toBe(2222);
    expect(config.user).toBe("ubuntu");
    expect(config.keyPath).toBe("/home/user/.ssh/id_rsa");
    expect(config.basePath).toBe("/srv/app");
    expect(config.expose).toBe(false);
    expect(config.provider).toBe("hetzner");
  });
});

// ── safeCompare ───────────────────────────────────────────────────────────────

describe("integration: safeCompare (no Docker required)", () => {

  it("returns true for equal strings", () => {
    expect(safeCompare("hello", "hello")).toBe(true);
  });

  it("returns false for unequal strings of the same length", () => {
    expect(safeCompare("abc", "abd")).toBe(false);
  });

  it("returns false for strings of different length", () => {
    expect(safeCompare("short", "longer-string")).toBe(false);
    expect(safeCompare("longer-string", "short")).toBe(false);
  });

  it("returns true for empty strings", () => {
    expect(safeCompare("", "")).toBe(true);
  });

  it("returns false when one string is empty", () => {
    expect(safeCompare("", "nonempty")).toBe(false);
    expect(safeCompare("nonempty", "")).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(safeCompare("Hello", "hello")).toBe(false);
    expect(safeCompare("API_KEY_123", "api_key_123")).toBe(false);
  });

  it("compares long API key strings correctly", () => {
    const key = "sk-ant-api03-" + "x".repeat(32);
    expect(safeCompare(key, key)).toBe(true);
    expect(safeCompare(key, key + "extra")).toBe(false);
  });
});
