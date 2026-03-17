import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process for SSH
const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, execFile: mockExecFile };
});

// Mock inquirer prompts
const { mockSelect, mockInput, mockConfirm } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInput: vi.fn(),
  mockConfirm: vi.fn(),
}));

vi.mock("@inquirer/prompts", () => ({
  select: (...args: any[]) => mockSelect(...args),
  input: (...args: any[]) => mockInput(...args),
  confirm: (...args: any[]) => mockConfirm(...args),
}));

// Mock filesystem backend
vi.mock("../../src/shared/filesystem-backend.js", () => ({
  FilesystemBackend: class {
    read = vi.fn().mockResolvedValue("fake-vultr-key");
  },
}));

const { setupVpsCloud } = await import("../../../src/cloud/vps/provision.js");

describe("VPS provisioning", () => {
  beforeEach(() => {
    mockExecFile.mockReset();
    mockSelect.mockReset();
    mockInput.mockReset();
    mockConfirm.mockReset();
  });

  describe("existing server path", () => {
    it("returns config on successful SSH + Docker check", async () => {
      mockSelect.mockResolvedValueOnce("existing");

      mockInput
        .mockResolvedValueOnce("5.6.7.8")
        .mockResolvedValueOnce("root")
        .mockResolvedValueOnce("22")
        .mockResolvedValueOnce("~/.ssh/id_rsa");

      let callIdx = 0;
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
        callIdx++;
        if (callIdx === 1) {
          cb(null, "ok\n", "");
        } else {
          cb(null, "24.0.7\n", "");
        }
      });

      const result = await setupVpsCloud();
      expect(result).toEqual({
        provider: "vps",
        host: "5.6.7.8",
      });
    });

    it("returns null when SSH connection fails", async () => {
      mockSelect.mockResolvedValueOnce("existing");
      mockInput
        .mockResolvedValueOnce("5.6.7.8")
        .mockResolvedValueOnce("root")
        .mockResolvedValueOnce("22")
        .mockResolvedValueOnce("~/.ssh/id_rsa");

      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(new Error("Connection refused"), "", "");
      });

      const result = await setupVpsCloud();
      expect(result).toBeNull();
    });

    it("returns null when Docker not available", async () => {
      mockSelect.mockResolvedValueOnce("existing");
      mockInput
        .mockResolvedValueOnce("5.6.7.8")
        .mockResolvedValueOnce("root")
        .mockResolvedValueOnce("22")
        .mockResolvedValueOnce("~/.ssh/id_rsa");

      let callIdx = 0;
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        callIdx++;
        if (callIdx === 1) {
          cb(null, "ok\n", "");
        } else {
          const err: any = new Error("docker not found");
          err.code = 127;
          cb(err, "", "command not found: docker");
        }
      });

      const result = await setupVpsCloud();
      expect(result).toBeNull();
    });

    it("includes non-default SSH settings in config", async () => {
      mockSelect.mockResolvedValueOnce("existing");
      mockInput
        .mockResolvedValueOnce("5.6.7.8")
        .mockResolvedValueOnce("ubuntu")
        .mockResolvedValueOnce("2222")
        .mockResolvedValueOnce("~/.ssh/mykey");

      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, "ok\n24.0.7\n", "");
      });

      const result = await setupVpsCloud();
      expect(result).toEqual({
        provider: "vps",
        host: "5.6.7.8",
        sshUser: "ubuntu",
        sshPort: 2222,
        sshKeyPath: "~/.ssh/mykey",
      });
    });
  });
});
