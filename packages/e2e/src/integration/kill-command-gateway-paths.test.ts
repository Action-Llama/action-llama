/**
 * Integration tests: cli/commands/kill.ts, stop.ts, pause.ts execute() gateway response paths
 * — no Docker required.
 *
 * Tests use a minimal HTTP server to simulate the gateway. These tests cover
 * the response parsing paths that were not tested in cli-gateway-commands.test.ts
 * (which only tested the ECONNREFUSED error path).
 *
 * Covers:
 *   - cli/commands/kill.ts: execute() — gateway 200 → logs data.message
 *   - cli/commands/kill.ts: execute() — gateway 404 → falls back to /control/kill/:id → logs message
 *   - cli/commands/kill.ts: execute() — gateway error response → throws Error
 *   - cli/commands/stop.ts: execute() — gateway 200 → logs data.message
 *   - cli/commands/stop.ts: execute() — gateway error → throws
 *   - cli/commands/pause.ts: execute() — gateway 200 → logs data.message
 *   - cli/commands/resume.ts: execute() — gateway 200 → logs data.message
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createServer, type Server } from "http";
import { stringify as stringifyTOML } from "smol-toml";

const { execute: killExecute } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/kill.js"
);

const { execute: stopExecute } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/stop.js"
);

const { execute: pauseExecute } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/pause.js"
);

const { execute: resumeExecute } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/resume.js"
);

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTempDir(port: number): string {
  const dir = mkdtempSync(join(tmpdir(), "al-kill-cmd-test-"));
  writeFileSync(join(dir, "config.toml"), stringifyTOML({
    gateway: { port, url: `http://localhost:${port}` },
  }));
  return dir;
}

async function captureLog(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...args: any[]) => lines.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.log = origLog;
  }
  return lines;
}

describe(
  "integration: cli gateway commands — gateway response paths (no Docker required)",
  { timeout: 15_000 },
  () => {
    let server: Server;
    let port: number;
    let projectDir: string;

    afterEach(async () => {
      if (server?.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    });

    async function startServer(handler: (req: any, res: any) => void) {
      server = createServer(handler);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      port = (server.address() as any).port;
      projectDir = makeTempDir(port);
    }

    // ── kill.execute() ────────────────────────────────────────────────────────

    it("kill.execute() — gateway 200 → logs message to console", async () => {
      await startServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Killed 2 instance(s) of my-agent", killed: 2 }));
      });

      const logs = await captureLog(() => killExecute("my-agent", { project: projectDir }));
      expect(logs.some((l) => l.includes("Killed 2 instance(s)"))).toBe(true);
    });

    it("kill.execute() — gateway error response → throws Error with gateway message", async () => {
      await startServer((_req, res) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      });

      await expect(
        killExecute("my-agent", { project: projectDir })
      ).rejects.toThrow("Internal server error");
    });

    it("kill.execute() — first 404, fallback to /control/kill/:id → logs message", async () => {
      let requestCount = 0;
      await startServer((_req, res) => {
        requestCount++;
        if (requestCount === 1) {
          // First request to /control/agents/:name/kill returns 404
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "not found" }));
        } else {
          // Fallback to /control/kill/:id returns 200
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "Instance my-agent killed" }));
        }
      });

      const logs = await captureLog(() => killExecute("my-agent", { project: projectDir }));
      expect(requestCount).toBe(2); // Two requests made
      expect(logs.some((l) => l.includes("killed"))).toBe(true);
    });

    // ── stop.execute() ────────────────────────────────────────────────────────

    it("stop.execute() — gateway 200 → logs message to console", async () => {
      await startServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Scheduler stopping" }));
      });

      const logs = await captureLog(() => stopExecute({ project: projectDir }));
      expect(logs.some((l) => l.includes("Scheduler stopping"))).toBe(true);
    });

    it("stop.execute() — gateway error → throws Error", async () => {
      await startServer((_req, res) => {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Stop not available" }));
      });

      await expect(
        stopExecute({ project: projectDir })
      ).rejects.toThrow("Stop not available");
    });

    // ── pause.execute() ───────────────────────────────────────────────────────

    it("pause.execute(undefined) — gateway 200 → logs message", async () => {
      await startServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, message: "Scheduler paused" }));
      });

      const logs = await captureLog(() => pauseExecute(undefined, { project: projectDir }));
      expect(logs.some((l) => l.includes("paused"))).toBe(true);
    });

    // ── resume.execute() ──────────────────────────────────────────────────────

    it("resume.execute('my-agent') — gateway 200 → logs message", async () => {
      await startServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, message: "Agent my-agent resumed" }));
      });

      const logs = await captureLog(() => resumeExecute("my-agent", { project: projectDir }));
      expect(logs.some((l) => l.includes("resumed"))).toBe(true);
    });
  },
);
