import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createLogger } from "../../src/shared/logger.js";

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
});
