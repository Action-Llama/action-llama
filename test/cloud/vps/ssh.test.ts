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

const { sshExec, sshSpawn, scpBuffer, testConnection } = await import("../../../src/cloud/vps/ssh.js");
type SshConfig = import("../../../src/cloud/vps/ssh.js").SshConfig;

const testConfig: SshConfig = {
  host: "1.2.3.4",
  user: "root",
  port: 22,
  keyPath: "/home/test/.ssh/id_rsa",
};

describe("ssh helpers", () => {
  beforeEach(() => {
    mockExecFile.mockReset();
    mockSpawn.mockReset();
  });

  describe("sshExec", () => {
    it("runs ssh command with correct args", async () => {
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
        expect(args).toContain("-o");
        expect(args).toContain("StrictHostKeyChecking=accept-new");
        expect(args).toContain("BatchMode=yes");
        expect(args).toContain("ConnectTimeout=10");
        expect(args).toContain("-p");
        expect(args).toContain("22");
        expect(args).toContain("-i");
        expect(args).toContain("/home/test/.ssh/id_rsa");
        expect(args).toContain("root@1.2.3.4");
        expect(args[args.length - 1]).toBe("echo hello");
        cb(null, "hello\n", "");
      });

      const result = await sshExec(testConfig, "echo hello");
      expect(result.stdout).toBe("hello");
      expect(result.exitCode).toBe(0);
    });

    it("returns non-zero exit code on failure", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        const err: any = new Error("Command failed");
        err.code = 1;
        cb(err, "", "error output");
      });

      const result = await sshExec(testConfig, "false");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("sshSpawn", () => {
    it("spawns SSH process with correct destination", () => {
      const fakeProc = new EventEmitter();
      (fakeProc as any).stdio = ["pipe", "pipe", "pipe"];
      mockSpawn.mockReturnValue(fakeProc);

      sshSpawn(testConfig, "docker logs -f container");
      expect(mockSpawn).toHaveBeenCalledWith(
        "ssh",
        expect.arrayContaining(["root@1.2.3.4", "docker logs -f container"]),
        expect.any(Object),
      );
    });
  });

  describe("scpBuffer", () => {
    it("writes data via SSH stdin pipe", async () => {
      const fakeProc = new EventEmitter();
      const stdinEnd = vi.fn();
      (fakeProc as any).stdin = { end: stdinEnd };
      (fakeProc as any).stdout = new EventEmitter();
      (fakeProc as any).stderr = new EventEmitter();
      mockSpawn.mockReturnValue(fakeProc);

      const promise = scpBuffer(testConfig, "secret-value", "/tmp/creds/token");

      fakeProc.emit("close", 0);
      await promise;

      expect(stdinEnd).toHaveBeenCalledWith("secret-value");
    });

    it("rejects on non-zero exit", async () => {
      const fakeProc = new EventEmitter();
      (fakeProc as any).stdin = { end: vi.fn() };
      (fakeProc as any).stdout = new EventEmitter();
      (fakeProc as any).stderr = new EventEmitter();
      mockSpawn.mockReturnValue(fakeProc);

      const promise = scpBuffer(testConfig, "data", "/tmp/file");
      fakeProc.emit("close", 1);

      await expect(promise).rejects.toThrow("scpBuffer failed");
    });
  });

  describe("testConnection", () => {
    it("returns true on successful echo", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, "ok\n", "");
      });

      const result = await testConnection(testConfig);
      expect(result).toBe(true);
    });

    it("returns false on connection failure", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(new Error("Connection refused"), "", "");
      });

      const result = await testConnection(testConfig);
      expect(result).toBe(false);
    });
  });
});
