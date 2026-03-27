import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

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

  it("implements ContainerRuntime interface", () => {
    const rt: ContainerRuntime = runtime;
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
  });
});
