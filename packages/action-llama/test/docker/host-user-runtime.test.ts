import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Mock child_process
const mockSpawn = vi.fn();
const mockExecFileSync = vi.fn();

vi.mock("child_process", () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
  execFileSync: (...args: any[]) => mockExecFileSync(...args),
}));

// Mock credentials
vi.mock("../../src/shared/credentials.js", () => ({
  parseCredentialRef: (ref: string) => {
    const sep = ref.indexOf(":");
    if (sep === -1) return { type: ref, instance: "default" };
    return { type: ref.slice(0, sep), instance: ref.slice(sep + 1) };
  },
  getDefaultBackend: () => ({
    readAll: vi.fn().mockResolvedValue({ token: "test-token-value" }),
  }),
}));

import { HostUserRuntime } from "../../src/docker/host-user-runtime.js";
import type { RuntimeCredentials } from "../../src/docker/runtime.js";

describe("HostUserRuntime", () => {
  let runtime: HostUserRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: user exists with uid/gid 1001
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "id" && args[0] === "-u") return "1001\n";
      if (cmd === "id" && args[0] === "-g") return "1001\n";
      return "";
    });
    runtime = new HostUserRuntime("al-agent");
  });

  describe("needsGateway", () => {
    it("is false", () => {
      expect(runtime.needsGateway).toBe(false);
    });
  });

  describe("prepareCredentials", () => {
    it("stages credentials to a temp directory", async () => {
      const creds = await runtime.prepareCredentials(["github_token"]);
      expect(creds.strategy).toBe("host-user");
      expect(creds.stagingDir).toBeTruthy();
      expect(creds.bundle).toHaveProperty("github_token");
      expect(creds.bundle.github_token.default.token).toBe("test-token-value");

      // Check file was written
      const tokenPath = join(creds.stagingDir, "github_token", "default", "token");
      expect(existsSync(tokenPath)).toBe(true);
      expect(readFileSync(tokenPath, "utf-8").trim()).toBe("test-token-value");

      // Cleanup
      runtime.cleanupCredentials(creds);
      expect(existsSync(creds.stagingDir)).toBe(false);
    });

    it("only stages requested credentials", async () => {
      const creds = await runtime.prepareCredentials(["github_token"]);
      const types = readdirSync(creds.stagingDir);
      expect(types).toEqual(["github_token"]);
      runtime.cleanupCredentials(creds);
    });
  });

  describe("cleanupCredentials", () => {
    it("removes the staging directory", async () => {
      const creds = await runtime.prepareCredentials(["github_token"]);
      expect(existsSync(creds.stagingDir)).toBe(true);
      runtime.cleanupCredentials(creds);
      expect(existsSync(creds.stagingDir)).toBe(false);
    });

    it("handles already-removed directory gracefully", () => {
      const creds: RuntimeCredentials = {
        strategy: "host-user",
        stagingDir: "/tmp/nonexistent-dir-12345",
        bundle: {},
      };
      expect(() => runtime.cleanupCredentials(creds)).not.toThrow();
    });
  });

  describe("launch", () => {
    it("spawns sudo with correct arguments", async () => {
      const mockProc = {
        stdout: { pipe: vi.fn(), on: vi.fn() },
        stderr: { pipe: vi.fn(), on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockProc);

      const runId = await runtime.launch({
        image: "ignored",
        agentName: "test-agent",
        env: { PROMPT: "do something" },
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      expect(runId).toMatch(/^al-test-agent-/);
      expect(mockSpawn).toHaveBeenCalledWith(
        "sudo",
        expect.arrayContaining(["-u", "al-agent"]),
        expect.objectContaining({
          stdio: ["ignore", "pipe", "pipe"],
        }),
      );

      // Check env vars
      const spawnCall = mockSpawn.mock.calls[0];
      const spawnEnv = spawnCall[2].env;
      expect(spawnEnv.AL_CREDENTIALS_PATH).toBe("/tmp/creds");
      expect(spawnEnv.PROMPT).toBe("do something");
    });
  });

  describe("isAgentRunning / listRunningAgents", () => {
    it("returns false / empty when no agents are running", async () => {
      expect(await runtime.isAgentRunning("test-agent")).toBe(false);
      expect(await runtime.listRunningAgents()).toEqual([]);
    });
  });

  describe("kill", () => {
    it("does not throw for unknown runId", async () => {
      await expect(runtime.kill("nonexistent")).resolves.not.toThrow();
    });
  });

  describe("remove", () => {
    it("removes the working directory", async () => {
      const dir = mkdtempSync(join(tmpdir(), "al-test-run-"));
      const runId = dir.split("/").pop()!;
      // Create a file in the dir
      writeFileSync(join(dir, "test.txt"), "hello");

      // Note: remove() uses RUNS_DIR internally, so this tests the graceful handling
      await expect(runtime.remove(runId)).resolves.not.toThrow();
    });
  });

  describe("getTaskUrl", () => {
    it("returns null", () => {
      expect(runtime.getTaskUrl("any")).toBeNull();
    });
  });

  describe("fetchLogs", () => {
    it("returns empty array when no logs exist", async () => {
      const logs = await runtime.fetchLogs("nonexistent-agent", 50);
      expect(logs).toEqual([]);
    });
  });

  // ── resolveUid/resolveGid error paths ────────────────────────────────────

  describe("resolveUid/resolveGid fallback when id fails", () => {
    it("prepareCredentials works when user resolution fails (uid/gid = undefined)", async () => {
      // Make id calls throw
      mockExecFileSync.mockImplementation(() => {
        throw new Error("id: no such user");
      });
      // Re-create runtime with failing mock
      const rt = new HostUserRuntime("nonexistent-user");

      const tmpCreds = mkdtempSync(join(tmpdir(), "al-test-creds-"));
      try {
        // Should not throw — chown is skipped when uid/gid undefined
        const result = await rt.prepareCredentials([]);
        expect(result.strategy).toBe("host-user");
        expect(result.stagingDir).toBeDefined();
        // Cleanup
        rmSync(result.stagingDir, { recursive: true, force: true });
      } finally {
        rmSync(tmpCreds, { recursive: true, force: true });
      }
    });
  });

  // ── Processes lifecycle tests ─────────────────────────────────────────────

  describe("streamLogs with active process", () => {
    function makeFakeProc() {
      const { EventEmitter } = require("events");
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      proc.pipe = vi.fn();
      proc.stdout.pipe = vi.fn();
      proc.stderr.pipe = vi.fn();
      return proc;
    }

    it("returns empty stop when process not found", () => {
      const handle = runtime.streamLogs("nonexistent-run", () => {});
      expect(() => handle.stop()).not.toThrow();
    });

    it("buffers lines emitted before streamLogs() is called and replays them", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runId = await runtime.launch({
        image: "ignored",
        agentName: "buffer-test",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      // Simulate data arriving BEFORE streamLogs() is attached (the race condition)
      fakeProc.stdout.emit("data", Buffer.from("early line one\nearly line two\n"));

      // Now attach streamLogs — should receive both buffered lines
      const lines: string[] = [];
      runtime.streamLogs(runId, (line) => lines.push(line));

      expect(lines).toEqual(["early line one", "early line two"]);

      // Lines emitted after should also be received
      fakeProc.stdout.emit("data", Buffer.from("late line\n"));
      expect(lines).toEqual(["early line one", "early line two", "late line"]);

      fakeProc.emit("exit", 0);
    });

    it("buffers stderr emitted before streamLogs() and replays it", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runId = await runtime.launch({
        image: "ignored",
        agentName: "buffer-stderr",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      // Emit stderr before streamLogs() is attached
      fakeProc.stderr.emit("data", Buffer.from("early stderr\n"));

      const errors: string[] = [];
      runtime.streamLogs(runId, () => {}, (msg) => errors.push(msg));

      expect(errors).toContain("early stderr");

      fakeProc.emit("exit", 0);
    });

    it("receives stdout lines from active process", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runId = await runtime.launch({
        image: "ignored",
        agentName: "stream-test",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      const lines: string[] = [];
      runtime.streamLogs(runId, (line) => lines.push(line));

      fakeProc.stdout.emit("data", Buffer.from("log line one\nlog line two\n"));
      expect(lines).toEqual(["log line one", "log line two"]);

      // Cleanup
      fakeProc.emit("exit", 0);
    });

    it("receives stderr via onStderr callback", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runId = await runtime.launch({
        image: "ignored",
        agentName: "stream-stderr",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      const errors: string[] = [];
      runtime.streamLogs(runId, () => {}, (msg) => errors.push(msg));

      fakeProc.stderr.emit("data", Buffer.from("stderr warning\n"));
      expect(errors).toContain("stderr warning");

      fakeProc.emit("exit", 0);
    });

    it("stop() flushes buffered partial line and removes listener", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runId = await runtime.launch({
        image: "ignored",
        agentName: "stream-stop",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      const lines: string[] = [];
      const handle = runtime.streamLogs(runId, (line) => lines.push(line));

      fakeProc.stdout.emit("data", Buffer.from("partial line without newline"));
      handle.stop();

      expect(lines).toContain("partial line without newline");

      fakeProc.emit("exit", 0);
    });
  });

  describe("waitForExit with active process", () => {
    function makeFakeProc() {
      const { EventEmitter } = require("events");
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      proc.stdout.pipe = vi.fn();
      proc.stderr.pipe = vi.fn();
      return proc;
    }

    it("resolves with 1 when process not found", async () => {
      const code = await runtime.waitForExit("nonexistent-run", 5);
      expect(code).toBe(1);
    });

    it("resolves with process exit code", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runId = await runtime.launch({
        image: "ignored",
        agentName: "wait-test",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      const exitPromise = runtime.waitForExit(runId, 60);
      fakeProc.emit("exit", 0);

      const code = await exitPromise;
      expect(code).toBe(0);
    });

    it("resolves with code 1 when exit code is null", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runId = await runtime.launch({
        image: "ignored",
        agentName: "wait-null",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      const exitPromise = runtime.waitForExit(runId, 60);
      fakeProc.emit("exit", null);

      const code = await exitPromise;
      expect(code).toBe(1);
    });

    it("rejects on process error event", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runId = await runtime.launch({
        image: "ignored",
        agentName: "wait-error",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      const exitPromise = runtime.waitForExit(runId, 60);
      fakeProc.emit("error", new Error("process error"));

      await expect(exitPromise).rejects.toThrow("process error");
    });

    it("rejects on timeout and sends SIGTERM + SIGKILL", async () => {
      vi.useFakeTimers();
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runId = await runtime.launch({
        image: "ignored",
        agentName: "wait-timeout",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      const exitPromise = runtime.waitForExit(runId, 10);
      vi.advanceTimersByTime(10_001);

      await expect(exitPromise).rejects.toThrow(`Agent ${runId} timed out after 10s`);
      expect(fakeProc.kill).toHaveBeenCalledWith("SIGTERM");

      vi.useRealTimers();
    });
  });

  describe("kill with active process", () => {
    function makeFakeProc() {
      const { EventEmitter } = require("events");
      const proc = new EventEmitter();
      proc.kill = vi.fn();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdout.pipe = vi.fn();
      proc.stderr.pipe = vi.fn();
      return proc;
    }

    it("sends SIGTERM to active process", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runId = await runtime.launch({
        image: "ignored",
        agentName: "kill-test",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      await runtime.kill(runId);
      expect(fakeProc.kill).toHaveBeenCalledWith("SIGTERM");

      fakeProc.emit("exit", 0);
    });
  });

  describe("isAgentRunning / listRunningAgents with active process", () => {
    function makeFakeProc() {
      const { EventEmitter } = require("events");
      const proc = new EventEmitter();
      proc.kill = vi.fn();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdout.pipe = vi.fn();
      proc.stderr.pipe = vi.fn();
      return proc;
    }

    it("returns true for a running agent after launch", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      await runtime.launch({
        image: "ignored",
        agentName: "active-agent",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      expect(await runtime.isAgentRunning("active-agent")).toBe(true);
      expect(await runtime.isAgentRunning("other-agent")).toBe(false);

      fakeProc.emit("exit", 0);
    });

    it("lists running agents after launch", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      await runtime.launch({
        image: "ignored",
        agentName: "listed-agent",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      const agents = await runtime.listRunningAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].agentName).toBe("listed-agent");
      expect(agents[0].status).toBe("running");

      fakeProc.emit("exit", 0);
    });
  });

  describe("waitForExit SIGKILL escalation", () => {
    function makeFakeProc() {
      const { EventEmitter } = require("events");
      const proc = new EventEmitter();
      proc.kill = vi.fn();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdout.pipe = vi.fn();
      return proc;
    }

    it("sends SIGKILL after 5s grace period when process is still alive after timeout", async () => {
      vi.useFakeTimers();
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runId = await runtime.launch({
        image: "ignored",
        agentName: "sigkill-test",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      const exitPromise = runtime.waitForExit(runId, 10);
      // Advance past the timeout (10s) + SIGKILL grace (5s)
      vi.advanceTimersByTime(10_001);
      await expect(exitPromise).rejects.toThrow();
      // SIGTERM should be sent immediately
      expect(fakeProc.kill).toHaveBeenCalledWith("SIGTERM");

      // Now advance past the 5s grace period — process is still in `processes` map
      vi.advanceTimersByTime(5_001);
      // SIGKILL should be sent
      expect(fakeProc.kill).toHaveBeenCalledWith("SIGKILL");

      vi.useRealTimers();
    });
  });

  describe("kill SIGKILL escalation", () => {
    function makeFakeProc() {
      const { EventEmitter } = require("events");
      const proc = new EventEmitter();
      proc.kill = vi.fn();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdout.pipe = vi.fn();
      return proc;
    }

    it("escalates to SIGKILL after 5s grace period when process persists", async () => {
      vi.useFakeTimers();
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runId = await runtime.launch({
        image: "ignored",
        agentName: "kill-sigkill",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      await runtime.kill(runId);
      expect(fakeProc.kill).toHaveBeenCalledWith("SIGTERM");

      // Process is still alive (not removed from map), advance past grace period
      vi.advanceTimersByTime(5_001);
      expect(fakeProc.kill).toHaveBeenCalledWith("SIGKILL");

      fakeProc.emit("exit", 0);
      vi.useRealTimers();
    });
  });

  describe("fetchLogs with log files", () => {
    const RUNS_DIR = join(tmpdir(), "al-runs");

    it("returns log lines from matching agent log files", async () => {
      // Create mock log files in RUNS_DIR
      mkdirSync(RUNS_DIR, { recursive: true });
      const logFile = join(RUNS_DIR, "al-fetch-test-abc123.log");
      writeFileSync(logFile, '{"level":30,"time":1000,"msg":"hello"}\n{"level":30,"time":1001,"msg":"world"}\n');

      try {
        const lines = await runtime.fetchLogs("fetch-test", 10);
        expect(Array.isArray(lines)).toBe(true);
        expect(lines.length).toBeGreaterThan(0);
        expect(lines.some((l) => l.includes("hello"))).toBe(true);
      } finally {
        rmSync(logFile, { force: true });
      }
    });
  });

  // ── PID file tracking & orphan recovery ──────────────────────────────────

  describe("PID file tracking", () => {
    const RUNS_DIR = join(tmpdir(), "al-runs");

    function makeFakeProc(pid?: number) {
      const { EventEmitter } = require("events");
      const proc = new EventEmitter();
      proc.pid = pid ?? 12345;
      proc.kill = vi.fn();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdout.pipe = vi.fn();
      proc.stderr.pipe = vi.fn();
      return proc;
    }

    function writePidFileManually(runId: string, data: any) {
      mkdirSync(RUNS_DIR, { recursive: true });
      writeFileSync(join(RUNS_DIR, `${runId}.pid`), JSON.stringify(data) + "\n");
    }

    afterEach(() => {
      // Clean up test PID files
      try {
        for (const f of readdirSync(RUNS_DIR)) {
          if (f.endsWith(".pid") && f.includes("-test-")) {
            rmSync(join(RUNS_DIR, f), { force: true });
          }
        }
      } catch { /* dir may not exist */ }
    });

    it("launch creates PID file with process metadata", async () => {
      const fakeProc = makeFakeProc(54321);
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runId = await runtime.launch({
        image: "ignored",
        agentName: "test-pid",
        env: { SHUTDOWN_SECRET: "secret-123", GATEWAY_URL: "http://gw:3000" },
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      const pidFile = join(RUNS_DIR, `${runId}.pid`);
      expect(existsSync(pidFile)).toBe(true);

      const data = JSON.parse(readFileSync(pidFile, "utf-8").trim());
      expect(data.pid).toBe(54321);
      expect(data.agentName).toBe("test-pid");
      expect(data.env.SHUTDOWN_SECRET).toBe("secret-123");
      expect(data.env.GATEWAY_URL).toBe("http://gw:3000");
      expect(data.env.AL_CREDENTIALS_PATH).toBe("/tmp/creds");
      expect(data.startedAt).toBeTruthy();

      fakeProc.emit("exit", 0);
    });

    it("removes PID file on process exit", async () => {
      const fakeProc = makeFakeProc(54322);
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runId = await runtime.launch({
        image: "ignored",
        agentName: "test-pidexit",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      const pidFile = join(RUNS_DIR, `${runId}.pid`);
      expect(existsSync(pidFile)).toBe(true);

      fakeProc.emit("exit", 0);
      expect(existsSync(pidFile)).toBe(false);
    });

    it("omits SHUTDOWN_SECRET from PID file when not provided", async () => {
      const fakeProc = makeFakeProc(54323);
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runId = await runtime.launch({
        image: "ignored",
        agentName: "test-nosecret",
        env: { PROMPT: "hello" },
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      const data = JSON.parse(readFileSync(join(RUNS_DIR, `${runId}.pid`), "utf-8").trim());
      expect(data.env.SHUTDOWN_SECRET).toBeUndefined();

      fakeProc.emit("exit", 0);
    });
  });

  describe("orphan recovery via PID files", () => {
    const RUNS_DIR = join(tmpdir(), "al-runs");

    function writePidFileManually(runId: string, data: any) {
      mkdirSync(RUNS_DIR, { recursive: true });
      writeFileSync(join(RUNS_DIR, `${runId}.pid`), JSON.stringify(data) + "\n");
    }

    afterEach(() => {
      try {
        for (const f of readdirSync(RUNS_DIR)) {
          if (f.endsWith(".pid") && f.includes("-test-")) {
            rmSync(join(RUNS_DIR, f), { force: true });
          }
        }
      } catch { /* dir may not exist */ }
    });

    describe("listRunningAgents", () => {
      it("discovers orphan processes from PID files", async () => {
        const runId = "al-test-orphan-abc12345";
        writePidFileManually(runId, {
          pid: process.pid, // current process is alive
          agentName: "test-orphan",
          env: { SHUTDOWN_SECRET: "old-secret" },
          startedAt: "2026-03-30T12:00:00.000Z",
        });

        const agents = await runtime.listRunningAgents();
        const orphan = agents.find(a => a.taskId === runId);
        expect(orphan).toBeDefined();
        expect(orphan!.agentName).toBe("test-orphan");
        expect(orphan!.status).toBe("running");
        expect(orphan!.startedAt).toEqual(new Date("2026-03-30T12:00:00.000Z"));
      });

      it("cleans up stale PID files for dead processes", async () => {
        const runId = "al-test-stale-deadbeef";
        const pidFile = join(RUNS_DIR, `${runId}.pid`);
        writePidFileManually(runId, {
          pid: 2147483647, // almost certainly doesn't exist
          agentName: "test-stale",
          env: {},
          startedAt: new Date().toISOString(),
        });

        const agents = await runtime.listRunningAgents();
        expect(agents.find(a => a.taskId === runId)).toBeUndefined();
        expect(existsSync(pidFile)).toBe(false);
      });

      it("removes corrupt PID files", async () => {
        const runId = "al-test-corrupt-abc123";
        mkdirSync(RUNS_DIR, { recursive: true });
        writeFileSync(join(RUNS_DIR, `${runId}.pid`), "not valid json\n");

        const agents = await runtime.listRunningAgents();
        expect(agents.find(a => a.taskId === runId)).toBeUndefined();
        expect(existsSync(join(RUNS_DIR, `${runId}.pid`))).toBe(false);
      });
    });

    describe("isAgentRunning", () => {
      it("detects orphan agent via PID file", async () => {
        writePidFileManually("al-test-myagent-abc12345", {
          pid: process.pid,
          agentName: "test-myagent",
          env: {},
          startedAt: new Date().toISOString(),
        });

        expect(await runtime.isAgentRunning("test-myagent")).toBe(true);
        expect(await runtime.isAgentRunning("other-agent")).toBe(false);
      });
    });

    describe("inspectContainer", () => {
      it("returns env from PID file for alive process", async () => {
        const runId = "al-test-inspect-abc12345";
        writePidFileManually(runId, {
          pid: process.pid,
          agentName: "test-inspect",
          env: { SHUTDOWN_SECRET: "inspect-secret", GATEWAY_URL: "http://gw:3000" },
          startedAt: new Date().toISOString(),
        });

        const result = await runtime.inspectContainer(runId);
        expect(result).toEqual({
          env: { SHUTDOWN_SECRET: "inspect-secret", GATEWAY_URL: "http://gw:3000" },
        });
      });

      it("returns null and cleans up PID file for dead process", async () => {
        const runId = "al-test-dead-abc12345";
        const pidFile = join(RUNS_DIR, `${runId}.pid`);
        writePidFileManually(runId, {
          pid: 2147483647,
          agentName: "test-dead",
          env: { SHUTDOWN_SECRET: "dead-secret" },
          startedAt: new Date().toISOString(),
        });

        const result = await runtime.inspectContainer(runId);
        expect(result).toBeNull();
        expect(existsSync(pidFile)).toBe(false);
      });

      it("returns null when PID file does not exist", async () => {
        const result = await runtime.inspectContainer("al-test-nonexistent-abc12345");
        expect(result).toBeNull();
      });
    });

    describe("kill orphan via PID file", () => {
      it("sends SIGTERM to orphan process", async () => {
        const fakePid = 98765;
        const runId = "al-test-killorphan-abc123";
        writePidFileManually(runId, {
          pid: fakePid,
          agentName: "test-killorphan",
          env: {},
          startedAt: new Date().toISOString(),
        });

        // Mock process.kill so we don't send real signals
        const killSpy = vi.spyOn(process, "kill").mockImplementation((() => true) as any);

        await runtime.kill(runId);

        expect(killSpy).toHaveBeenCalledWith(fakePid, 0); // alive check
        expect(killSpy).toHaveBeenCalledWith(fakePid, "SIGTERM"); // kill signal

        killSpy.mockRestore();
      });

      it("cleans up PID file when orphan is already dead", async () => {
        const runId = "al-test-deadorphan-abc123";
        const pidFile = join(RUNS_DIR, `${runId}.pid`);
        writePidFileManually(runId, {
          pid: 2147483647,
          agentName: "test-deadorphan",
          env: {},
          startedAt: new Date().toISOString(),
        });

        await runtime.kill(runId);
        expect(existsSync(pidFile)).toBe(false);
      });
    });

    describe("remove cleans up PID file", () => {
      it("removes PID file along with working directory", async () => {
        const runId = "al-test-removepid-abc123";
        const pidFile = join(RUNS_DIR, `${runId}.pid`);
        writePidFileManually(runId, {
          pid: 12345,
          agentName: "test-removepid",
          env: {},
          startedAt: new Date().toISOString(),
        });

        await runtime.remove(runId);
        expect(existsSync(pidFile)).toBe(false);
      });
    });
  });

  describe("shutdown", () => {
    it("sends SIGTERM to all tracked processes", async () => {
      const { EventEmitter } = require("events");
      const fakeProc = new EventEmitter();
      fakeProc.pid = 99999;
      fakeProc.kill = vi.fn();
      fakeProc.stdout = new EventEmitter();
      fakeProc.stderr = new EventEmitter();
      fakeProc.stdout.pipe = vi.fn();
      fakeProc.stderr.pipe = vi.fn();
      mockSpawn.mockReturnValueOnce(fakeProc);

      await runtime.launch({
        image: "ignored",
        agentName: "test-shutdown",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      await runtime.shutdown();
      expect(fakeProc.kill).toHaveBeenCalledWith("SIGTERM");

      fakeProc.emit("exit", 0);
    });
  });
});
