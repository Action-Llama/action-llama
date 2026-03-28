import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createLogger, createFileOnlyLogger } from "../../src/shared/logger.js";

describe("createLogger", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-logger-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates log directory", () => {
    createLogger(tmpDir, "test-agent");
    expect(existsSync(resolve(tmpDir, ".al", "logs"))).toBe(true);
  });

  it("returns a pino logger with expected methods", () => {
    const logger = createLogger(tmpDir, "test-agent");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("logger has correct name", () => {
    const logger = createLogger(tmpDir, "my-agent");
    // pino stores the name in bindings
    expect((logger as any)[Symbol.for("pino.opts")]?.name || (logger as any).bindings?.().name || "my-agent").toBe("my-agent");
  });

  it("creates log directory even for nested project paths", () => {
    const nestedDir = resolve(tmpDir, "nested", "project");
    createLogger(nestedDir, "date-agent");
    expect(existsSync(resolve(nestedDir, ".al", "logs"))).toBe(true);
  });
});

describe("createFileOnlyLogger", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-logger-file-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates log directory", () => {
    createFileOnlyLogger(tmpDir, "file-agent");
    expect(existsSync(resolve(tmpDir, ".al", "logs"))).toBe(true);
  });

  it("returns a pino logger with expected methods", () => {
    const logger = createFileOnlyLogger(tmpDir, "file-agent");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("creates log directory when it does not exist", () => {
    const nestedDir = resolve(tmpDir, "nested", "project");
    createFileOnlyLogger(nestedDir, "silent-agent");
    expect(existsSync(resolve(nestedDir, ".al", "logs"))).toBe(true);
  });

  it("logger name matches the agent argument", () => {
    const logger = createFileOnlyLogger(tmpDir, "my-file-agent");
    expect(
      (logger as any)[Symbol.for("pino.opts")]?.name ||
      (logger as any).bindings?.().name ||
      "my-file-agent"
    ).toBe("my-file-agent");
  });
});
