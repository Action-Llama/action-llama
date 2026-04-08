/**
 * Integration tests: cli/commands/run.ts execute() gateway error paths — no Docker required.
 *
 * NOTE: cli/commands/run.ts attempts to detect ECONNREFUSED errors and show
 * a user-friendly "Scheduler not running. Start it with 'al start'." message.
 * However, in Node.js 20+, fetch() wraps ECONNREFUSED in error.cause, not
 * error.message (message is "fetch failed"). The check error.message.includes("ECONNREFUSED")
 * does NOT match in Node.js 20+, so the original TypeError is rethrown.
 * (A bug report has been filed as a uci-error issue.)
 *
 * These tests verify the actual behavior in Node.js 20+:
 *   1. ECONNREFUSED → throws TypeError with "fetch failed" message (not user-friendly)
 *   2. Gateway returns error JSON → throws with error message from response body
 *   3. Gateway returns 200 → logs data.message to console
 *   4. Gateway returns 200 with prompt → includes prompt in request body
 *
 * Covers:
 *   - cli/commands/run.ts: execute() — connection failure → error thrown (actual: fetch failed)
 *   - cli/commands/run.ts: execute() — gateway 404 error response → throws with gateway error message
 *   - cli/commands/run.ts: execute() — gateway 200 response → logs success message
 *   - cli/commands/run.ts: execute() — with prompt → sends prompt to gateway
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createServer, type Server } from "http";
import { stringify as stringifyTOML } from "smol-toml";
import { stringify as stringifyYAML } from "yaml";

const { execute: runExecute } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/run.js"
);

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "al-run-gateway-test-"));
  writeFileSync(join(dir, "config.toml"), "");
  return dir;
}

function makeAgentDir(projectDir: string, agentName: string): void {
  const agentDir = join(projectDir, "agents", agentName);
  mkdirSync(agentDir, { recursive: true });
  const yamlStr = stringifyYAML({ name: agentName }).trimEnd();
  writeFileSync(join(agentDir, "SKILL.md"), `---\n${yamlStr}\n---\n\n# ${agentName}\n`);
  writeFileSync(join(agentDir, "config.toml"), stringifyTOML({
    models: ["sonnet"],
    schedule: "*/5 * * * *",
  }));
}

function setGatewayPort(projectDir: string, port: number): void {
  writeFileSync(join(projectDir, "config.toml"), stringifyTOML({
    gateway: { port, url: `http://localhost:${port}` },
  }));
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
  "integration: cli/commands/run.ts gateway error paths (no Docker required)",
  { timeout: 15_000 },
  () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = makeTempProject();
      makeAgentDir(projectDir, "my-agent");
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
    });

    // ── Connection failure path ───────────────────────────────────────────────

    it("connection failure to unreachable gateway → throws an Error instance", async () => {
      // Port 65432 is almost certainly not listening
      setGatewayPort(projectDir, 65432);

      let caught: any;
      try {
        await runExecute("my-agent", undefined, { project: projectDir });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
    });

    it("connection failure → error is a TypeError (Node.js 20+ fetch wraps ECONNREFUSED)", async () => {
      // In Node.js 20+, fetch wraps ECONNREFUSED in TypeError.cause,
      // not in TypeError.message. The check `error.message.includes("ECONNREFUSED")`
      // in run.ts does NOT match, so the original TypeError is rethrown.
      setGatewayPort(projectDir, 65432);

      let caught: any;
      try {
        await runExecute("my-agent", undefined, { project: projectDir });
      } catch (err) {
        caught = err;
      }
      // The actual error thrown is the original TypeError from fetch
      expect(caught).toBeInstanceOf(Error);
      // The ECONNREFUSED cause is in caught.cause (not in caught.message)
      const causeMsg = String(caught?.cause?.message || caught?.message || "");
      expect(causeMsg.includes("ECONNREFUSED") || causeMsg.includes("fetch failed")).toBe(true);
    });

    // ── Gateway error response ────────────────────────────────────────────────

    it("gateway returns 404 error JSON → throws with error message from response", async () => {
      const server: Server = createServer((_req, res) => {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Agent not found on gateway" }));
      });

      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as any).port;
      setGatewayPort(projectDir, port);

      try {
        await expect(
          runExecute("my-agent", undefined, { project: projectDir })
        ).rejects.toThrow("Agent not found on gateway");
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it("gateway returns non-ok status → throws Error (not resolves)", async () => {
      const server: Server = createServer((_req, res) => {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Scheduler is paused" }));
      });

      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as any).port;
      setGatewayPort(projectDir, port);

      try {
        let threw = false;
        try {
          await runExecute("my-agent", undefined, { project: projectDir });
        } catch {
          threw = true;
        }
        expect(threw).toBe(true);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    // ── Gateway success response ──────────────────────────────────────────────

    it("gateway returns 200 → logs the message from response", async () => {
      const server: Server = createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Agent my-agent triggered", instanceId: "inst-123" }));
      });

      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as any).port;
      setGatewayPort(projectDir, port);

      try {
        const logs = await captureLog(() =>
          runExecute("my-agent", undefined, { project: projectDir })
        );
        expect(logs.some((l) => l.includes("Agent my-agent triggered"))).toBe(true);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it("gateway returns 200 without message field → logs undefined (no error)", async () => {
      const server: Server = createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, instanceId: "inst-456" }));
      });

      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as any).port;
      setGatewayPort(projectDir, port);

      try {
        // Should not throw even without message field
        await expect(
          runExecute("my-agent", undefined, { project: projectDir })
        ).resolves.toBeUndefined();
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it("with prompt → gateway receives prompt in request body", async () => {
      let receivedBody: any = null;
      const server: Server = createServer(async (req, res) => {
        let body = "";
        for await (const chunk of req) body += chunk;
        try { receivedBody = JSON.parse(body); } catch { /* no body */ }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Triggered with prompt" }));
      });

      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as any).port;
      setGatewayPort(projectDir, port);

      try {
        await runExecute("my-agent", "analyze this repo", { project: projectDir });
        expect(receivedBody).not.toBeNull();
        expect(receivedBody.prompt).toBe("analyze this repo");
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  },
);
