import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// Mock child_process for SSH operations
const { mockExecFile, mockSpawn } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, execFile: mockExecFile, spawn: mockSpawn };
});

const { SshFilesystemBackend } = await import("../../src/shared/ssh-fs-backend.js");
type SshConfig = import("../../src/cloud/vps/ssh.js").SshConfig;

const testSshConfig: SshConfig = {
  host: "1.2.3.4",
  user: "root",
  port: 22,
  keyPath: "/home/test/.ssh/id_rsa",
};

describe("SshFilesystemBackend", () => {
  let backend: InstanceType<typeof SshFilesystemBackend>;

  beforeEach(() => {
    mockExecFile.mockReset();
    mockSpawn.mockReset();
    backend = new SshFilesystemBackend(testSshConfig);
  });

  describe("read", () => {
    it("returns value from remote file", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, "secret-value\n", "");
      });

      const value = await backend.read("github_token", "default", "token");
      expect(value).toBe("secret-value");
    });

    it("returns undefined when file not found", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        const err: any = new Error("not found");
        err.code = 1;
        cb(err, "", "No such file");
      });

      const value = await backend.read("github_token", "default", "token");
      expect(value).toBeUndefined();
    });
  });

  describe("write", () => {
    it("writes value via scpBuffer", async () => {
      const fakeProc = new EventEmitter();
      const stdinEnd = vi.fn();
      (fakeProc as any).stdin = { end: stdinEnd };
      (fakeProc as any).stdout = new EventEmitter();
      (fakeProc as any).stderr = new EventEmitter();
      mockSpawn.mockReturnValue(fakeProc);

      const promise = backend.write("github_token", "default", "token", "my-secret");

      fakeProc.emit("close", 0);
      await promise;

      expect(stdinEnd).toHaveBeenCalledWith("my-secret\n");
    });
  });

  describe("exists", () => {
    it("returns true when directory exists and has files", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, "token\n", "");
      });

      const exists = await backend.exists("github_token", "default");
      expect(exists).toBe(true);
    });

    it("returns false when directory does not exist", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        const err: any = new Error("not found");
        err.code = 1;
        cb(err, "", "");
      });

      const exists = await backend.exists("github_token", "default");
      expect(exists).toBe(false);
    });
  });

  describe("list", () => {
    it("parses find output into credential entries", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(
          null,
          "~/.action-llama/credentials/github_token/default/token\n" +
          "~/.action-llama/credentials/anthropic_key/default/token\n",
          "",
        );
      });

      const entries = await backend.list();
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({ type: "github_token", instance: "default", field: "token" });
      expect(entries[1]).toEqual({ type: "anthropic_key", instance: "default", field: "token" });
    });

    it("returns empty array when no credentials exist", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        const err: any = new Error("not found");
        err.code = 1;
        cb(err, "", "");
      });

      const entries = await backend.list();
      expect(entries).toEqual([]);
    });
  });

  describe("readAll", () => {
    it("reads all fields for an instance", async () => {
      let callCount = 0;
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        callCount++;
        if (callCount === 1) {
          cb(null, "token\nclient_id\n", "");
        } else if (callCount === 2) {
          cb(null, "ghp_abc123\n", "");
        } else {
          cb(null, "my-client\n", "");
        }
      });

      const fields = await backend.readAll("github_token", "default");
      expect(fields).toEqual({ token: "ghp_abc123", client_id: "my-client" });
    });

    it("returns undefined when instance does not exist", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        const err: any = new Error("not found");
        err.code = 1;
        cb(err, "", "");
      });

      const fields = await backend.readAll("github_token", "missing");
      expect(fields).toBeUndefined();
    });
  });

  describe("writeAll", () => {
    it("writes each field via write", async () => {
      const fakeProc1 = new EventEmitter();
      const stdinEnd1 = vi.fn();
      (fakeProc1 as any).stdin = { end: stdinEnd1 };
      (fakeProc1 as any).stdout = new EventEmitter();
      (fakeProc1 as any).stderr = new EventEmitter();

      const fakeProc2 = new EventEmitter();
      const stdinEnd2 = vi.fn();
      (fakeProc2 as any).stdin = { end: stdinEnd2 };
      (fakeProc2 as any).stdout = new EventEmitter();
      (fakeProc2 as any).stderr = new EventEmitter();

      mockSpawn
        .mockReturnValueOnce(fakeProc1)
        .mockReturnValueOnce(fakeProc2);

      const promise = backend.writeAll("github_token", "default", { token: "ghp_abc", client_id: "cid" });

      fakeProc1.emit("close", 0);
      await new Promise((r) => setImmediate(r));
      fakeProc2.emit("close", 0);
      await promise;

      expect(stdinEnd1).toHaveBeenCalledWith("ghp_abc\n");
      expect(stdinEnd2).toHaveBeenCalledWith("cid\n");
    });

    it("writes a single field correctly", async () => {
      const fakeProc = new EventEmitter();
      const stdinEnd = vi.fn();
      (fakeProc as any).stdin = { end: stdinEnd };
      (fakeProc as any).stdout = new EventEmitter();
      (fakeProc as any).stderr = new EventEmitter();
      mockSpawn.mockReturnValue(fakeProc);

      const promise = backend.writeAll("anthropic_key", "default", { api_key: "sk-ant-123" });
      fakeProc.emit("close", 0);
      await promise;

      expect(stdinEnd).toHaveBeenCalledWith("sk-ant-123\n");
    });
  });

  describe("listInstances", () => {
    it("returns instance names for a credential type", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, "default\nwork\n", "");
      });

      const instances = await backend.listInstances("github_token");
      expect(instances).toEqual(["default", "work"]);
    });

    it("returns empty array when no instances exist", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        const err: any = new Error("no such directory");
        err.code = 1;
        cb(err, "", "");
      });

      const instances = await backend.listInstances("nonexistent_type");
      expect(instances).toEqual([]);
    });

    it("returns empty array when stdout is empty", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, "", "");
      });

      const instances = await backend.listInstances("github_token");
      expect(instances).toEqual([]);
    });
  });
});
