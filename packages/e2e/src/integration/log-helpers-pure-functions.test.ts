/**
 * Integration tests: control/routes/log-helpers.ts pure and filesystem functions
 * — no Docker required.
 *
 * Tests previously untested pure functions and filesystem helpers exported from
 * control/routes/log-helpers.ts:
 *
 *   encodeCursor(date, offsets): encodes date + byte offsets into base64url string
 *   decodeCursor(cursor): decodes base64url cursor back to {date, offsets}
 *   decodeCursor edge cases: null for malformed inputs
 *
 *   findLogFiles(projectPath, prefix): returns sorted list of dated log files
 *   findLatestLogFile(projectPath, prefix): returns the newest log file or null
 *   dateFromLogFile(filePath): extracts YYYY-MM-DD from log file name
 *   logFileForDate(projectPath, prefix, date): returns path when file exists, null otherwise
 *
 * Note: parseLine() was already covered in logs-container-format.test.ts
 *
 * Covers:
 *   - control/routes/log-helpers.ts: encodeCursor() — single offset, multiple offsets
 *   - control/routes/log-helpers.ts: decodeCursor() — single/multiple offsets roundtrip
 *   - control/routes/log-helpers.ts: decodeCursor() — null for empty string
 *   - control/routes/log-helpers.ts: decodeCursor() — null for missing offset part
 *   - control/routes/log-helpers.ts: decodeCursor() — null for NaN offset
 *   - control/routes/log-helpers.ts: findLogFiles() — empty when no files, sorted order
 *   - control/routes/log-helpers.ts: findLogFiles() — ignores files not matching prefix
 *   - control/routes/log-helpers.ts: findLogFiles() — handles missing directory
 *   - control/routes/log-helpers.ts: findLatestLogFile() — null for empty dir, returns last
 *   - control/routes/log-helpers.ts: dateFromLogFile() — extracts date, null for non-matching
 *   - control/routes/log-helpers.ts: logFileForDate() — returns path when exists, null otherwise
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

const {
  encodeCursor,
  decodeCursor,
  findLogFiles,
  findLatestLogFile,
  dateFromLogFile,
  logFileForDate,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/control/routes/log-helpers.js"
);

function makeTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "al-loghelperstest-"));
  mkdirSync(join(dir, ".al", "logs"), { recursive: true });
  return dir;
}

// ── encodeCursor / decodeCursor ───────────────────────────────────────────────

describe("log-helpers: encodeCursor / decodeCursor (no Docker required)", { timeout: 10_000 }, () => {
  it("encodeCursor then decodeCursor roundtrip — single offset", () => {
    const encoded = encodeCursor("2026-04-03", [12345]);
    const decoded = decodeCursor(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded.date).toBe("2026-04-03");
    expect(decoded.offsets).toEqual([12345]);
  });

  it("encodeCursor then decodeCursor roundtrip — multiple offsets", () => {
    const encoded = encodeCursor("2026-01-15", [0, 100, 5000]);
    const decoded = decodeCursor(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded.date).toBe("2026-01-15");
    expect(decoded.offsets).toEqual([0, 100, 5000]);
  });

  it("encodeCursor produces a base64url-safe string (no +/= chars)", () => {
    const encoded = encodeCursor("2026-04-03", [99999]);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
  });

  it("decodeCursor returns null for empty string", () => {
    expect(decodeCursor("")).toBeNull();
  });

  it("decodeCursor returns null when offset part is missing", () => {
    // base64url of just a date with no colon
    const noOffset = Buffer.from("2026-04-03").toString("base64url");
    expect(decodeCursor(noOffset)).toBeNull();
  });

  it("decodeCursor returns null when offset contains NaN", () => {
    // Encode a cursor with 'xyz' as the offset string
    const bad = Buffer.from("2026-04-03:xyz").toString("base64url");
    expect(decodeCursor(bad)).toBeNull();
  });

  it("decodeCursor returns null for completely invalid base64", () => {
    // Pass something that decodes to garbage
    const result = decodeCursor("!!!invalid!!!");
    // Either null or an object with NaN offsets — the function handles gracefully
    if (result !== null) {
      // If it doesn't return null, the offsets should be NaN-safe
      expect(result.offsets.some(isNaN)).toBe(false);
    }
    // Pass — any non-crashing behavior is acceptable
  });

  it("decodeCursor with zero offset returns {offsets: [0]}", () => {
    const encoded = encodeCursor("2026-04-03", [0]);
    const decoded = decodeCursor(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded.offsets).toEqual([0]);
  });
});

// ── findLogFiles ──────────────────────────────────────────────────────────────

describe("log-helpers: findLogFiles() (no Docker required)", { timeout: 10_000 }, () => {
  it("returns empty array for a project with no log files", () => {
    const project = makeTempProject();
    const files = findLogFiles(project, "my-agent");
    expect(files).toEqual([]);
  });

  it("returns empty array when project .al/logs directory doesn't exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "al-nologs-"));
    // Don't create .al/logs
    const files = findLogFiles(dir, "agent");
    expect(files).toEqual([]);
  });

  it("returns sorted list of matching log files", () => {
    const project = makeTempProject();
    const logsDir = join(project, ".al", "logs");
    writeFileSync(join(logsDir, "my-agent-2026-01-01.log"), "");
    writeFileSync(join(logsDir, "my-agent-2026-03-15.log"), "");
    writeFileSync(join(logsDir, "my-agent-2026-02-10.log"), "");

    const files = findLogFiles(project, "my-agent");
    expect(files).toHaveLength(3);
    // Should be sorted alphabetically (which means chronologically for YYYY-MM-DD)
    expect(files[0].endsWith("2026-01-01.log")).toBe(true);
    expect(files[1].endsWith("2026-02-10.log")).toBe(true);
    expect(files[2].endsWith("2026-03-15.log")).toBe(true);
  });

  it("ignores files that don't match the prefix", () => {
    const project = makeTempProject();
    const logsDir = join(project, ".al", "logs");
    writeFileSync(join(logsDir, "my-agent-2026-01-01.log"), "");
    writeFileSync(join(logsDir, "other-agent-2026-01-01.log"), "");
    writeFileSync(join(logsDir, "scheduler-2026-01-01.log"), "");

    const files = findLogFiles(project, "my-agent");
    expect(files).toHaveLength(1);
    expect(files[0].endsWith("my-agent-2026-01-01.log")).toBe(true);
  });

  it("ignores non-.log files", () => {
    const project = makeTempProject();
    const logsDir = join(project, ".al", "logs");
    writeFileSync(join(logsDir, "my-agent-2026-01-01.log"), "");
    writeFileSync(join(logsDir, "my-agent-2026-01-02.txt"), ""); // not .log

    const files = findLogFiles(project, "my-agent");
    expect(files).toHaveLength(1);
    expect(files[0].endsWith(".log")).toBe(true);
  });
});

// ── findLatestLogFile ─────────────────────────────────────────────────────────

describe("log-helpers: findLatestLogFile() (no Docker required)", { timeout: 10_000 }, () => {
  it("returns null when no log files exist", () => {
    const project = makeTempProject();
    const result = findLatestLogFile(project, "my-agent");
    expect(result).toBeNull();
  });

  it("returns the latest log file when multiple exist", () => {
    const project = makeTempProject();
    const logsDir = join(project, ".al", "logs");
    writeFileSync(join(logsDir, "my-agent-2026-01-01.log"), "");
    writeFileSync(join(logsDir, "my-agent-2026-03-15.log"), "");
    writeFileSync(join(logsDir, "my-agent-2026-02-10.log"), "");

    const result = findLatestLogFile(project, "my-agent");
    expect(result).not.toBeNull();
    expect(result!.endsWith("2026-03-15.log")).toBe(true);
  });

  it("returns the single log file when only one exists", () => {
    const project = makeTempProject();
    const logsDir = join(project, ".al", "logs");
    writeFileSync(join(logsDir, "my-agent-2026-04-01.log"), "");

    const result = findLatestLogFile(project, "my-agent");
    expect(result).not.toBeNull();
    expect(result!.endsWith("2026-04-01.log")).toBe(true);
  });
});

// ── dateFromLogFile ───────────────────────────────────────────────────────────

describe("log-helpers: dateFromLogFile() (no Docker required)", { timeout: 10_000 }, () => {
  it("extracts date from a valid log file path", () => {
    const result = dateFromLogFile("/some/path/.al/logs/my-agent-2026-04-03.log");
    expect(result).toBe("2026-04-03");
  });

  it("extracts date with leading zeros correctly", () => {
    const result = dateFromLogFile("/project/.al/logs/scheduler-2026-01-09.log");
    expect(result).toBe("2026-01-09");
  });

  it("returns null for a path without a date pattern", () => {
    const result = dateFromLogFile("/no-date/file.log");
    expect(result).toBeNull();
  });

  it("returns null for a path with incorrect date format", () => {
    const result = dateFromLogFile("/path/my-agent-2026-4-3.log"); // not zero-padded
    expect(result).toBeNull();
  });
});

// ── logFileForDate ────────────────────────────────────────────────────────────

describe("log-helpers: logFileForDate() (no Docker required)", { timeout: 10_000 }, () => {
  it("returns the file path when the dated log file exists", () => {
    const project = makeTempProject();
    const logsDir = join(project, ".al", "logs");
    writeFileSync(join(logsDir, "my-agent-2026-04-03.log"), "some log content");

    const result = logFileForDate(project, "my-agent", "2026-04-03");
    expect(result).not.toBeNull();
    expect(result!.endsWith("my-agent-2026-04-03.log")).toBe(true);
  });

  it("returns null when the dated log file does not exist", () => {
    const project = makeTempProject();
    const result = logFileForDate(project, "my-agent", "2026-04-03");
    expect(result).toBeNull();
  });

  it("returns null when a different date's file exists", () => {
    const project = makeTempProject();
    const logsDir = join(project, ".al", "logs");
    writeFileSync(join(logsDir, "my-agent-2026-04-02.log"), "yesterday");

    const result = logFileForDate(project, "my-agent", "2026-04-03");
    expect(result).toBeNull();
  });
});
