import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// Mock child_process
const { mockExecFile, mockExecFileSync, mockSpawn } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockExecFileSync: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, execFile: mockExecFile, execFileSync: mockExecFileSync, spawn: mockSpawn };
});

const { sshExec, sshSpawn, scp, scpBuffer, testConnection, clearKnownHost } = await import("../../../src/cloud/vps/ssh.js");
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
    mockExecFileSync.mockReset();
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

  describe("clearKnownHost", () => {
    it("calls ssh-keygen -R with the host", () => {
      clearKnownHost("1.2.3.4");
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "ssh-keygen",
        ["-R", "1.2.3.4"],
        { stdio: "ignore" },
      );
    });

    it("does not throw when ssh-keygen fails", () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error("No such entry");
      });
      expect(() => clearKnownHost("1.2.3.4")).not.toThrow();
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

  // ── scp ──────────────────────────────────────────────────────────────────

  describe("scp", () => {
    it("copies file via scp successfully", async () => {
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
        // Check that scp is called with the local and remote paths
        expect(args[args.length - 2]).toBe("/local/path/file.txt");
        expect(args[args.length - 1]).toBe("root@1.2.3.4:/remote/path/file.txt");
        cb(null);
      });

      await expect(scp(testConfig, "/local/path/file.txt", "/remote/path/file.txt")).resolves.toBeUndefined();
    });

    it("includes SSH options in scp args", async () => {
      let capturedArgs: string[] = [];
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
        capturedArgs = args;
        cb(null);
      });

      await scp(testConfig, "/local/file", "/remote/file");

      expect(capturedArgs).toContain("-p");
      expect(capturedArgs).toContain("22");
      expect(capturedArgs).toContain("-i");
      expect(capturedArgs).toContain("/home/test/.ssh/id_rsa");
    });

    it("rejects when scp fails with an error", async () => {
      const scpError = new Error("Permission denied (publickey).");
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(scpError);
      });

      await expect(scp(testConfig, "/local/file", "/remote/file")).rejects.toThrow("Permission denied");
    });
  });

  // ── scpBuffer stderr data ─────────────────────────────────────────────────

  describe("scpBuffer stderr capture", () => {
    it("includes stderr output in rejection message", async () => {
      const fakeProc = new EventEmitter();
      (fakeProc as any).stdin = { end: vi.fn() };
      (fakeProc as any).stdout = new EventEmitter();
      (fakeProc as any).stderr = new EventEmitter();
      mockSpawn.mockReturnValue(fakeProc);

      const promise = scpBuffer(testConfig, "data", "/tmp/file");

      // Emit stderr data before close
      (fakeProc as any).stderr.emit("data", Buffer.from("ssh: connect to host failed\n"));
      (fakeProc as any).stderr.emit("data", Buffer.from("Permission denied.\n"));

      fakeProc.emit("close", 255);

      await expect(promise).rejects.toThrow("ssh: connect to host failed");
    });

    it("resolves when exit code is 0 after stderr output", async () => {
      const fakeProc = new EventEmitter();
      (fakeProc as any).stdin = { end: vi.fn() };
      (fakeProc as any).stdout = new EventEmitter();
      (fakeProc as any).stderr = new EventEmitter();
      mockSpawn.mockReturnValue(fakeProc);

      const promise = scpBuffer(testConfig, "data", "/tmp/file");

      // Stderr data (warnings) but still exit code 0
      (fakeProc as any).stderr.emit("data", Buffer.from("Warning: Permanently added host.\n"));
      fakeProc.emit("close", 0);

      await expect(promise).resolves.toBeUndefined();
    });

    it("rejects on process error event", async () => {
      const fakeProc = new EventEmitter();
      (fakeProc as any).stdin = { end: vi.fn() };
      (fakeProc as any).stdout = new EventEmitter();
      (fakeProc as any).stderr = new EventEmitter();
      mockSpawn.mockReturnValue(fakeProc);

      const promise = scpBuffer(testConfig, "data", "/tmp/file");

      fakeProc.emit("error", new Error("spawn failed"));

      await expect(promise).rejects.toThrow("spawn failed");
    });
  });
});
