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
  let testRunsDir: string;

  function makeFakeProc(pid?: number) {
    const { EventEmitter } = require("events");
    const proc = new EventEmitter();
    proc.pid = pid ?? 12345;
    proc.kill = vi.fn();
    return proc;
  }

  function writePidFileManually(runId: string, data: any) {
    mkdirSync(testRunsDir, { recursive: true });
    writeFileSync(join(testRunsDir, `${runId}.pid`), JSON.stringify(data) + "\n");
  }

  function writeLogFile(runId: string, content: string) {
    mkdirSync(testRunsDir, { recursive: true });
    writeFileSync(join(testRunsDir, `${runId}.log`), content);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // Create a fresh temp directory for each test so we never conflict with a
    // pre-existing /tmp/al-runs that may be owned by a different user (e.g. root).
    testRunsDir = mkdtempSync(join(tmpdir(), "al-runs-test-"));
    process.env.AL_RUNS_DIR = testRunsDir;
    // Default: user exists with uid/gid 1001
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "id" && args[0] === "-u") return "1001\n";
      if (cmd === "id" && args[0] === "-g") return "1001\n";
      return "";
    });
    runtime = new HostUserRuntime("al-agent");
  });

  afterEach(() => {
    // Remove the per-test temp directory and restore the env var.
    delete process.env.AL_RUNS_DIR;
    try {
      rmSync(testRunsDir, { recursive: true, force: true });
    } catch { /* best effort */ }
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
    it("spawns sudo with correct arguments and file-based stdio", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

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
          // stdio uses file descriptors (numbers) for stdout/stderr
          stdio: ["ignore", expect.any(Number), expect.any(Number)],
        }),
      );

      // Check env vars
      const spawnCall = mockSpawn.mock.calls[0];
      const spawnEnv = spawnCall[2].env;
      expect(spawnEnv.AL_CREDENTIALS_PATH).toBe("/tmp/creds");
      expect(spawnEnv.PROMPT).toBe("do something");

      fakeProc.emit("exit", 0);
    });

    it("does not include -g flag when no groups configured", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      await runtime.launch({
        image: "ignored",
        agentName: "test-agent",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      const spawnCall = mockSpawn.mock.calls[0];
      const sudoArgs: string[] = spawnCall[1];
      expect(sudoArgs).not.toContain("-g");

      fakeProc.emit("exit", 0);
    });

    it("includes -g flag when groups are configured", async () => {
      const runtimeWithGroups = new HostUserRuntime("al-agent", ["docker"]);
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      await runtimeWithGroups.launch({
        image: "ignored",
        agentName: "test-agent",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      const spawnCall = mockSpawn.mock.calls[0];
      const sudoArgs: string[] = spawnCall[1];
      expect(sudoArgs).toContain("-g");
      expect(sudoArgs).toContain("docker");

      // -g should come after -u and the runAs user
      const gIndex = sudoArgs.indexOf("-g");
      expect(sudoArgs[gIndex + 1]).toBe("docker");

      fakeProc.emit("exit", 0);
    });

    it("uses first group when multiple groups are configured", async () => {
      const runtimeWithGroups = new HostUserRuntime("al-agent", ["docker", "audio"]);
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      await runtimeWithGroups.launch({
        image: "ignored",
        agentName: "test-agent",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      const spawnCall = mockSpawn.mock.calls[0];
      const sudoArgs: string[] = spawnCall[1];
      const gIndex = sudoArgs.indexOf("-g");
      expect(sudoArgs[gIndex + 1]).toBe("docker");

      fakeProc.emit("exit", 0);
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
      writeFileSync(join(dir, "test.txt"), "hello");
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
      mockExecFileSync.mockImplementation(() => {
        throw new Error("id: no such user");
      });
      const rt = new HostUserRuntime("nonexistent-user");

      const tmpCreds = mkdtempSync(join(tmpdir(), "al-test-creds-"));
      try {
        const result = await rt.prepareCredentials([]);
        expect(result.strategy).toBe("host-user");
        expect(result.stagingDir).toBeDefined();
        rmSync(result.stagingDir, { recursive: true, force: true });
      } finally {
        rmSync(tmpCreds, { recursive: true, force: true });
      }
    });
  });

  // ── streamLogs (file-tailing, same path for fresh and adopted) ──────────

  describe("streamLogs", () => {
    it("returns empty stop when log file does not exist", () => {
      const handle = runtime.streamLogs("nonexistent-run", () => {});
      expect(() => handle.stop()).not.toThrow();
    });

    it("reads existing log file content", () => {
      const runId = "al-test-readlog-abc123";
      writeLogFile(runId, "line one\nline two\n");

      const lines: string[] = [];
      const handle = runtime.streamLogs(runId, (line) => lines.push(line));

      expect(lines).toEqual(["line one", "line two"]);
      handle.stop();
    });

    it("flushes partial line on stop", () => {
      const runId = "al-test-partial-abc123";
      writeLogFile(runId, "complete line\npartial");

      const lines: string[] = [];
      const handle = runtime.streamLogs(runId, (line) => lines.push(line));

      expect(lines).toEqual(["complete line"]);
      handle.stop();
      expect(lines).toContain("partial");
    });

    it("reads log file created by launch()", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runId = await runtime.launch({
        image: "ignored",
        agentName: "test-streamlaunch",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      // launch() creates the log file via openSync. Write some content to it.
      const logPath = join(testRunsDir, `${runId}.log`);
      writeFileSync(logPath, "hello from agent\n");

      const lines: string[] = [];
      const handle = runtime.streamLogs(runId, (line) => lines.push(line));

      expect(lines).toContain("hello from agent");
      handle.stop();
      fakeProc.emit("exit", 0);
    });
  });

  // ── waitForExit ─────────────────────────────────────────────────────────

  describe("waitForExit", () => {
    it("resolves with 1 when process not found", async () => {
      const code = await runtime.waitForExit("nonexistent-run", 5);
      expect(code).toBe(1);
    });

    it("resolves with process exit code", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runId = await runtime.launch({
        image: "ignored",
        agentName: "test-wait",
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
        agentName: "test-waitnull",
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
        agentName: "test-waiterror",
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
        agentName: "test-waittimeout",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      const exitPromise = runtime.waitForExit(runId, 10);
      vi.advanceTimersByTime(10_001);

      await expect(exitPromise).rejects.toThrow(`Agent ${runId} timed out after 10s`);
      expect(fakeProc.kill).toHaveBeenCalledWith("SIGTERM");

      vi.useRealTimers();
    });

    it("sends SIGKILL after 5s grace period when process persists after timeout", async () => {
      vi.useFakeTimers();
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runId = await runtime.launch({
        image: "ignored",
        agentName: "test-sigkill",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      const exitPromise = runtime.waitForExit(runId, 10);
      vi.advanceTimersByTime(10_001);
      await expect(exitPromise).rejects.toThrow();
      expect(fakeProc.kill).toHaveBeenCalledWith("SIGTERM");

      vi.advanceTimersByTime(5_001);
      expect(fakeProc.kill).toHaveBeenCalledWith("SIGKILL");

      vi.useRealTimers();
    });
  });

  // ── kill ─────────────────────────────────────────────────────────────────

  describe("kill with active process", () => {
    it("sends SIGTERM to active process", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runId = await runtime.launch({
        image: "ignored",
        agentName: "test-killactive",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      await runtime.kill(runId);
      expect(fakeProc.kill).toHaveBeenCalledWith("SIGTERM");

      fakeProc.emit("exit", 0);
    });

    it("escalates to SIGKILL after 5s grace period", async () => {
      vi.useFakeTimers();
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runId = await runtime.launch({
        image: "ignored",
        agentName: "test-killescalate",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      await runtime.kill(runId);
      expect(fakeProc.kill).toHaveBeenCalledWith("SIGTERM");

      vi.advanceTimersByTime(5_001);
      expect(fakeProc.kill).toHaveBeenCalledWith("SIGKILL");

      fakeProc.emit("exit", 0);
      vi.useRealTimers();
    });
  });

  // ── isAgentRunning / listRunningAgents with active process ──────────────

  describe("isAgentRunning / listRunningAgents with active process", () => {
    it("returns true for a running agent after launch", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      await runtime.launch({
        image: "ignored",
        agentName: "test-active",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      expect(await runtime.isAgentRunning("test-active")).toBe(true);
      expect(await runtime.isAgentRunning("other-agent")).toBe(false);

      fakeProc.emit("exit", 0);
    });

    it("lists running agents after launch", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      await runtime.launch({
        image: "ignored",
        agentName: "test-listed",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      const agents = await runtime.listRunningAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].agentName).toBe("test-listed");
      expect(agents[0].status).toBe("running");

      fakeProc.emit("exit", 0);
    });
  });

  describe("fetchLogs with log files", () => {
    it("returns log lines from matching agent log files", async () => {
      writeLogFile("al-test-fetch-abc123", '{"level":30,"time":1000,"msg":"hello"}\n{"level":30,"time":1001,"msg":"world"}\n');

      try {
        const lines = await runtime.fetchLogs("test-fetch", 10);
        expect(Array.isArray(lines)).toBe(true);
        expect(lines.length).toBeGreaterThan(0);
        expect(lines.some((l) => l.includes("hello"))).toBe(true);
      } finally {
        rmSync(join(testRunsDir, "al-test-fetch-abc123.log"), { force: true });
      }
    });
  });

  // ── PID file tracking & orphan recovery ──────────────────────────────────

  describe("PID file tracking", () => {
    it("launch creates PID file with process metadata", async () => {
      const fakeProc = makeFakeProc(54321);
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runId = await runtime.launch({
        image: "ignored",
        agentName: "test-pid",
        env: { SHUTDOWN_SECRET: "secret-123", GATEWAY_URL: "http://gw:3000" },
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      const pidFile = join(testRunsDir, `${runId}.pid`);
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

      const pidFile = join(testRunsDir, `${runId}.pid`);
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

      const data = JSON.parse(readFileSync(join(testRunsDir, `${runId}.pid`), "utf-8").trim());
      expect(data.env.SHUTDOWN_SECRET).toBeUndefined();

      fakeProc.emit("exit", 0);
    });
  });

  describe("orphan recovery via PID files", () => {
    describe("listRunningAgents", () => {
      it("discovers orphan processes from PID files", async () => {
        const runId = "al-test-orphan-abc12345";
        writePidFileManually(runId, {
          pid: process.pid,
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
        const pidFile = join(testRunsDir, `${runId}.pid`);
        writePidFileManually(runId, {
          pid: 2147483647,
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
        mkdirSync(testRunsDir, { recursive: true });
        writeFileSync(join(testRunsDir, `${runId}.pid`), "not valid json\n");

        const agents = await runtime.listRunningAgents();
        expect(agents.find(a => a.taskId === runId)).toBeUndefined();
        expect(existsSync(join(testRunsDir, `${runId}.pid`))).toBe(false);
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
        const pidFile = join(testRunsDir, `${runId}.pid`);
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

        const killSpy = vi.spyOn(process, "kill").mockImplementation((() => true) as any);

        await runtime.kill(runId);

        expect(killSpy).toHaveBeenCalledWith(fakePid, 0);
        expect(killSpy).toHaveBeenCalledWith(fakePid, "SIGTERM");

        killSpy.mockRestore();
      });

      it("cleans up PID file when orphan is already dead", async () => {
        const runId = "al-test-deadorphan-abc123";
        const pidFile = join(testRunsDir, `${runId}.pid`);
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
        const pidFile = join(testRunsDir, `${runId}.pid`);
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

  // ── reattach ────────────────────────────────────────────────────────────

  describe("reattach", () => {
    it("returns false when no PID file exists", () => {
      expect(runtime.reattach("al-test-nonexistent-abc123")).toBe(false);
    });

    it("returns false when process is dead", () => {
      const runId = "al-test-dead-reattach";
      writePidFileManually(runId, {
        pid: 2147483647,
        agentName: "test-dead",
        env: {},
        startedAt: new Date().toISOString(),
      });

      expect(runtime.reattach(runId)).toBe(false);
    });

    it("returns true and registers process for alive orphan", async () => {
      const runId = "al-test-alive-reattach";
      writePidFileManually(runId, {
        pid: process.pid,
        agentName: "test-alive",
        env: {},
        startedAt: new Date().toISOString(),
      });

      expect(runtime.reattach(runId)).toBe(true);

      // Process should now be tracked
      expect(await runtime.isAgentRunning("test-alive")).toBe(true);
      const agents = await runtime.listRunningAgents();
      expect(agents.find(a => a.taskId === runId)).toBeDefined();
    });

    it("returns true if already tracked", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runId = await runtime.launch({
        image: "ignored",
        agentName: "test-already",
        env: {},
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      expect(runtime.reattach(runId)).toBe(true);

      fakeProc.emit("exit", 0);
    });

    it("allows waitForExit after reattach", async () => {
      const runId = "al-test-reattach-wait";
      writePidFileManually(runId, {
        pid: process.pid,
        agentName: "test-reattach-wait",
        env: {},
        startedAt: new Date().toISOString(),
      });

      expect(runtime.reattach(runId)).toBe(true);

      // Mock isProcessAlive: alive first, then dead (triggers OrphanProcess exit)
      let aliveChecks = 0;
      const killSpy = vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: string | number) => {
        if (signal === 0 || signal === undefined) {
          aliveChecks++;
          if (aliveChecks > 2) throw new Error("No such process");
          return true;
        }
        return true;
      }) as any);

      const code = await runtime.waitForExit(runId, 30);
      expect(code).toBe(0);

      killSpy.mockRestore();
    });

    it("allows kill after reattach", async () => {
      const runId = "al-test-reattach-kill";
      writePidFileManually(runId, {
        pid: process.pid,
        agentName: "test-reattach-kill",
        env: {},
        startedAt: new Date().toISOString(),
      });

      const killSpy = vi.spyOn(process, "kill").mockImplementation((() => true) as any);

      expect(runtime.reattach(runId)).toBe(true);
      await runtime.kill(runId);

      expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM");

      killSpy.mockRestore();
    });

    it("allows streamLogs after reattach (tails log file)", () => {
      const runId = "al-test-reattach-logs";
      writePidFileManually(runId, {
        pid: process.pid,
        agentName: "test-reattach-logs",
        env: {},
        startedAt: new Date().toISOString(),
      });
      writeLogFile(runId, "orphan output line 1\norphan output line 2\n");

      runtime.reattach(runId);

      const lines: string[] = [];
      const handle = runtime.streamLogs(runId, (line) => lines.push(line));

      expect(lines).toEqual(["orphan output line 1", "orphan output line 2"]);
      handle.stop();
    });

    it("cleans up tracking when orphan process exits", async () => {
      const runId = "al-test-reattach-cleanup";
      writePidFileManually(runId, {
        pid: process.pid,
        agentName: "test-reattach-cleanup",
        env: {},
        startedAt: new Date().toISOString(),
      });

      // Mock: alive once (for reattach), then dead (triggers exit)
      let aliveChecks = 0;
      const killSpy = vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: string | number) => {
        if (signal === 0 || signal === undefined) {
          aliveChecks++;
          if (aliveChecks > 1) throw new Error("No such process");
          return true;
        }
        return true;
      }) as any);

      expect(runtime.reattach(runId)).toBe(true);
      expect(await runtime.isAgentRunning("test-reattach-cleanup")).toBe(true);

      // Wait for the OrphanProcess poll to detect death and emit exit
      await new Promise((r) => setTimeout(r, 600));

      expect(await runtime.isAgentRunning("test-reattach-cleanup")).toBe(false);

      killSpy.mockRestore();
    });
  });

  // ── shutdown ────────────────────────────────────────────────────────────

  describe("shutdown", () => {
    it("sends SIGTERM to all tracked processes", async () => {
      const fakeProc = makeFakeProc(99999);
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
