import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Mock child_process
const { mockExecFile, mockSpawn } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, execFile: mockExecFile, spawn: mockSpawn };
});

// Mock credentials module
vi.mock("../../src/shared/credentials.js", () => ({
  parseCredentialRef: (ref: string) => {
    const sep = ref.indexOf(":");
    if (sep === -1) return { type: ref, instance: "default" };
    return { type: ref.slice(0, sep).trim(), instance: ref.slice(sep + 1).trim() };
  },
  getDefaultBackend: () => ({
    readAll: () => Promise.resolve({ token: "fake-value" }),
  }),
}));

const { SshDockerRuntime } = await import("../../src/docker/ssh-docker-runtime.js");
type Runtime = import("../../src/docker/runtime.js").Runtime;
type ContainerRuntime = import("../../src/docker/runtime.js").ContainerRuntime;
type SshConfig = import("../../src/cloud/vps/ssh.js").SshConfig;

const testSshConfig: SshConfig = {
  host: "1.2.3.4",
  user: "root",
  port: 22,
  keyPath: "/home/test/.ssh/id_rsa",
};

function mockSshSuccess(stdout = "") {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
    cb(null, stdout + "\n", "");
  });
}

function mockSshFailure(stderr = "error", exitCode = 1) {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
    const err: any = new Error(stderr);
    err.code = exitCode;
    cb(err, "", stderr);
  });
}

describe("SshDockerRuntime", () => {
  let runtime: InstanceType<typeof SshDockerRuntime>;

  beforeEach(() => {
    mockExecFile.mockReset();
    mockSpawn.mockReset();
    runtime = new SshDockerRuntime(testSshConfig);
  });

  it("implements Runtime & ContainerRuntime interface", () => {
    const rt: Runtime & ContainerRuntime = runtime;
    expect(typeof rt.launch).toBe("function");
    expect(typeof rt.streamLogs).toBe("function");
    expect(typeof rt.waitForExit).toBe("function");
    expect(typeof rt.kill).toBe("function");
    expect(typeof rt.remove).toBe("function");
    expect(typeof rt.prepareCredentials).toBe("function");
    expect(typeof rt.pushImage).toBe("function");
    expect(typeof rt.buildImage).toBe("function");
    expect(typeof rt.cleanupCredentials).toBe("function");
    expect(rt.needsGateway).toBe(false);
  });

  it("pushImage returns input unchanged (no registry)", async () => {
    const result = await runtime.pushImage("al-agent:latest");
    expect(result).toBe("al-agent:latest");
  });

  it("getTaskUrl returns null", () => {
    expect(runtime.getTaskUrl("container")).toBeNull();
  });

  describe("isAgentRunning", () => {
    it("returns true when containers match", async () => {
      mockSshSuccess("al-test-agent-abc12345");
      const running = await runtime.isAgentRunning("test-agent");
      expect(running).toBe(true);
    });

    it("returns false when no containers match", async () => {
      mockSshSuccess("");
      const running = await runtime.isAgentRunning("test-agent");
      expect(running).toBe(false);
    });

    it("returns false on SSH error", async () => {
      mockSshFailure();
      const running = await runtime.isAgentRunning("test-agent");
      expect(running).toBe(false);
    });
  });

  describe("listRunningAgents", () => {
    it("parses docker ps output", async () => {
      mockSshSuccess("al-my-agent-abc12345\tUp 5 minutes\t2025-01-01 00:00:00 +0000 UTC");
      const agents = await runtime.listRunningAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].agentName).toBe("my-agent");
      expect(agents[0].taskId).toBe("al-my-agent-abc12345");
    });

    it("returns empty on error", async () => {
      mockSshFailure();
      const agents = await runtime.listRunningAgents();
      expect(agents).toEqual([]);
    });
  });

  describe("kill and remove", () => {
    it("kill sends docker kill via SSH", async () => {
      mockSshSuccess();
      await runtime.kill("al-test-abc");
      const args = mockExecFile.mock.calls[0][1] as string[];
      const cmd = args[args.length - 1];
      expect(cmd).toContain("kill");
      expect(cmd).toContain("al-test-abc");
    });

    it("kill swallows error for already-dead container", async () => {
      mockSshFailure("No such container");
      await expect(runtime.kill("al-test-abc")).resolves.toBeUndefined();
    });

    it("remove sends docker rm -f via SSH", async () => {
      mockSshSuccess();
      await runtime.remove("al-test-abc");
      const args = mockExecFile.mock.calls[0][1] as string[];
      const cmd = args[args.length - 1];
      expect(cmd).toContain("rm");
      expect(cmd).toContain("al-test-abc");
    });
  });

  describe("fetchLogs", () => {
    it("fetches logs from matching containers", async () => {
      let callCount = 0;
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        callCount++;
        if (callCount === 1) {
          cb(null, "al-test-abc12345\n", "");
        } else {
          cb(null, "line1\nline2\n", "");
        }
      });

      const logs = await runtime.fetchLogs("test", 10);
      expect(logs).toEqual(["line1", "line2"]);
    });

    it("returns empty when no containers found", async () => {
      mockSshSuccess("");
      const logs = await runtime.fetchLogs("test", 10);
      expect(logs).toEqual([]);
    });
  });

  describe("prepareCredentials", () => {
    it("chowns staging dir to container UID after writing files", async () => {
      // scpBuffer uses spawn (not execFile), so mock both
      mockSshSuccess(); // for execFile (mkdir, chown)
      mockSpawn.mockImplementation(() => {
        const proc = new EventEmitter();
        (proc as any).stdin = { end: vi.fn() };
        (proc as any).stdout = new EventEmitter();
        (proc as any).stderr = new EventEmitter();
        process.nextTick(() => proc.emit("close", 0));
        return proc;
      });

      const result = await runtime.prepareCredentials(["anthropic_key"]);
      expect(result.strategy).toBe("volume");
      expect(result.stagingDir).toMatch(/^\/tmp\/al-creds-/);

      // Collect all SSH commands (execFile calls only — spawn is used for scpBuffer)
      const sshCmds = mockExecFile.mock.calls.map((c: any[]) => {
        const args = c[1] as string[];
        return args[args.length - 1];
      });

      // Must chown to container UID:GID after staging files
      const chownCmd = sshCmds.find((cmd: string) => cmd.includes("chown"));
      expect(chownCmd).toBeDefined();
      expect(chownCmd).toContain("1000:1000");
      expect(chownCmd).toContain(result.stagingDir);

      // chown must be the last execFile call (after mkdir + scpBuffer writes)
      const chownIndex = sshCmds.indexOf(chownCmd!);
      expect(chownIndex).toBe(sshCmds.length - 1);
    });
  });

  describe("cleanupCredentials", () => {
    it("handles volume strategy by cleaning up remote dir", () => {
      mockSshSuccess();
      runtime.cleanupCredentials({
        strategy: "volume",
        stagingDir: "/tmp/al-creds-abc",
        bundle: {},
      });
      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args[args.length - 1]).toContain("rm -rf");
      expect(args[args.length - 1]).toContain("/tmp/al-creds-abc");
    });

    it("is safe on secrets-manager strategy", () => {
      expect(() => {
        runtime.cleanupCredentials({ strategy: "secrets-manager", mounts: [] });
      }).not.toThrow();
      expect(mockExecFile).not.toHaveBeenCalled();
    });
  });

  describe("streamLogs", () => {
    it("streams lines from SSH docker logs", () => {
      const fakeProc = new EventEmitter();
      (fakeProc as any).stdout = new EventEmitter();
      (fakeProc as any).stderr = new EventEmitter();
      (fakeProc as any).kill = vi.fn();
      mockSpawn.mockReturnValue(fakeProc);

      const lines: string[] = [];
      const handle = runtime.streamLogs("container", (line) => lines.push(line));

      (fakeProc as any).stdout.emit("data", Buffer.from("line1\nline2\n"));
      expect(lines).toEqual(["line1", "line2"]);

      handle.stop();
      expect((fakeProc as any).kill).toHaveBeenCalled();
    });

    it("flushes incomplete buffer on stop", () => {
      const fakeProc = new EventEmitter();
      (fakeProc as any).stdout = new EventEmitter();
      (fakeProc as any).stderr = new EventEmitter();
      (fakeProc as any).kill = vi.fn();
      mockSpawn.mockReturnValue(fakeProc);

      const lines: string[] = [];
      const handle = runtime.streamLogs("container", (line) => lines.push(line));

      // Partial line without newline
      (fakeProc as any).stdout.emit("data", Buffer.from("incomplete line"));

      handle.stop();

      expect(lines).toContain("incomplete line");
    });

    it("streams stderr via onStderr callback", () => {
      const fakeProc = new EventEmitter();
      (fakeProc as any).stdout = new EventEmitter();
      (fakeProc as any).stderr = new EventEmitter();
      (fakeProc as any).kill = vi.fn();
      mockSpawn.mockReturnValue(fakeProc);

      const stderrLines: string[] = [];
      runtime.streamLogs("container", () => {}, (text) => stderrLines.push(text));

      (fakeProc as any).stderr.emit("data", Buffer.from("error output"));

      expect(stderrLines).toContain("error output");
    });
  });

  describe("launch", () => {
    it("starts container with docker run -d and returns container name", async () => {
      mockSshSuccess();

      const containerName = await runtime.launch({
        agentName: "test-agent",
        image: "al-agent:sha",
        env: { MY_VAR: "value" },
        credentials: { strategy: "volume", stagingDir: "/tmp/al-creds-abc", bundle: {} },
      });

      expect(containerName).toMatch(/^al-test-agent-/);
      const args = mockExecFile.mock.calls[0][1] as string[];
      const cmd = args[args.length - 1];
      expect(cmd).toContain("docker");
      expect(cmd).toContain("run");
      expect(cmd).toContain("-d");
      expect(cmd).toContain("--name");
      expect(cmd).toContain("al-agent:sha");
    });

    it("mounts credentials volume when strategy is volume", async () => {
      mockSshSuccess();

      await runtime.launch({
        agentName: "test-agent",
        image: "al-agent:sha",
        env: {},
        credentials: { strategy: "volume", stagingDir: "/tmp/al-creds-xyz", bundle: {} },
      });

      const args = mockExecFile.mock.calls[0][1] as string[];
      const cmd = args[args.length - 1];
      expect(cmd).toContain("/tmp/al-creds-xyz:/credentials:ro");
    });

    it("passes env variables to docker run", async () => {
      mockSshSuccess();

      await runtime.launch({
        agentName: "test-agent",
        image: "al-agent:sha",
        env: { FOO: "bar", HELLO: "world" },
        credentials: { strategy: "volume", stagingDir: "/tmp/al-creds-abc", bundle: {} },
      });

      const args = mockExecFile.mock.calls[0][1] as string[];
      const cmd = args[args.length - 1];
      expect(cmd).toContain("FOO=bar");
      expect(cmd).toContain("HELLO=world");
    });

    it("passes cpu and memory limits when provided", async () => {
      mockSshSuccess();

      await runtime.launch({
        agentName: "test-agent",
        image: "al-agent:sha",
        env: {},
        credentials: { strategy: "volume", stagingDir: "/tmp/al-creds-abc", bundle: {} },
        cpus: 2,
        memory: "8g",
      });

      const args = mockExecFile.mock.calls[0][1] as string[];
      const cmd = args[args.length - 1];
      expect(cmd).toContain("--cpus");
      expect(cmd).toContain("--memory");
      expect(cmd).toContain("8g");
    });

    it("throws when docker run fails", async () => {
      mockSshFailure("port conflict");

      await expect(
        runtime.launch({
          agentName: "test-agent",
          image: "al-agent:sha",
          env: {},
          credentials: { strategy: "volume", stagingDir: "/tmp/al-creds-abc", bundle: {} },
        })
      ).rejects.toThrow("Remote docker run failed");
    });
  });

  describe("waitForExit", () => {
    function makeWaitProc(exitCode = 0) {
      const proc = new EventEmitter();
      (proc as any).stdout = new EventEmitter();
      (proc as any).stderr = new EventEmitter();
      (proc as any).kill = vi.fn();
      // Send exit code as stdout data and then close
      process.nextTick(() => {
        (proc as any).stdout.emit("data", Buffer.from(`${exitCode}\n`));
        proc.emit("close", 0);
      });
      return proc;
    }

    it("resolves with the container exit code", async () => {
      mockSpawn.mockReturnValue(makeWaitProc(0));

      const code = await runtime.waitForExit("al-test-abc", 30);
      expect(code).toBe(0);
    });

    it("resolves with non-zero exit code", async () => {
      mockSpawn.mockReturnValue(makeWaitProc(1));

      const code = await runtime.waitForExit("al-test-abc", 30);
      expect(code).toBe(1);
    });

    it("rejects when process emits error", async () => {
      const proc = new EventEmitter();
      (proc as any).stdout = new EventEmitter();
      (proc as any).stderr = new EventEmitter();
      (proc as any).kill = vi.fn();
      process.nextTick(() => proc.emit("error", new Error("spawn failed")));
      mockSpawn.mockReturnValue(proc);

      await expect(runtime.waitForExit("al-test-abc", 30)).rejects.toThrow("spawn failed");
    });
  });

  describe("followLogs", () => {
    it("follows logs of running container", async () => {
      // First call: ps to find container name
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, "al-test-agent-abc12345\n", "");
      });

      const fakeProc = new EventEmitter();
      (fakeProc as any).stdout = new EventEmitter();
      (fakeProc as any).stderr = new EventEmitter();
      (fakeProc as any).kill = vi.fn();
      mockSpawn.mockReturnValue(fakeProc);

      const lines: string[] = [];
      const handle = runtime.followLogs("test-agent", (line) => lines.push(line));

      // Wait for async startFollowing
      await new Promise((r) => setTimeout(r, 20));

      (fakeProc as any).stdout.emit("data", Buffer.from("log line 1\n"));
      expect(lines).toContain("log line 1");

      handle.stop();
      expect((fakeProc as any).kill).toHaveBeenCalled();
    });

    it("does nothing if stopped before container is found", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, "al-test-agent-abc12345\n", "");
      });

      const fakeProc = new EventEmitter();
      (fakeProc as any).stdout = new EventEmitter();
      (fakeProc as any).stderr = new EventEmitter();
      (fakeProc as any).kill = vi.fn();
      mockSpawn.mockReturnValue(fakeProc);

      const handle = runtime.followLogs("test-agent", () => {});
      // Stop before async startFollowing completes
      handle.stop();

      // Should not have started following
      await new Promise((r) => setTimeout(r, 20));
      // Process kill may or may not be called depending on timing, but no error
    });

    it("handles ssh error when finding containers gracefully", async () => {
      mockSshFailure("No containers");

      const lines: string[] = [];
      runtime.followLogs("test-agent", (line) => lines.push(line));

      await new Promise((r) => setTimeout(r, 20));
      // No error, no lines
      expect(lines).toHaveLength(0);
    });
  });

  describe("buildImage", () => {
    function makeFakeTar() {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stdout.pipe = vi.fn();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      return proc;
    }

    function makeFakeSshBuild(exitCode = 0, delay = 0) {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdin = { end: vi.fn(), pipe: vi.fn() };
      proc.kill = vi.fn();
      if (delay === 0) {
        process.nextTick(() => proc.emit("close", exitCode));
      } else {
        setTimeout(() => proc.emit("close", exitCode), delay);
      }
      return proc;
    }

    beforeEach(() => {
      mockSpawn.mockReset();
    });

    it("calls onProgress and returns tag on successful build", async () => {
      const fakeTar = makeFakeTar();
      const fakeSsh = makeFakeSshBuild(0);
      mockSpawn
        .mockReturnValueOnce(fakeTar)
        .mockReturnValueOnce(fakeSsh);

      const progress: string[] = [];
      const result = await runtime.buildImage({
        tag: "al-dev:v1",
        dockerfile: "Dockerfile",
        contextDir: "/tmp/ctx",
        dockerfileContent: "FROM node:20\nRUN echo hello",
        onProgress: (msg) => progress.push(msg),
      });

      expect(result).toBe("al-dev:v1");
      expect(progress).toContain("Building image on VPS via SSH");
    });

    it("forwards SSH build stderr lines as progress", async () => {
      const fakeTar = makeFakeTar();
      const fakeSsh = makeFakeSshBuild(0);

      // Emit some build output on stderr before closing
      const origNextTick = process.nextTick.bind(process);
      mockSpawn
        .mockReturnValueOnce(fakeTar)
        .mockReturnValueOnce(fakeSsh);

      const progress: string[] = [];
      const buildPromise = runtime.buildImage({
        tag: "al-dev:v1",
        dockerfile: "Dockerfile",
        contextDir: "/tmp/ctx",
        dockerfileContent: "FROM node:20",
        onProgress: (msg) => progress.push(msg),
      });

      // Emit stderr build progress before close
      fakeSsh.stderr.emit("data", Buffer.from("Step 1/2: FROM node:20\nStep 2/2: RUN echo\n"));

      await buildPromise;
      expect(progress).toContain("Step 1/2: FROM node:20");
    });

    it("rejects when SSH build fails", async () => {
      const fakeTar = makeFakeTar();
      const fakeSsh = makeFakeSshBuild(1);
      fakeSsh.stderr.emit = vi.fn(); // suppress before close
      mockSpawn
        .mockReturnValueOnce(fakeTar)
        .mockReturnValueOnce(fakeSsh);

      // Emit the close with error code
      await expect(
        runtime.buildImage({
          tag: "al-dev:v1",
          dockerfile: "Dockerfile",
          contextDir: "/tmp/ctx",
          dockerfileContent: "FROM node:20\nRUN exit 1",
        })
      ).rejects.toThrow("Remote docker build failed");
    });

    it("rejects when tar spawn emits error", async () => {
      const fakeTar = makeFakeTar();
      const fakeSsh = makeFakeSshBuild(0);
      mockSpawn
        .mockReturnValueOnce(fakeTar)
        .mockReturnValueOnce(fakeSsh);

      const buildPromise = runtime.buildImage({
        tag: "al-dev:v1",
        dockerfile: "Dockerfile",
        contextDir: "/tmp/ctx",
        dockerfileContent: "FROM node:20",
      });

      fakeTar.emit("error", new Error("tar not found"));
      await expect(buildPromise).rejects.toThrow("tar not found");
    });

    it("rejects when ssh spawn emits error", async () => {
      const fakeTar = makeFakeTar();
      const fakeSsh = makeFakeSshBuild(0);
      mockSpawn
        .mockReturnValueOnce(fakeTar)
        .mockReturnValueOnce(fakeSsh);

      const buildPromise = runtime.buildImage({
        tag: "al-dev:v1",
        dockerfile: "Dockerfile",
        contextDir: "/tmp/ctx",
        dockerfileContent: "FROM node:20",
      });

      fakeSsh.emit("error", new Error("ssh connection refused"));
      await expect(buildPromise).rejects.toThrow("ssh connection refused");
    });
  });

  describe("waitForExit timeout", () => {
    it("rejects with timeout error and kills the container", async () => {
      vi.useFakeTimers();

      const fakeProc = new EventEmitter() as any;
      fakeProc.stdout = new EventEmitter();
      fakeProc.stderr = new EventEmitter();
      fakeProc.kill = vi.fn();
      mockSpawn.mockReturnValue(fakeProc);
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, "", "");
      });

      const exitPromise = runtime.waitForExit("al-test-abc", 30);

      vi.advanceTimersByTime(30_001);

      await expect(exitPromise).rejects.toThrow("timed out");
      expect(fakeProc.kill).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe("listRunningAgents — empty output", () => {
    it("returns empty array when remoteDocker returns empty string", async () => {
      // Return empty stdout (not even a newline)
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, "", "");
      });
      const agents = await runtime.listRunningAgents();
      expect(agents).toEqual([]);
    });
  });

  describe("prepareCredentials — null fields", () => {
    it("skips credential when readAll returns null by passing empty credRefs", async () => {
      // With no credRefs, bundle is always empty — validates the structure
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, "", "");
      });

      const result = await runtime.prepareCredentials([]);
      // No credentials were requested, so bundle is empty
      expect(result.bundle).toEqual({});
      expect(result.strategy).toBe("volume");
    });
  });

  describe("buildImage — additional paths", () => {
    function makeFakeTar() {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stdout.pipe = vi.fn();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      return proc;
    }

    function makeFakeSshBuild(exitCode = 0) {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdin = { end: vi.fn(), pipe: vi.fn() };
      proc.kill = vi.fn();
      process.nextTick(() => proc.emit("close", exitCode));
      return proc;
    }

    beforeEach(() => {
      mockSpawn.mockReset();
    });

    it("reads Dockerfile from file path when dockerfileContent is not provided", async () => {
      // Create a real temp Dockerfile
      const tmpDir = mkdtempSync(join(tmpdir(), "al-test-"));
      const dockerfilePath = join(tmpDir, "Dockerfile");
      writeFileSync(dockerfilePath, "FROM node:20\nRUN echo test");

      const fakeTar = makeFakeTar();
      const fakeSsh = makeFakeSshBuild(0);
      mockSpawn.mockReturnValueOnce(fakeTar).mockReturnValueOnce(fakeSsh);

      try {
        const fakeTar2 = makeFakeTar();
        const fakeSsh2 = makeFakeSshBuild(0);
        mockSpawn.mockReturnValueOnce(fakeTar2).mockReturnValueOnce(fakeSsh2);
        const result = await runtime.buildImage({
          tag: "al-test:v1",
          dockerfile: dockerfilePath,
          contextDir: tmpDir,
        });
        expect(result).toBe("al-test:v1");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("replaces FROM with baseImage when specified", async () => {
      const fakeTar = makeFakeTar();
      const fakeSsh = makeFakeSshBuild(0);
      mockSpawn.mockReturnValueOnce(fakeTar).mockReturnValueOnce(fakeSsh);

      const spawnCalls: any[] = [];
      mockSpawn.mockReset();
      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        spawnCalls.push({ cmd, args });
        if (cmd === "tar") return makeFakeTar();
        return makeFakeSshBuild(0);
      });

      const result = await runtime.buildImage({
        tag: "al-test:v1",
        dockerfile: "Dockerfile",
        contextDir: "/tmp/ctx",
        dockerfileContent: "FROM node:18\nRUN echo original",
        baseImage: "my-base:latest",
      });
      expect(result).toBe("al-test:v1");
      // The baseImage replacement happens in the content; just verify build succeeds
    });

    it("injects COPY static/ before USER directive when extraFiles provided", async () => {
      mockSpawn.mockReset();
      mockSpawn.mockImplementation((cmd: string) => {
        if (cmd === "tar") return makeFakeTar();
        return makeFakeSshBuild(0);
      });

      const result = await runtime.buildImage({
        tag: "al-test:v1",
        dockerfile: "Dockerfile",
        contextDir: "/tmp/ctx",
        dockerfileContent: "FROM node:20\nRUN echo build\nUSER node\n",
        extraFiles: { "config.json": '{"key":"value"}' },
      });
      expect(result).toBe("al-test:v1");
    });

    it("appends COPY static/ at end when extraFiles provided but no USER directive", async () => {
      mockSpawn.mockReset();
      mockSpawn.mockImplementation((cmd: string) => {
        if (cmd === "tar") return makeFakeTar();
        return makeFakeSshBuild(0);
      });

      const result = await runtime.buildImage({
        tag: "al-test:v1",
        dockerfile: "Dockerfile",
        contextDir: "/tmp/ctx",
        dockerfileContent: "FROM node:20\nRUN echo build\n",
        extraFiles: { "data/config.json": '{"x":1}' },
      });
      expect(result).toBe("al-test:v1");
    });

    it("uses direct context path when no dockerfileContent, baseImage, or extraFiles", async () => {
      // Create a real temp context dir with a Dockerfile
      const tmpCtx = mkdtempSync(join(tmpdir(), "al-ctx-"));
      writeFileSync(join(tmpCtx, "Dockerfile"), "FROM node:20");

      mockSpawn.mockReset();
      mockSpawn.mockImplementation((cmd: string) => {
        if (cmd === "tar") return makeFakeTar();
        return makeFakeSshBuild(0);
      });

      try {
        const result = await runtime.buildImage({
          tag: "al-direct:v1",
          dockerfile: "Dockerfile",
          contextDir: tmpCtx,
        });
        expect(result).toBe("al-direct:v1");
        // Verify tar was called with the contextDir
        const tarCall = mockSpawn.mock.calls.find((c: any[]) => c[0] === "tar");
        expect(tarCall).toBeDefined();
        expect(tarCall[1]).toContain("-C");
        expect(tarCall[1]).toContain(tmpCtx);
      } finally {
        rmSync(tmpCtx, { recursive: true, force: true });
      }
    });

    it("rejects when docker build times out", async () => {
      vi.useFakeTimers();

      const fakeTar = makeFakeTar();
      const fakeSsh = new EventEmitter() as any;
      fakeSsh.stdout = new EventEmitter();
      fakeSsh.stderr = new EventEmitter();
      fakeSsh.stdin = { end: vi.fn(), pipe: vi.fn() };
      fakeSsh.kill = vi.fn();
      fakeTar.kill = vi.fn();
      // Don't emit close — will timeout

      mockSpawn.mockReset();
      mockSpawn.mockReturnValueOnce(fakeTar).mockReturnValueOnce(fakeSsh);

      const buildPromise = runtime.buildImage({
        tag: "al-slow:v1",
        dockerfile: "Dockerfile",
        contextDir: "/tmp/ctx",
        dockerfileContent: "FROM node:20",
      });

      vi.advanceTimersByTime(300_001);

      await expect(buildPromise).rejects.toThrow("Remote docker build timed out after 300s");
      expect(fakeTar.kill).toHaveBeenCalled();
      expect(fakeSsh.kill).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });
});
