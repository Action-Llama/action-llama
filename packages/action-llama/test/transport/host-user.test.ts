import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// ── Mocks ──────────────────────────────────────────────────────

function createMockShell() {
  const stdin = { write: vi.fn(), end: vi.fn() };
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const proc = new EventEmitter() as EventEmitter & {
    stdin: typeof stdin;
    stdout: typeof stdout;
    stderr: typeof stderr;
    pid: number;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdin = stdin;
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.pid = 12345;
  proc.kill = vi.fn();
  return proc;
}

let mockShell: ReturnType<typeof createMockShell>;

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    spawn: vi.fn(() => mockShell),
  };
});

const mockReadFileSync = vi.fn(() => Buffer.from("file content"));
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockChownSync = vi.fn();
const mockStatSync = vi.fn(() => ({ uid: 0, gid: 0 }));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    readFileSync: (...args: any[]) => mockReadFileSync(...args),
    writeFileSync: (...args: any[]) => mockWriteFileSync(...args),
    mkdirSync: (...args: any[]) => mockMkdirSync(...args),
    chownSync: (...args: any[]) => mockChownSync(...args),
    statSync: (...args: any[]) => mockStatSync(...args),
  };
});

// Import after mocks
const { HostUserTransport } = await import("../../src/transport/host-user.js");

// ── Helpers ────────────────────────────────────────────────────

function autoRespondToDelimiter(
  shell: ReturnType<typeof createMockShell>,
  response = "",
  exitCode = 0,
) {
  shell.stdin.write.mockImplementation((data: string) => {
    const match = data.match(/echo "(__AL_DELIM_[a-f0-9]+__) \$\?"/);
    if (match) {
      const delim = match[1];
      process.nextTick(() => {
        shell.stdout.emit("data", Buffer.from(`${response}${delim} ${exitCode}\n`));
      });
    }
  });
}

/** Auto-respond to delimiter probes, providing uid/gid responses for id commands. */
function autoRespondWithId(shell: ReturnType<typeof createMockShell>, uid = 1000, gid = 1000) {
  let idCalls = 0;
  shell.stdin.write.mockImplementation((data: string) => {
    const match = data.match(/echo "(__AL_DELIM_[a-f0-9]+__) \$\?"/);
    if (match) {
      const delim = match[1];
      // After the connect probe, the next two probes are id -u and id -g
      let response = "";
      if (data.includes("id -u") || (idCalls === 1)) {
        response = `${uid}\n`;
        idCalls++;
      } else if (data.includes("id -g") || (idCalls === 2)) {
        response = `${gid}\n`;
        idCalls++;
      }
      process.nextTick(() => {
        shell.stdout.emit("data", Buffer.from(`${response}${delim} 0\n`));
      });
    }
  });
}

// ── Tests ──────────────────────────────────────────────────────

describe("HostUserTransport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShell = createMockShell();
  });

  describe("connect()", () => {
    it("spawns sudo -u with correct arguments", async () => {
      autoRespondWithId(mockShell);
      const { spawn } = await import("child_process");
      const transport = new HostUserTransport({ user: "al-agent" });
      await transport.connect();

      expect(spawn).toHaveBeenCalledWith(
        "sudo",
        ["-u", "al-agent", "--", "bash", "--norc", "--noprofile"],
        expect.any(Object),
      );
    });

    it("resolves uid/gid after connecting", async () => {
      autoRespondWithId(mockShell, 1001, 1001);
      const transport = new HostUserTransport({ user: "al-agent" });
      await transport.connect();

      // Verify id commands were sent
      const writes = mockShell.stdin.write.mock.calls.map((c: any) => c[0] as string);
      expect(writes.some((w: string) => w.includes("id -u"))).toBe(true);
      expect(writes.some((w: string) => w.includes("id -g"))).toBe(true);
    });

    it("sets initial cwd when specified", async () => {
      autoRespondWithId(mockShell);
      const transport = new HostUserTransport({ user: "al-agent", cwd: "/home/al-agent" });
      await transport.connect();

      const writes = mockShell.stdin.write.mock.calls.map((c: any) => c[0] as string);
      expect(writes.some((w: string) => w.includes("cd '/home/al-agent'"))).toBe(true);
    });
  });

  describe("exec()", () => {
    it("sends command and captures output", async () => {
      autoRespondWithId(mockShell);
      const transport = new HostUserTransport({ user: "al-agent" });
      await transport.connect();

      mockShell.stdin.write.mockImplementation((data: string) => {
        const match = data.match(/echo "(__AL_DELIM_[a-f0-9]+__) \$\?"/);
        if (match) {
          process.nextTick(() => {
            mockShell.stdout.emit("data", Buffer.from(`hello world\n${match[1]} 0\n`));
          });
        }
      });

      const result = await transport.exec("echo hello world");
      expect(result.stdout).toBe("hello world");
      expect(result.exitCode).toBe(0);
    });

    it("returns aborted result when signal is already aborted", async () => {
      autoRespondWithId(mockShell);
      const transport = new HostUserTransport({ user: "al-agent" });
      await transport.connect();

      const controller = new AbortController();
      controller.abort();

      const result = await transport.exec("echo test", { signal: controller.signal });
      expect(result.exitCode).toBe(130);
      expect(result.stderr).toBe("Aborted");
    });

    it("throws when not connected", async () => {
      const transport = new HostUserTransport({ user: "al-agent" });
      await expect(transport.exec("echo test")).rejects.toThrow("Transport not connected");
    });
  });

  describe("readFiles()", () => {
    it("returns empty map for empty paths", async () => {
      autoRespondWithId(mockShell);
      const transport = new HostUserTransport({ user: "al-agent" });
      await transport.connect();

      const result = await transport.readFiles([]);
      expect(result.size).toBe(0);
    });

    it("reads files directly from the filesystem", async () => {
      autoRespondWithId(mockShell);
      const transport = new HostUserTransport({ user: "al-agent" });
      await transport.connect();

      mockReadFileSync.mockReturnValue(Buffer.from("hello world"));

      const result = await transport.readFiles(["/tmp/test.txt"]);
      expect(result.has("/tmp/test.txt")).toBe(true);
      expect(result.get("/tmp/test.txt")!.toString()).toBe("hello world");
      expect(mockReadFileSync).toHaveBeenCalledWith("/tmp/test.txt");
    });

    it("omits missing files", async () => {
      autoRespondWithId(mockShell);
      const transport = new HostUserTransport({ user: "al-agent" });
      await transport.connect();

      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      const result = await transport.readFiles(["/nonexistent"]);
      expect(result.size).toBe(0);
    });
  });

  describe("writeFiles()", () => {
    it("does nothing for empty map", async () => {
      autoRespondWithId(mockShell);
      const transport = new HostUserTransport({ user: "al-agent" });
      await transport.connect();

      await transport.writeFiles(new Map());
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it("creates parent directories and writes files", async () => {
      autoRespondWithId(mockShell, 1001, 1001);
      const transport = new HostUserTransport({ user: "al-agent" });
      await transport.connect();

      const files = new Map<string, Buffer>();
      files.set("/workspace/test.txt", Buffer.from("hello"));
      await transport.writeFiles(files);

      expect(mockMkdirSync).toHaveBeenCalledWith("/workspace", { recursive: true });
      expect(mockWriteFileSync).toHaveBeenCalledWith("/workspace/test.txt", Buffer.from("hello"));
      // Should chown the file to the target user
      expect(mockChownSync).toHaveBeenCalledWith("/workspace/test.txt", 1001, 1001);
    });
  });

  describe("close()", () => {
    it("sends exit command and kills the process", async () => {
      autoRespondWithId(mockShell);
      const transport = new HostUserTransport({ user: "al-agent" });
      await transport.connect();
      await transport.close();

      expect(mockShell.stdin.write).toHaveBeenCalledWith("exit\n");
      expect(mockShell.stdin.end).toHaveBeenCalled();
      expect(mockShell.kill).toHaveBeenCalled();
    });

    it("does nothing if already closed", async () => {
      const transport = new HostUserTransport({ user: "al-agent" });
      await transport.close(); // Should not throw
    });
  });
});
