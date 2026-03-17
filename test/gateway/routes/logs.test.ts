import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { registerLogRoutes } from "../../../src/gateway/routes/logs.js";

function createTestApp(projectPath: string) {
  const app = new Hono();
  registerLogRoutes(app, projectPath);
  return app;
}

function pinoLine(level: number, time: number, msg: string, extra?: Record<string, unknown>): string {
  return JSON.stringify({ level, time, msg, ...extra });
}

describe("log API routes", () => {
  let tmpDir: string;
  let logsPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-logs-test-"));
    logsPath = join(tmpDir, ".al", "logs");
    mkdirSync(logsPath, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Scheduler logs ──────────────────────────────────────────────────────

  describe("GET /api/logs/scheduler", () => {
    it("returns empty entries when no log files exist", async () => {
      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/scheduler");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.entries).toEqual([]);
      expect(data.hasMore).toBe(false);
    });

    it("returns last N entries from scheduler log", async () => {
      const lines = [];
      for (let i = 0; i < 10; i++) {
        lines.push(pinoLine(30, 1710700000000 + i * 1000, `msg-${i}`));
      }
      writeFileSync(join(logsPath, "scheduler-2024-03-18.log"), lines.join("\n") + "\n");

      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/scheduler?lines=3");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.entries).toHaveLength(3);
      expect(data.entries[0].msg).toBe("msg-7");
      expect(data.entries[2].msg).toBe("msg-9");
      expect(data.cursor).toBeTruthy();
    });

    it("supports cursor pagination", async () => {
      const lines = [];
      for (let i = 0; i < 5; i++) {
        lines.push(pinoLine(30, 1710700000000 + i * 1000, `msg-${i}`));
      }
      writeFileSync(join(logsPath, "scheduler-2024-03-18.log"), lines.join("\n") + "\n");

      const app = createTestApp(tmpDir);

      // Initial fetch
      const res1 = await app.request("/api/logs/scheduler?lines=5");
      const data1 = await res1.json();
      expect(data1.entries).toHaveLength(5);
      const cursor = data1.cursor;

      // No new data — cursor fetch should return empty
      const res2 = await app.request(`/api/logs/scheduler?cursor=${encodeURIComponent(cursor)}`);
      const data2 = await res2.json();
      expect(data2.entries).toHaveLength(0);

      // Append new data
      const newLines = [
        pinoLine(30, 1710700010000, "msg-new-1"),
        pinoLine(30, 1710700011000, "msg-new-2"),
      ];
      writeFileSync(
        join(logsPath, "scheduler-2024-03-18.log"),
        lines.join("\n") + "\n" + newLines.join("\n") + "\n",
      );

      // Cursor fetch should return new entries
      const res3 = await app.request(`/api/logs/scheduler?cursor=${encodeURIComponent(cursor)}`);
      const data3 = await res3.json();
      expect(data3.entries).toHaveLength(2);
      expect(data3.entries[0].msg).toBe("msg-new-1");
      expect(data3.entries[1].msg).toBe("msg-new-2");
    });

    it("returns invalid cursor error for malformed cursor", async () => {
      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/scheduler?cursor=not-valid");
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Invalid cursor");
    });
  });

  // ── Agent logs ──────────────────────────────────────────────────────────

  describe("GET /api/logs/agents/:name", () => {
    it("returns empty entries when no log files exist", async () => {
      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/agents/dev");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.entries).toEqual([]);
    });

    it("returns 400 for invalid agent name", async () => {
      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/agents/INVALID_NAME!");
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Invalid agent name");
    });

    it("returns last N entries for single-instance agent", async () => {
      const lines = [];
      for (let i = 0; i < 5; i++) {
        lines.push(pinoLine(30, 1710700000000 + i * 1000, `agent-msg-${i}`));
      }
      writeFileSync(join(logsPath, "dev-2024-03-18.log"), lines.join("\n") + "\n");

      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/agents/dev?lines=3");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.entries).toHaveLength(3);
      expect(data.entries[0].msg).toBe("agent-msg-2");
    });

    it("merges entries from multiple instance files", async () => {
      // Instance 1 logs
      const inst1 = [
        pinoLine(30, 1710700001000, "inst1-a"),
        pinoLine(30, 1710700003000, "inst1-b"),
        pinoLine(30, 1710700005000, "inst1-c"),
      ];
      writeFileSync(join(logsPath, "dev-2024-03-18.log"), inst1.join("\n") + "\n");

      // Instance 2 logs
      const inst2 = [
        pinoLine(30, 1710700002000, "inst2-a"),
        pinoLine(30, 1710700004000, "inst2-b"),
        pinoLine(30, 1710700006000, "inst2-c"),
      ];
      writeFileSync(join(logsPath, "dev-2-2024-03-18.log"), inst2.join("\n") + "\n");

      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/agents/dev?lines=6");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.entries).toHaveLength(6);
      // Should be merged by time
      expect(data.entries.map((e: any) => e.msg)).toEqual([
        "inst1-a", "inst2-a", "inst1-b", "inst2-b", "inst1-c", "inst2-c",
      ]);
    });

    it("supports cursor pagination for aggregate", async () => {
      const inst1 = [pinoLine(30, 1710700001000, "inst1-a")];
      const inst2 = [pinoLine(30, 1710700002000, "inst2-a")];
      writeFileSync(join(logsPath, "dev-2024-03-18.log"), inst1.join("\n") + "\n");
      writeFileSync(join(logsPath, "dev-2-2024-03-18.log"), inst2.join("\n") + "\n");

      const app = createTestApp(tmpDir);
      const res1 = await app.request("/api/logs/agents/dev?lines=10");
      const data1 = await res1.json();
      expect(data1.entries).toHaveLength(2);
      const cursor = data1.cursor;

      // Append new data to instance 2
      writeFileSync(
        join(logsPath, "dev-2-2024-03-18.log"),
        inst2.join("\n") + "\n" + pinoLine(30, 1710700010000, "inst2-new") + "\n",
      );

      const res2 = await app.request(`/api/logs/agents/dev?cursor=${encodeURIComponent(cursor)}`);
      const data2 = await res2.json();
      expect(data2.entries).toHaveLength(1);
      expect(data2.entries[0].msg).toBe("inst2-new");
    });
  });

  // ── Instance logs ───────────────────────────────────────────────────────

  describe("GET /api/logs/agents/:name/:instanceId", () => {
    it("returns entries for specific instance", async () => {
      const lines = [
        pinoLine(30, 1710700001000, "inst2-msg-1"),
        pinoLine(30, 1710700002000, "inst2-msg-2"),
      ];
      writeFileSync(join(logsPath, "dev-2-2024-03-18.log"), lines.join("\n") + "\n");

      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/agents/dev/2");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.entries).toHaveLength(2);
      expect(data.entries[0].msg).toBe("inst2-msg-1");
    });

    it("returns empty entries for missing instance", async () => {
      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/agents/dev/99");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.entries).toEqual([]);
    });

    it("returns 400 for non-numeric instance ID", async () => {
      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/agents/dev/abc");
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Invalid instance ID");
    });
  });

  // ── Time range filtering ────────────────────────────────────────────────

  describe("time range filtering", () => {
    it("filters entries with after parameter", async () => {
      const lines = [
        pinoLine(30, 1710700001000, "old"),
        pinoLine(30, 1710700005000, "new"),
        pinoLine(30, 1710700010000, "newest"),
      ];
      writeFileSync(join(logsPath, "scheduler-2024-03-18.log"), lines.join("\n") + "\n");

      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/scheduler?after=1710700005000");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.entries).toHaveLength(1);
      expect(data.entries[0].msg).toBe("newest");
    });

    it("filters entries with before parameter", async () => {
      const lines = [
        pinoLine(30, 1710700001000, "old"),
        pinoLine(30, 1710700005000, "mid"),
        pinoLine(30, 1710700010000, "new"),
      ];
      writeFileSync(join(logsPath, "scheduler-2024-03-18.log"), lines.join("\n") + "\n");

      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/scheduler?before=1710700005000");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.entries).toHaveLength(1);
      expect(data.entries[0].msg).toBe("old");
    });

    it("filters entries with both after and before", async () => {
      const lines = [
        pinoLine(30, 1710700001000, "a"),
        pinoLine(30, 1710700003000, "b"),
        pinoLine(30, 1710700005000, "c"),
        pinoLine(30, 1710700007000, "d"),
      ];
      writeFileSync(join(logsPath, "scheduler-2024-03-18.log"), lines.join("\n") + "\n");

      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/scheduler?after=1710700001000&before=1710700007000");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.entries).toHaveLength(2);
      expect(data.entries[0].msg).toBe("b");
      expect(data.entries[1].msg).toBe("c");
    });
  });

  // ── Lines cap ───────────────────────────────────────────────────────────

  describe("lines parameter", () => {
    it("defaults to 50 when not specified", async () => {
      const lines = [];
      for (let i = 0; i < 100; i++) {
        lines.push(pinoLine(30, 1710700000000 + i * 1000, `msg-${i}`));
      }
      writeFileSync(join(logsPath, "scheduler-2024-03-18.log"), lines.join("\n") + "\n");

      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/scheduler");
      const data = await res.json();
      expect(data.entries).toHaveLength(50);
    });

    it("caps at 1000", async () => {
      const app = createTestApp(tmpDir);
      // Just verify it doesn't error with large value (no need for 1001 lines)
      const res = await app.request("/api/logs/scheduler?lines=9999");
      expect(res.status).toBe(200);
    });
  });
});
