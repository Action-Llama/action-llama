import { describe, it, expect } from "vitest";
import {
  ConfigError,
  CredentialError,
  CloudProviderError,
  AgentError,
  UNRECOVERABLE_PATTERNS,
  isUnrecoverableError,
  UNRECOVERABLE_THRESHOLD,
} from "../../src/shared/errors.js";

describe("custom error classes", () => {
  it("ConfigError has correct name and message", () => {
    const err = new ConfigError("bad config");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.name).toBe("ConfigError");
    expect(err.message).toBe("bad config");
  });

  it("CredentialError has correct name and message", () => {
    const err = new CredentialError("missing key");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CredentialError");
    expect(err.message).toBe("missing key");
  });

  it("CloudProviderError has correct name and message", () => {
    const err = new CloudProviderError("aws failed");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CloudProviderError");
    expect(err.message).toBe("aws failed");
  });

  it("AgentError has correct name and message", () => {
    const err = new AgentError("docker not found");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AgentError");
    expect(err.message).toBe("docker not found");
  });

  it("supports cause option", () => {
    const cause = new Error("root cause");
    const err = new ConfigError("wrapper", { cause });
    expect(err.cause).toBe(cause);
  });

  it("errors are distinguishable via instanceof", () => {
    const config = new ConfigError("a");
    const cred = new CredentialError("b");
    expect(config instanceof CredentialError).toBe(false);
    expect(cred instanceof ConfigError).toBe(false);
  });
});

describe("isUnrecoverableError", () => {
  it("detects permission denied", () => {
    expect(isUnrecoverableError("fatal: Permission denied (publickey)")).toBe(true);
  });

  it("detects bad credentials", () => {
    expect(isUnrecoverableError("Error: Bad credentials")).toBe(true);
  });

  it("detects resource not accessible", () => {
    expect(isUnrecoverableError("Resource not accessible by personal access token")).toBe(true);
  });

  it("is case insensitive", () => {
    expect(isUnrecoverableError("PERMISSION DENIED")).toBe(true);
  });

  it("returns false for recoverable errors", () => {
    expect(isUnrecoverableError("network timeout")).toBe(false);
    expect(isUnrecoverableError("rate limit exceeded")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isUnrecoverableError("")).toBe(false);
  });
});

describe("constants", () => {
  it("UNRECOVERABLE_PATTERNS is a non-empty array of strings", () => {
    expect(Array.isArray(UNRECOVERABLE_PATTERNS)).toBe(true);
    expect(UNRECOVERABLE_PATTERNS.length).toBeGreaterThan(0);
    for (const p of UNRECOVERABLE_PATTERNS) {
      expect(typeof p).toBe("string");
    }
  });

  it("UNRECOVERABLE_THRESHOLD is a positive number", () => {
    expect(UNRECOVERABLE_THRESHOLD).toBeGreaterThan(0);
  });
});
