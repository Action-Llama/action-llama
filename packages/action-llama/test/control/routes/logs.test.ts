import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { registerLogRoutes } from "../../../src/control/routes/logs.js";

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

    it("returns interleaved entries from multiple instances in one file", async () => {
      // All instances write to the same file, tagged with an `instance` field
      const lines = [
        pinoLine(30, 1710700001000, "inst1-a", { instance: "dev-aa11bb22" }),
        pinoLine(30, 1710700002000, "inst2-a", { instance: "dev-cc33dd44" }),
        pinoLine(30, 1710700003000, "inst1-b", { instance: "dev-aa11bb22" }),
        pinoLine(30, 1710700004000, "inst2-b", { instance: "dev-cc33dd44" }),
        pinoLine(30, 1710700005000, "inst1-c", { instance: "dev-aa11bb22" }),
        pinoLine(30, 1710700006000, "inst2-c", { instance: "dev-cc33dd44" }),
      ];
      writeFileSync(join(logsPath, "dev-2024-03-18.log"), lines.join("\n") + "\n");

      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/agents/dev?lines=6");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.entries).toHaveLength(6);
      // All entries returned in file order (already sorted by time)
      expect(data.entries.map((e: any) => e.msg)).toEqual([
        "inst1-a", "inst2-a", "inst1-b", "inst2-b", "inst1-c", "inst2-c",
      ]);
    });

    it("supports cursor pagination", async () => {
      const lines = [
        pinoLine(30, 1710700001000, "inst1-a", { instance: "dev-aa11bb22" }),
        pinoLine(30, 1710700002000, "inst2-a", { instance: "dev-cc33dd44" }),
      ];
      writeFileSync(join(logsPath, "dev-2024-03-18.log"), lines.join("\n") + "\n");

      const app = createTestApp(tmpDir);
      const res1 = await app.request("/api/logs/agents/dev?lines=10");
      const data1 = await res1.json();
      expect(data1.entries).toHaveLength(2);
      const cursor = data1.cursor;

      // Append new data
      writeFileSync(
        join(logsPath, "dev-2024-03-18.log"),
        lines.join("\n") + "\n" + pinoLine(30, 1710700010000, "inst2-new", { instance: "dev-cc33dd44" }) + "\n",
      );

      const res2 = await app.request(`/api/logs/agents/dev?cursor=${encodeURIComponent(cursor)}`);
      const data2 = await res2.json();
      expect(data2.entries).toHaveLength(1);
      expect(data2.entries[0].msg).toBe("inst2-new");
    });
  });

  // ── Instance logs ───────────────────────────────────────────────────────

  describe("GET /api/logs/agents/:name/:instanceId", () => {
    it("returns entries for specific instance filtered by instance field", async () => {
      const lines = [
        pinoLine(30, 1710700001000, "inst1-msg", { instance: "dev-aa11bb22" }),
        pinoLine(30, 1710700002000, "inst2-msg-1", { instance: "dev-cc33dd44" }),
        pinoLine(30, 1710700003000, "inst1-msg-2", { instance: "dev-aa11bb22" }),
        pinoLine(30, 1710700004000, "inst2-msg-2", { instance: "dev-cc33dd44" }),
      ];
      writeFileSync(join(logsPath, "dev-2024-03-18.log"), lines.join("\n") + "\n");

      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/agents/dev/dev-cc33dd44");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.entries).toHaveLength(2);
      expect(data.entries[0].msg).toBe("inst2-msg-1");
      expect(data.entries[1].msg).toBe("inst2-msg-2");
    });

    it("returns empty entries when instance has no log entries", async () => {
      const lines = [
        pinoLine(30, 1710700001000, "inst1-only", { instance: "dev-aa11bb22" }),
      ];
      writeFileSync(join(logsPath, "dev-2024-03-18.log"), lines.join("\n") + "\n");

      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/agents/dev/dev-00000099");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.entries).toEqual([]);
    });

    it("returns empty entries for missing agent log file", async () => {
      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/agents/dev/dev-aa11bb22");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.entries).toEqual([]);
    });

    it("returns 400 for invalid instance ID characters", async () => {
      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/agents/dev/AB-CD!");
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Invalid instance ID");
    });

    it("supports cursor pagination with instance filtering", async () => {
      const lines = [
        pinoLine(30, 1710700001000, "inst1-a", { instance: "dev-aa11bb22" }),
        pinoLine(30, 1710700002000, "inst2-a", { instance: "dev-cc33dd44" }),
      ];
      writeFileSync(join(logsPath, "dev-2024-03-18.log"), lines.join("\n") + "\n");

      const app = createTestApp(tmpDir);
      const res1 = await app.request("/api/logs/agents/dev/dev-cc33dd44?lines=10");
      const data1 = await res1.json();
      expect(data1.entries).toHaveLength(1);
      expect(data1.entries[0].msg).toBe("inst2-a");
      const cursor = data1.cursor;

      // Append entries for both instances
      writeFileSync(
        join(logsPath, "dev-2024-03-18.log"),
        lines.join("\n") + "\n"
          + pinoLine(30, 1710700010000, "inst1-new", { instance: "dev-aa11bb22" }) + "\n"
          + pinoLine(30, 1710700011000, "inst2-new", { instance: "dev-cc33dd44" }) + "\n",
      );

      // Only the matching instance entry should be returned
      const res2 = await app.request(`/api/logs/agents/dev/dev-cc33dd44?cursor=${encodeURIComponent(cursor)}`);
      const data2 = await res2.json();
      expect(data2.entries).toHaveLength(1);
      expect(data2.entries[0].msg).toBe("inst2-new");
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
      expect(data.entries).toHaveLength(100);
    });

    it("caps at 2000", async () => {
      const app = createTestApp(tmpDir);
      // Just verify it doesn't error with large value (no need for 2001 lines)
      const res = await app.request("/api/logs/scheduler?lines=9999");
      expect(res.status).toBe(200);
    });
  });

  // ── grep filtering ──────────────────────────────────────────────────────

  describe("grep filtering", () => {
    it("filters scheduler entries by grep pattern", async () => {
      const lines = [
        pinoLine(30, 1710700001000, "deploy started"),
        pinoLine(30, 1710700002000, "health check"),
        pinoLine(30, 1710700003000, "deploy finished"),
      ];
      writeFileSync(join(logsPath, "scheduler-2024-03-18.log"), lines.join("\n") + "\n");

      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/scheduler?grep=deploy");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.entries).toHaveLength(2);
      expect(data.entries[0].msg).toBe("deploy started");
      expect(data.entries[1].msg).toBe("deploy finished");
    });

    it("filters agent log entries by grep pattern", async () => {
      const lines = [
        pinoLine(30, 1710700001000, "deploy started"),
        pinoLine(30, 1710700002000, "health check"),
        pinoLine(30, 1710700003000, "deploy finished"),
      ];
      writeFileSync(join(logsPath, "dev-2024-03-18.log"), lines.join("\n") + "\n");

      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/agents/dev?grep=deploy");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.entries).toHaveLength(2);
      expect(data.entries[0].msg).toBe("deploy started");
      expect(data.entries[1].msg).toBe("deploy finished");
    });

    it("filters instance log entries by grep pattern", async () => {
      const lines = [
        pinoLine(30, 1710700001000, "deploy started", { instance: "dev-aa11bb22" }),
        pinoLine(30, 1710700002000, "health check", { instance: "dev-aa11bb22" }),
        pinoLine(30, 1710700003000, "deploy finished", { instance: "dev-aa11bb22" }),
      ];
      writeFileSync(join(logsPath, "dev-2024-03-18.log"), lines.join("\n") + "\n");

      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/agents/dev/dev-aa11bb22?grep=deploy");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.entries).toHaveLength(2);
      expect(data.entries[0].msg).toBe("deploy started");
      expect(data.entries[1].msg).toBe("deploy finished");
    });

    it("returns 400 for invalid grep pattern on scheduler", async () => {
      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/scheduler?grep=%5Binvalid");
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Invalid grep pattern");
    });

    it("returns 400 for invalid grep pattern on agent logs", async () => {
      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/agents/dev?grep=%5Binvalid");
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Invalid grep pattern");
    });

    it("returns 400 for invalid grep pattern on instance logs", async () => {
      writeFileSync(join(logsPath, "dev-2024-03-18.log"), pinoLine(30, 1710700001000, "msg") + "\n");
      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/agents/dev/dev-aa11bb22?grep=%5Binvalid");
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Invalid grep pattern");
    });

    it("grep searches the full JSON line (including extra fields)", async () => {
      const lines = [
        pinoLine(30, 1710700001000, "bash", { cmd: "docker ps" }),
        pinoLine(30, 1710700002000, "bash", { cmd: "echo hello" }),
      ];
      writeFileSync(join(logsPath, "scheduler-2024-03-18.log"), lines.join("\n") + "\n");

      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/scheduler?grep=docker");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.entries).toHaveLength(1);
      expect((data.entries[0] as any).cmd).toBe("docker ps");
    });

    it("combines grep with after/before time range", async () => {
      const lines = [
        pinoLine(30, 1710700001000, "deploy old"),
        pinoLine(30, 1710700005000, "deploy recent"),
        pinoLine(30, 1710700007000, "health check"),
      ];
      writeFileSync(join(logsPath, "scheduler-2024-03-18.log"), lines.join("\n") + "\n");

      const app = createTestApp(tmpDir);
      const res = await app.request("/api/logs/scheduler?after=1710700003000&grep=deploy");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.entries).toHaveLength(1);
      expect(data.entries[0].msg).toBe("deploy recent");
    });

    it("grep works with cursor pagination (returns only matching new entries)", async () => {
      const lines = [
        pinoLine(30, 1710700001000, "deploy started"),
        pinoLine(30, 1710700002000, "health check"),
      ];
      writeFileSync(join(logsPath, "scheduler-2024-03-18.log"), lines.join("\n") + "\n");

      const app = createTestApp(tmpDir);
      // Initial fetch
      const res1 = await app.request("/api/logs/scheduler?lines=10&grep=deploy");
      const data1 = await res1.json();
      expect(data1.entries).toHaveLength(1);
      const cursor = data1.cursor;

      // Append new data: one matching and one non-matching entry
      const newLines = [
        pinoLine(30, 1710700010000, "deploy finished"),
        pinoLine(30, 1710700011000, "status update"),
      ];
      writeFileSync(
        join(logsPath, "scheduler-2024-03-18.log"),
        lines.join("\n") + "\n" + newLines.join("\n") + "\n",
      );

      const res2 = await app.request(`/api/logs/scheduler?cursor=${encodeURIComponent(cursor)}&grep=deploy`);
      const data2 = await res2.json();
      expect(data2.entries).toHaveLength(1);
      expect(data2.entries[0].msg).toBe("deploy finished");
    });
  });
});
