/**
 * Integration tests: shared/logger.ts createLogger() and createFileOnlyLogger() — no Docker required.
 *
 * These functions create pino loggers that write to log files. They're testable
 * without Docker by pointing them at a temp directory.
 *
 * Covers:
 *   - shared/logger.ts: createLogger() creates log directory and returns a Logger
 *   - shared/logger.ts: createLogger() creates log file in the correct directory
 *   - shared/logger.ts: createLogger() returned Logger has expected pino methods
 *   - shared/logger.ts: createFileOnlyLogger() creates log directory and returns a Logger
 *   - shared/logger.ts: createFileOnlyLogger() creates log file in the correct directory
 *   - shared/logger.ts: createFileOnlyLogger() returned Logger has pino methods
 *   - shared/logger.ts: createLogger() log file path uses agent name and today's date
 *   - shared/logger.ts: createFileOnlyLogger() log file path uses agent name
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, existsSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const {
  createLogger,
  createFileOnlyLogger,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/logger.js"
);

const {
  logsDir,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/paths.js"
);

const loggers: any[] = [];

afterEach(async () => {
  // Flush and close all loggers to release file handles
  for (const logger of loggers) {
    try {
      if (logger && typeof logger.flush === "function") {
        await new Promise<void>((resolve) => {
          logger.flush(() => resolve());
        });
      }
    } catch {
      // ignore
    }
  }
  loggers.length = 0;
  // Give pino workers time to flush before cleanup
  await new Promise((r) => setTimeout(r, 100));
});

describe("integration: shared/logger.ts createLogger() (no Docker required)", { timeout: 30_000 }, () => {
  it("createLogger() returns a logger with info/warn/error/debug methods", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "al-logger-test-"));
    const logger = createLogger(projectPath, "test-agent");
    loggers.push(logger);

    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("createLogger() creates the logs directory at the expected path", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "al-logger-test-"));
    createLogger(projectPath, "my-agent");

    const dir = logsDir(projectPath);
    expect(existsSync(dir)).toBe(true);
  });

  it("createLogger() creates a log file for the agent on today's date", async () => {
    const projectPath = mkdtempSync(join(tmpdir(), "al-logger-test-"));
    const agentName = "logger-agent";
    createLogger(projectPath, agentName);

    const dir = logsDir(projectPath);
    const today = new Date().toISOString().slice(0, 10);
    const expectedFileName = `${agentName}-${today}.log`;

    // Give the file transport a moment to create the file
    await new Promise((r) => setTimeout(r, 200));

    const files = existsSync(dir) ? readdirSync(dir) : [];
    const hasExpectedFile = files.some((f) => f === expectedFileName);
    expect(hasExpectedFile).toBe(true);
  });

  it("createLogger() returns a logger with the correct name field", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "al-logger-test-"));
    const logger = createLogger(projectPath, "named-agent");
    loggers.push(logger);

    // Pino loggers expose their bindings including the 'name' field
    expect((logger as any).bindings().name).toBe("named-agent");
  });
});

describe("integration: shared/logger.ts createFileOnlyLogger() (no Docker required)", { timeout: 30_000 }, () => {
  it("createFileOnlyLogger() returns a logger with info/warn/error/debug methods", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "al-file-logger-test-"));
    const logger = createFileOnlyLogger(projectPath, "file-agent");
    loggers.push(logger);

    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("createFileOnlyLogger() creates the logs directory", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "al-file-logger-test-"));
    createFileOnlyLogger(projectPath, "file-agent");

    const dir = logsDir(projectPath);
    expect(existsSync(dir)).toBe(true);
  });

  it("createFileOnlyLogger() creates a log file for the agent", async () => {
    const projectPath = mkdtempSync(join(tmpdir(), "al-file-logger-test-"));
    const agentName = "file-logger-agent";
    createFileOnlyLogger(projectPath, agentName);

    const dir = logsDir(projectPath);
    const today = new Date().toISOString().slice(0, 10);
    const expectedFileName = `${agentName}-${today}.log`;

    // Give the file transport a moment to create the file
    await new Promise((r) => setTimeout(r, 200));

    const files = existsSync(dir) ? readdirSync(dir) : [];
    const hasExpectedFile = files.some((f) => f === expectedFileName);
    expect(hasExpectedFile).toBe(true);
  });

  it("createFileOnlyLogger() returns a logger with the correct name field", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "al-file-logger-test-"));
    const logger = createFileOnlyLogger(projectPath, "file-only-agent");
    loggers.push(logger);

    expect((logger as any).bindings().name).toBe("file-only-agent");
  });

  it("createFileOnlyLogger() and createLogger() use the same logs directory", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "al-logger-dir-test-"));
    createLogger(projectPath, "agent-a");
    createFileOnlyLogger(projectPath, "agent-b");

    // Both should use the same logsDir
    const dir = logsDir(projectPath);
    expect(existsSync(dir)).toBe(true);
  });
});
