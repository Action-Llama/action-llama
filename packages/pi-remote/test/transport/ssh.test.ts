import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// ── Mocks ──────────────────────────────────────────────────────

/** Create a mock ChildProcess that simulates an SSH shell session. */
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

// Import after mocks
const { SshTransport } = await import("../../src/transport/ssh.js");

// ── Helpers ────────────────────────────────────────────────────

/**
 * Simulate shell output: intercept stdin.write calls and respond with
 * the delimiter + exit code on stdout.
 */
function autoRespondToDelimiter(shell: ReturnType<typeof createMockShell>, response = "", exitCode = 0) {
  shell.stdin.write.mockImplementation((data: string) => {
    // Look for delimiter probe: echo "__AL_DELIM_xxx__ $?"
    const match = data.match(/echo "(__AL_DELIM_[a-f0-9]+__) \$\?"/);
    if (match) {
      const delim = match[1];
      // Emit response followed by the delimiter line
      process.nextTick(() => {
        shell.stdout.emit("data", Buffer.from(`${response}${delim} ${exitCode}\n`));
      });
    }
  });
}

// ── Tests ──────────────────────────────────────────────────────

describe("SshTransport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShell = createMockShell();
  });

  describe("connect()", () => {
    it("spawns ssh with correct arguments", async () => {
      autoRespondToDelimiter(mockShell);
      const { spawn } = await import("child_process");
      const transport = new SshTransport({ host: "10.0.0.1", user: "deploy", port: 2222, keyPath: "/keys/id_rsa" });
      await transport.connect();

      expect(spawn).toHaveBeenCalledWith(
        "ssh",
        expect.arrayContaining([
          "-tt", "-p", "2222", "-i", "/keys/id_rsa",
          "deploy@10.0.0.1", "sh",
        ]),
        expect.any(Object),
      );
    });

    it("spawns ssh without user prefix when user is not set", async () => {
      autoRespondToDelimiter(mockShell);
      const { spawn } = await import("child_process");
      const transport = new SshTransport({ host: "10.0.0.1" });
      await transport.connect();

      expect(spawn).toHaveBeenCalledWith(
        "ssh",
        expect.arrayContaining(["10.0.0.1"]),
        expect.any(Object),
      );
    });

    it("applies custom SSH options", async () => {
      autoRespondToDelimiter(mockShell);
      const { spawn } = await import("child_process");
      const transport = new SshTransport({
        host: "10.0.0.1",
        sshOptions: { StrictHostKeyChecking: "no" },
      });
      await transport.connect();

      expect(spawn).toHaveBeenCalledWith(
        "ssh",
        expect.arrayContaining(["-o", "StrictHostKeyChecking=no"]),
        expect.any(Object),
      );
    });

    it("sets initial cwd when specified", async () => {
      const writes: string[] = [];
      mockShell.stdin.write.mockImplementation((data: string) => {
        writes.push(data);
        const match = data.match(/echo "(__AL_DELIM_[a-f0-9]+__) \$\?"/);
        if (match) {
          process.nextTick(() => {
            mockShell.stdout.emit("data", Buffer.from(`${match[1]} 0\n`));
          });
        }
      });

      const transport = new SshTransport({ host: "10.0.0.1", cwd: "/workspace" });
      await transport.connect();

      expect(writes.some((w) => w.includes("cd '/workspace'"))).toBe(true);
    });

    it("throws on timeout if shell doesn't respond", async () => {
      // Don't auto-respond — let it timeout with a short connectTimeoutMs
      const transport = new SshTransport({ host: "10.0.0.1", connectTimeoutMs: 50 });
      await expect(transport.connect()).rejects.toThrow("Timed out");
    });
  });

  describe("exec()", () => {
    it("sends command and captures stdout", async () => {
      autoRespondToDelimiter(mockShell);
      const transport = new SshTransport({ host: "10.0.0.1" });
      await transport.connect();

      // Override for a specific response
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

    it("captures non-zero exit code", async () => {
      autoRespondToDelimiter(mockShell);
      const transport = new SshTransport({ host: "10.0.0.1" });
      await transport.connect();

      mockShell.stdin.write.mockImplementation((data: string) => {
        const match = data.match(/echo "(__AL_DELIM_[a-f0-9]+__) \$\?"/);
        if (match) {
          process.nextTick(() => {
            mockShell.stdout.emit("data", Buffer.from(`${match[1]} 1\n`));
          });
        }
      });

      const result = await transport.exec("false");
      expect(result.exitCode).toBe(1);
    });

    it("returns aborted result when signal is already aborted", async () => {
      autoRespondToDelimiter(mockShell);
      const transport = new SshTransport({ host: "10.0.0.1" });
      await transport.connect();

      const controller = new AbortController();
      controller.abort();

      const result = await transport.exec("echo test", { signal: controller.signal });
      expect(result.exitCode).toBe(130);
      expect(result.stderr).toBe("Aborted");
    });

    it("throws when not connected", async () => {
      const transport = new SshTransport({ host: "10.0.0.1" });
      await expect(transport.exec("echo test")).rejects.toThrow("Transport not connected");
    });
  });

  describe("readFiles()", () => {
    it("returns empty map for empty paths", async () => {
      autoRespondToDelimiter(mockShell);
      const transport = new SshTransport({ host: "10.0.0.1" });
      await transport.connect();

      const result = await transport.readFiles([]);
      expect(result.size).toBe(0);
    });

    it("reads file via base64 encoding over the shell", async () => {
      autoRespondToDelimiter(mockShell);
      const transport = new SshTransport({ host: "10.0.0.1" });
      await transport.connect();

      const expectedContent = "hello world";
      const b64 = Buffer.from(expectedContent).toString("base64");

      mockShell.stdin.write.mockImplementation((data: string) => {
        const match = data.match(/echo "(__AL_DELIM_[a-f0-9]+__) \$\?"/);
        if (match) {
          process.nextTick(() => {
            mockShell.stdout.emit("data", Buffer.from(`${b64}\n${match[1]} 0\n`));
          });
        }
      });

      const result = await transport.readFiles(["/tmp/test.txt"]);
      expect(result.has("/tmp/test.txt")).toBe(true);
      expect(result.get("/tmp/test.txt")!.toString()).toBe(expectedContent);
    });

    it("omits missing files", async () => {
      autoRespondToDelimiter(mockShell);
      const transport = new SshTransport({ host: "10.0.0.1" });
      await transport.connect();

      mockShell.stdin.write.mockImplementation((data: string) => {
        const match = data.match(/echo "(__AL_DELIM_[a-f0-9]+__) \$\?"/);
        if (match) {
          process.nextTick(() => {
            mockShell.stdout.emit("data", Buffer.from(`__AL_FILE_MISSING__\n${match[1]} 0\n`));
          });
        }
      });

      const result = await transport.readFiles(["/nonexistent"]);
      expect(result.size).toBe(0);
    });
  });

  describe("writeFiles()", () => {
    it("does nothing for empty map", async () => {
      autoRespondToDelimiter(mockShell);
      const transport = new SshTransport({ host: "10.0.0.1" });
      await transport.connect();

      await transport.writeFiles(new Map());
      // No additional writes beyond the connect probe
    });

    it("creates parent directories and writes files via base64", async () => {
      autoRespondToDelimiter(mockShell);
      const transport = new SshTransport({ host: "10.0.0.1" });
      await transport.connect();

      const writes: string[] = [];
      mockShell.stdin.write.mockImplementation((data: string) => {
        writes.push(data);
        const match = data.match(/echo "(__AL_DELIM_[a-f0-9]+__) \$\?"/);
        if (match) {
          process.nextTick(() => {
            mockShell.stdout.emit("data", Buffer.from(`${match[1]} 0\n`));
          });
        }
      });

      const files = new Map<string, Buffer>();
      files.set("/workspace/test.txt", Buffer.from("hello"));
      await transport.writeFiles(files);

      expect(writes.some((w) => w.includes("mkdir -p"))).toBe(true);
      expect(writes.some((w) => w.includes("base64 -d"))).toBe(true);
    });
  });

  describe("close()", () => {
    it("sends exit command and kills the process", async () => {
      autoRespondToDelimiter(mockShell);
      const transport = new SshTransport({ host: "10.0.0.1" });
      await transport.connect();
      await transport.close();

      expect(mockShell.stdin.write).toHaveBeenCalledWith("exit\n");
      expect(mockShell.stdin.end).toHaveBeenCalled();
      expect(mockShell.kill).toHaveBeenCalled();
    });

    it("does nothing if already closed", async () => {
      const transport = new SshTransport({ host: "10.0.0.1" });
      await transport.close(); // Should not throw
    });
  });
});
