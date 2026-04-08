/**
 * Integration tests: docker/host-user-runtime.ts HostUserRuntime additional methods
 * — no Docker required.
 *
 * The existing host-user-runtime.test.ts covers constructor, needsGateway,
 * isAgentRunning, listRunningAgents, prepareCredentials, cleanupCredentials,
 * getTaskUrl, and reattach. This file covers the remaining methods that
 * are testable without launching real processes:
 *
 *   fetchLogs(agentName, limit):
 *     1. Returns [] when AL_RUNS_DIR is an empty/nonexistent directory
 *     2. Returns [] when no log files match the agent name prefix
 *     3. Returns lines from matching log files up to limit
 *     4. Respects the limit parameter (returns at most `limit` lines)
 *     5. Returns [] gracefully when runs dir does not exist
 *
 *   followLogs(agentName, onLine, onStderr):
 *     6. Returns a { stop: () => void } object
 *     7. stop() is a no-op function (does not throw)
 *     8. Returns immediately (does not block)
 *
 *   inspectContainer(runId):
 *     9. Returns null when no PID file exists for the runId
 *    10. Returns null for an unknown runId (non-existing PID file)
 *
 *   shutdown():
 *    11. Resolves without throwing when no processes are tracked
 *    12. Calling shutdown() twice does not throw
 *
 * All tests use AL_RUNS_DIR env var override to point to a temp directory
 * so they don't interfere with any real runs.
 *
 * Covers:
 *   - docker/host-user-runtime.ts: fetchLogs() → [] when runs dir missing
 *   - docker/host-user-runtime.ts: fetchLogs() → [] when no matching log files
 *   - docker/host-user-runtime.ts: fetchLogs() → lines from matching log files
 *   - docker/host-user-runtime.ts: fetchLogs() → respects limit parameter
 *   - docker/host-user-runtime.ts: followLogs() → returns {stop} synchronously
 *   - docker/host-user-runtime.ts: followLogs().stop() → no-throw no-op
 *   - docker/host-user-runtime.ts: inspectContainer() → null for unknown runId
 *   - docker/host-user-runtime.ts: shutdown() → resolves with no tracked processes
 *   - docker/host-user-runtime.ts: shutdown() → idempotent (second call no-throw)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const { HostUserRuntime } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/docker/host-user-runtime.js"
);

// ── Helpers ────────────────────────────────────────────────────────────────

let runsDir: string;
let origRunsDir: string | undefined;

beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), "al-runs-test-"));
  origRunsDir = process.env.AL_RUNS_DIR;
  process.env.AL_RUNS_DIR = runsDir;
});

afterEach(() => {
  if (origRunsDir !== undefined) {
    process.env.AL_RUNS_DIR = origRunsDir;
  } else {
    delete process.env.AL_RUNS_DIR;
  }
  rmSync(runsDir, { recursive: true, force: true });
});

// ── fetchLogs() ───────────────────────────────────────────────────────────

describe("HostUserRuntime.fetchLogs() (no Docker required)", { timeout: 15_000 }, () => {
  it("returns [] when runs directory has no log files", async () => {
    const runtime = new HostUserRuntime();
    const result = await runtime.fetchLogs("my-agent", 100);
    expect(result).toEqual([]);
  });

  it("returns [] when no log files match the agent name prefix", async () => {
    // Create a log file for a different agent
    writeFileSync(join(runsDir, "al-other-agent-12345678.log"), "line1\nline2\n");

    const runtime = new HostUserRuntime();
    const result = await runtime.fetchLogs("my-agent", 100);
    expect(result).toEqual([]);
  });

  it("returns lines from matching log files", async () => {
    writeFileSync(join(runsDir, "al-my-agent-12345678.log"), "line1\nline2\nline3\n");

    const runtime = new HostUserRuntime();
    const result = await runtime.fetchLogs("my-agent", 100);
    expect(result).toContain("line1");
    expect(result).toContain("line2");
    expect(result).toContain("line3");
  });

  it("respects the limit parameter — returns at most `limit` lines", async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line-${i}`).join("\n");
    writeFileSync(join(runsDir, "al-big-agent-abc12345.log"), lines + "\n");

    const runtime = new HostUserRuntime();
    const result = await runtime.fetchLogs("big-agent", 10);
    expect(result.length).toBeLessThanOrEqual(10);
  });

  it("returns [] gracefully when runs dir does not exist", async () => {
    // Point to a directory that doesn't exist
    process.env.AL_RUNS_DIR = join(tmpdir(), `nonexistent-runs-${Date.now()}`);

    const runtime = new HostUserRuntime();
    const result = await runtime.fetchLogs("my-agent", 100);
    expect(result).toEqual([]);
  });

  it("returns an Array (not undefined or null)", async () => {
    const runtime = new HostUserRuntime();
    const result = await runtime.fetchLogs("no-such-agent", 50);
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── followLogs() ──────────────────────────────────────────────────────────

describe("HostUserRuntime.followLogs() (no Docker required)", { timeout: 10_000 }, () => {
  it("returns an object with a stop() function", () => {
    const runtime = new HostUserRuntime();
    const handle = runtime.followLogs("my-agent", () => {});
    expect(handle).toBeDefined();
    expect(typeof handle.stop).toBe("function");
  });

  it("stop() is a no-op and does not throw", () => {
    const runtime = new HostUserRuntime();
    const handle = runtime.followLogs("my-agent", () => {});
    expect(() => handle.stop()).not.toThrow();
  });

  it("returns synchronously (does not await anything)", () => {
    const runtime = new HostUserRuntime();
    // followLogs returns a plain object, not a Promise
    const result = runtime.followLogs("my-agent", () => {}, () => {});
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toHaveProperty("stop");
  });

  it("stop() is idempotent — calling twice does not throw", () => {
    const runtime = new HostUserRuntime();
    const handle = runtime.followLogs("my-agent", () => {});
    handle.stop();
    expect(() => handle.stop()).not.toThrow();
  });
});

// ── inspectContainer() ────────────────────────────────────────────────────

describe("HostUserRuntime.inspectContainer() (no Docker required)", { timeout: 10_000 }, () => {
  it("returns null for an unknown runId (no PID file)", async () => {
    const runtime = new HostUserRuntime();
    const result = await runtime.inspectContainer("nonexistent-run-id-abc12345");
    expect(result).toBeNull();
  });

  it("returns null for any runId when runs dir is empty", async () => {
    const runtime = new HostUserRuntime();
    const result = await runtime.inspectContainer("any-run-id");
    expect(result).toBeNull();
  });

  it("returns null when PID file exists but process is dead", async () => {
    // Write a PID file with a PID that doesn't exist (very large PID)
    const fakePid = 999999999;
    const runId = "test-run-abc12345";
    writeFileSync(
      join(runsDir, `${runId}.pid`),
      JSON.stringify({
        pid: fakePid,
        agentName: "test-agent",
        env: { GATEWAY_URL: "http://localhost:8080" },
        startedAt: new Date().toISOString(),
      }) + "\n"
    );

    const runtime = new HostUserRuntime();
    const result = await runtime.inspectContainer(runId);
    // Process is dead → should return null
    expect(result).toBeNull();
  });
});

// ── shutdown() ────────────────────────────────────────────────────────────

describe("HostUserRuntime.shutdown() (no Docker required)", { timeout: 10_000 }, () => {
  it("resolves without throwing when no processes are tracked", async () => {
    const runtime = new HostUserRuntime();
    await expect(runtime.shutdown()).resolves.toBeUndefined();
  });

  it("calling shutdown() twice does not throw", async () => {
    const runtime = new HostUserRuntime();
    await runtime.shutdown();
    await expect(runtime.shutdown()).resolves.toBeUndefined();
  });

  it("shutdown() returns a Promise (is async)", () => {
    const runtime = new HostUserRuntime();
    const result = runtime.shutdown();
    expect(result).toBeInstanceOf(Promise);
    return result; // clean up
  });
});
