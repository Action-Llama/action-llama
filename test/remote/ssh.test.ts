import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process.execFile before importing
const mockExecFile = vi.fn();
vi.mock("child_process", () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
}));

import { buildSshArgs, sshExec, rsyncTo, sshOptionsFromConfig } from "../../src/remote/ssh.js";

describe("sshOptionsFromConfig", () => {
  it("applies defaults", () => {
    const opts = sshOptionsFromConfig({ host: "example.com" });
    expect(opts).toEqual({
      host: "example.com",
      user: "root",
      port: 22,
      keyPath: undefined,
    });
  });

  it("uses provided values", () => {
    const opts = sshOptionsFromConfig({
      host: "example.com",
      user: "deploy",
      port: 2222,
      keyPath: "/tmp/key",
    });
    expect(opts.user).toBe("deploy");
    expect(opts.port).toBe(2222);
    expect(opts.keyPath).toBe("/tmp/key");
  });
});

describe("buildSshArgs", () => {
  it("builds basic args without keyPath", () => {
    const args = buildSshArgs({ host: "example.com", user: "root", port: 22 });
    expect(args).toEqual([
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "BatchMode=yes",
      "-p", "22",
      "root@example.com",
    ]);
  });

  it("includes -i when keyPath is set", () => {
    const args = buildSshArgs({ host: "example.com", user: "deploy", port: 2222, keyPath: "/tmp/key" });
    expect(args).toContain("-i");
    expect(args).toContain("/tmp/key");
    expect(args).toContain("-p");
    expect(args).toContain("2222");
    expect(args[args.length - 1]).toBe("deploy@example.com");
  });

  it("includes ControlMaster options when controlPath is set", () => {
    const args = buildSshArgs({ host: "example.com", user: "root", port: 22, controlPath: "/tmp/al-ssh-abc-123" });
    expect(args).toContain("ControlMaster=auto");
    expect(args).toContain("ControlPath=/tmp/al-ssh-abc-123");
    expect(args).toContain("ControlPersist=30");
    expect(args[args.length - 1]).toBe("root@example.com");
  });

  it("omits ControlMaster options when controlPath is not set", () => {
    const args = buildSshArgs({ host: "example.com", user: "root", port: 22 });
    expect(args.join(" ")).not.toContain("ControlMaster");
  });
});

describe("sshExec", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls execFile with ssh and returns stdout", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
      // promisify expects (err, {stdout, stderr})
      if (typeof _opts === "function") {
        _opts(null, { stdout: "output\n", stderr: "" });
      } else {
        cb(null, { stdout: "output\n", stderr: "" });
      }
    });

    const result = await sshExec({ host: "h", user: "u", port: 22 }, "echo hello");
    expect(mockExecFile).toHaveBeenCalled();
    const callArgs = mockExecFile.mock.calls[0];
    expect(callArgs[0]).toBe("ssh");
    expect(callArgs[1]).toContain("u@h");
    expect(callArgs[1]).toContain("echo hello");
    expect(result).toBe("output\n");
  });

  it("rejects on error", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
      const err = new Error("Connection refused");
      if (typeof _opts === "function") {
        _opts(err);
      } else {
        cb(err);
      }
    });

    await expect(sshExec({ host: "h", user: "u", port: 22 }, "fail")).rejects.toThrow("Connection refused");
  });
});

describe("rsyncTo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls execFile with rsync and correct args", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
      if (typeof _opts === "function") {
        _opts(null, { stdout: "", stderr: "" });
      } else {
        cb(null, { stdout: "", stderr: "" });
      }
    });

    await rsyncTo(
      { host: "h", user: "u", port: 22 },
      "/local/path",
      "/remote/path",
      ["node_modules", ".git"],
    );

    expect(mockExecFile).toHaveBeenCalled();
    const callArgs = mockExecFile.mock.calls[0];
    expect(callArgs[0]).toBe("rsync");
    const rsyncArgs: string[] = callArgs[1];
    expect(rsyncArgs).toContain("--exclude");
    expect(rsyncArgs).toContain("node_modules");
    expect(rsyncArgs).toContain(".git");
    expect(rsyncArgs[rsyncArgs.length - 1]).toBe("u@h:/remote/path");
    // localPath should end with /
    expect(rsyncArgs[rsyncArgs.length - 2]).toBe("/local/path/");
  });

  it("includes ControlMaster in rsync ssh command when controlPath is set", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
      if (typeof _opts === "function") {
        _opts(null, { stdout: "", stderr: "" });
      } else {
        cb(null, { stdout: "", stderr: "" });
      }
    });

    await rsyncTo(
      { host: "h", user: "u", port: 22, controlPath: "/tmp/al-ssh-abc-123" },
      "/local/path",
      "/remote/path",
    );

    const rsyncArgs: string[] = mockExecFile.mock.calls[0][1];
    const sshFlag = rsyncArgs[rsyncArgs.indexOf("-e") + 1];
    expect(sshFlag).toContain("ControlMaster=auto");
    expect(sshFlag).toContain("ControlPath=/tmp/al-ssh-abc-123");
    expect(sshFlag).toContain("ControlPersist=30");
  });

  it("passes extra flags like --dry-run", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
      if (typeof _opts === "function") {
        _opts(null, { stdout: "", stderr: "" });
      } else {
        cb(null, { stdout: "", stderr: "" });
      }
    });

    await rsyncTo(
      { host: "h", user: "u", port: 22 },
      "/local/",
      "/remote",
      undefined,
      ["--dry-run", "-v"],
    );

    const rsyncArgs: string[] = mockExecFile.mock.calls[0][1];
    expect(rsyncArgs).toContain("--dry-run");
    expect(rsyncArgs).toContain("-v");
  });
});
