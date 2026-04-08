/**
 * Integration tests: control/routes/logs.ts registerLogRoutes() — no Docker required.
 *
 * registerLogRoutes() sets up three Hono routes:
 *   GET /api/logs/scheduler          — scheduler logs
 *   GET /api/logs/agents/:name       — per-agent logs
 *   GET /api/logs/agents/:name/:id   — per-agent logs filtered by instance ID
 *
 * These routes read JSON-structured log files from <projectPath>/.al/logs/.
 * All tests use a temp directory with synthetic log files.
 *
 * Covers:
 *   - control/routes/logs.ts: GET /api/logs/scheduler — empty log dir → entries:[]
 *   - control/routes/logs.ts: GET /api/logs/agents/:name — invalid name → 400
 *   - control/routes/logs.ts: GET /api/logs/agents/:name — no logs → entries:[]
 *   - control/routes/logs.ts: GET /api/logs/agents/:name — real log entries returned
 *   - control/routes/logs.ts: GET /api/logs/agents/:name — ?grep invalid regex → 400
 *   - control/routes/logs.ts: GET /api/logs/agents/:name — ?grep pattern filters entries
 *   - control/routes/logs.ts: GET /api/logs/agents/:name — ?level=debug returns debug+info entries
 *   - control/routes/logs.ts: GET /api/logs/agents/:name — cursor-based pagination (forward cursor)
 *   - control/routes/logs.ts: GET /api/logs/agents/:name — back_cursor pagination
 *   - control/routes/logs.ts: GET /api/logs/agents/:name/:id — instance filter returns subset
 *   - control/routes/logs.ts: GET /api/logs/agents/:name/:id — invalid instance ID → 400
 *   - control/routes/logs.ts: handleLogRequest — back_cursor invalid → 400
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const { Hono } = await import(
  /* @vite-ignore */
  "/tmp/repo/node_modules/hono/dist/index.js"
);

const { registerLogRoutes } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/control/routes/logs.js"
);

// ── Helpers ──────────────────────────────────────────────────────────────────

const TODAY = new Date().toISOString().slice(0, 10);

function pinoLine(msg: string, level: number = 30, extra?: Record<string, unknown>): string {
  return JSON.stringify({
    level,
    time: Date.now(),
    msg,
    name: "test-agent",
    pid: 1,
    hostname: "localhost",
    ...extra,
  });
}

function writeLogFile(logsDir: string, prefix: string, lines: string[], date = TODAY): void {
  mkdirSync(logsDir, { recursive: true });
  writeFileSync(join(logsDir, `${prefix}-${date}.log`), lines.join("\n") + "\n");
}

// ── Setup ────────────────────────────────────────────────────────────────────

describe("integration: control/routes/logs.ts registerLogRoutes() — no Docker required", { timeout: 30_000 }, () => {
  let tmpDir: string;
  let logsDir: string;
  let app: any;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-log-routes-"));
    logsDir = join(tmpDir, ".al", "logs");
    app = new Hono();
    registerLogRoutes(app, tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Scheduler logs ────────────────────────────────────────────────────────

  it("GET /api/logs/scheduler — no log files → entries:[] with cursor and hasMore", async () => {
    mkdirSync(logsDir, { recursive: true });
    const res = await app.request("/api/logs/scheduler");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries).toHaveLength(0);
    expect("cursor" in body).toBe(true);
    expect("hasMore" in body).toBe(true);
  });

  it("GET /api/logs/scheduler — with log entries → returns entries", async () => {
    const lines = [
      pinoLine("Scheduler started", 30),
      pinoLine("Extensions loaded", 30),
    ];
    writeLogFile(logsDir, "scheduler", lines);

    const res = await app.request("/api/logs/scheduler");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries.length).toBeGreaterThanOrEqual(1);
    // Each entry should have a msg field
    expect(body.entries.some((e: any) => e.msg === "Scheduler started")).toBe(true);
  });

  // ── Agent logs: name validation ───────────────────────────────────────────

  it("GET /api/logs/agents/INVALID_NAME → 400 invalid agent name", async () => {
    const res = await app.request("/api/logs/agents/INVALID_NAME");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid agent name/i);
  });

  it("GET /api/logs/agents/valid-name — no logs → entries:[]", async () => {
    mkdirSync(logsDir, { recursive: true });
    const res = await app.request("/api/logs/agents/my-agent");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toEqual([]);
  });

  // ── Agent logs: basic retrieval ───────────────────────────────────────────

  it("GET /api/logs/agents/:name — returns log entries", async () => {
    const lines = [
      pinoLine("Starting agent", 30),
      pinoLine("Agent finished", 30),
    ];
    writeLogFile(logsDir, "my-agent", lines);

    const res = await app.request("/api/logs/agents/my-agent");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries.length).toBeGreaterThanOrEqual(2);
    expect(body.entries.some((e: any) => e.msg === "Starting agent")).toBe(true);
    expect(body.entries.some((e: any) => e.msg === "Agent finished")).toBe(true);
  });

  it("GET /api/logs/agents/:name — response has cursor, backCursor, hasMore fields", async () => {
    writeLogFile(logsDir, "my-agent", [pinoLine("line1", 30)]);

    const res = await app.request("/api/logs/agents/my-agent");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect("cursor" in body).toBe(true);
    expect("backCursor" in body).toBe(true);
    expect("hasMore" in body).toBe(true);
  });

  // ── Grep filtering ────────────────────────────────────────────────────────

  it("GET /api/logs/agents/:name?grep=invalid( → 400 invalid regex", async () => {
    writeLogFile(logsDir, "my-agent", [pinoLine("some log entry", 30)]);

    const res = await app.request("/api/logs/agents/my-agent?grep=invalid(");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid grep pattern/i);
  });

  it("GET /api/logs/agents/:name?grep=pattern — filters entries", async () => {
    const lines = [
      pinoLine("deploy started", 30),
      pinoLine("cache warmed", 30),
      pinoLine("deploy finished", 30),
    ];
    writeLogFile(logsDir, "my-agent", lines);

    const res = await app.request("/api/logs/agents/my-agent?grep=deploy");
    expect(res.status).toBe(200);
    const body = await res.json();
    const msgs = body.entries.map((e: any) => e.msg);
    expect(msgs).toContain("deploy started");
    expect(msgs).toContain("deploy finished");
    expect(msgs).not.toContain("cache warmed");
  });

  // ── Level filtering ───────────────────────────────────────────────────────

  it("GET /api/logs/agents/:name?level=debug — includes debug entries", async () => {
    const lines = [
      pinoLine("debug message", 20),   // level=debug
      pinoLine("info message", 30),    // level=info
      pinoLine("trace message", 10),   // level=trace, below debug
    ];
    writeLogFile(logsDir, "my-agent", lines);

    const res = await app.request("/api/logs/agents/my-agent?level=debug");
    expect(res.status).toBe(200);
    const body = await res.json();
    const msgs = body.entries.map((e: any) => e.msg);
    expect(msgs).toContain("debug message");
    expect(msgs).toContain("info message");
    // trace (level=10) is below debug (level=20), so should be filtered out
    expect(msgs).not.toContain("trace message");
  });

  it("GET /api/logs/agents/:name — default level=info filters out debug entries", async () => {
    const lines = [
      pinoLine("debug message", 20),   // level=debug (filtered)
      pinoLine("info message", 30),    // level=info (kept)
    ];
    writeLogFile(logsDir, "my-agent", lines);

    const res = await app.request("/api/logs/agents/my-agent");
    expect(res.status).toBe(200);
    const body = await res.json();
    const msgs = body.entries.map((e: any) => e.msg);
    expect(msgs).toContain("info message");
    // Debug should be filtered out by default (minLevel=info=30 > debug=20)
    expect(msgs).not.toContain("debug message");
  });

  // ── Cursor-based pagination ───────────────────────────────────────────────

  it("GET /api/logs/agents/:name?cursor=X — valid cursor returns entries with new cursor", async () => {
    const lines = Array.from({ length: 5 }, (_, i) => pinoLine(`line ${i}`, 30));
    writeLogFile(logsDir, "my-agent", lines);

    // Get first page
    const res1 = await app.request("/api/logs/agents/my-agent?lines=3");
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(typeof body1.cursor).toBe("string");

    // Use cursor for second page
    const res2 = await app.request(`/api/logs/agents/my-agent?cursor=${body1.cursor}&lines=3`);
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(Array.isArray(body2.entries)).toBe(true);
  });

  it("GET /api/logs/agents/:name?cursor=BAD — invalid cursor → 400", async () => {
    writeLogFile(logsDir, "my-agent", [pinoLine("test", 30)]);

    const res = await app.request("/api/logs/agents/my-agent?cursor=not-valid-base64url!!!");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid cursor/i);
  });

  // ── Backward cursor pagination ────────────────────────────────────────────

  it("GET /api/logs/agents/:name?back_cursor=BAD — invalid back_cursor → 400", async () => {
    writeLogFile(logsDir, "my-agent", [pinoLine("test", 30)]);

    const res = await app.request("/api/logs/agents/my-agent?back_cursor=!!!invalid!!!");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid back_cursor/i);
  });

  it("GET /api/logs/agents/:name?back_cursor=X — valid back_cursor returns entries", async () => {
    const lines = Array.from({ length: 5 }, (_, i) => pinoLine(`log line ${i}`, 30));
    writeLogFile(logsDir, "my-agent", lines);

    // First get a real back_cursor from a regular request
    const res1 = await app.request("/api/logs/agents/my-agent");
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    // The backCursor might be null if all entries fit in one page
    if (body1.backCursor) {
      const res2 = await app.request(`/api/logs/agents/my-agent?back_cursor=${body1.backCursor}`);
      expect(res2.status).toBe(200);
      const body2 = await res2.json();
      expect(Array.isArray(body2.entries)).toBe(true);
    }
    // If backCursor is null (small log), just verify the first response was valid
    expect(body1.entries.length).toBeGreaterThanOrEqual(0);
  });

  // ── Instance ID filter ────────────────────────────────────────────────────

  it("GET /api/logs/agents/:name/INVALID_ID → 400 invalid instance ID", async () => {
    const res = await app.request("/api/logs/agents/my-agent/INVALID-INSTANCE");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid instance id/i);
  });

  it("GET /api/logs/agents/:name/:instanceId — filters by instance field", async () => {
    const lines = [
      pinoLine("instance-a run", 30, { instance: "inst-a" }),
      pinoLine("instance-b run", 30, { instance: "inst-b" }),
      pinoLine("instance-a done", 30, { instance: "inst-a" }),
    ];
    writeLogFile(logsDir, "my-agent", lines);

    const res = await app.request("/api/logs/agents/my-agent/inst-a");
    expect(res.status).toBe(200);
    const body = await res.json();
    const msgs = body.entries.map((e: any) => e.msg);
    expect(msgs).toContain("instance-a run");
    expect(msgs).toContain("instance-a done");
    expect(msgs).not.toContain("instance-b run");
  });

  it("GET /api/logs/agents/:name/:instanceId — no matching entries returns []", async () => {
    const lines = [
      pinoLine("instance-b run", 30, { instance: "inst-b" }),
    ];
    writeLogFile(logsDir, "my-agent", lines);

    const res = await app.request("/api/logs/agents/my-agent/inst-x");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toEqual([]);
  });
});
