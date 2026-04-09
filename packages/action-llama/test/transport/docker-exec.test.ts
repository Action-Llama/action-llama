import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";

// ── Mocks ──────────────────────────────────────────────────────

/** Create a mock ChildProcess that simulates a Docker shell session. */
function createMockShell() {
  const stdin = { write: vi.fn(), end: vi.fn(), on: vi.fn() };
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
const mockExecFileSync = vi.fn();

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    spawn: vi.fn(() => mockShell),
    execFileSync: (...args: any[]) => mockExecFileSync(...args),
  };
});

const mockMkdtempSync = vi.fn(() => "/tmp/al-test-123");
const mockWriteFileSync = vi.fn();
const mockReadFileSync = vi.fn(() => Buffer.from("file content"));
const mockRmSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockReaddirSync = vi.fn(() => ["app"]);

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    mkdtempSync: (...args: any[]) => mockMkdtempSync(...args),
    writeFileSync: (...args: any[]) => mockWriteFileSync(...args),
    readFileSync: (...args: any[]) => mockReadFileSync(...args),
    rmSync: (...args: any[]) => mockRmSync(...args),
    mkdirSync: (...args: any[]) => mockMkdirSync(...args),
    readdirSync: (...args: any[]) => mockReaddirSync(...args),
  };
});

// Import after mocks
const { DockerExecTransport } = await import("../../src/transport/docker-exec.js");

// ── Helpers ────────────────────────────────────────────────────

/**
 * Simulate the shell responding to a delimiter probe.
 * When stdin.write is called with a delimiter, emit the delimiter on stdout.
 */
function autoRespondToDelimiters(shell: ReturnType<typeof createMockShell>) {
  shell.stdin.write.mockImplementation((data: string) => {
    // Look for delimiter echo commands: echo "__AL_DELIM_xxx__ $?"
    const match = data.match(/echo "(__AL_DELIM_[a-f0-9]+__) \$\?"/);
    if (match) {
      const delimiter = match[1];
      // Simulate the shell echoing back the delimiter with exit code 0
      // Use setTimeout to ensure async behavior
      setTimeout(() => {
        shell.stdout.emit("data", Buffer.from(`${delimiter} 0\n`));
      }, 1);
    }
  });
}

/**
 * Simulate command output followed by delimiter response.
 */
function respondWithOutput(shell: ReturnType<typeof createMockShell>, output: string, exitCode = 0) {
  let callCount = 0;
  shell.stdin.write.mockImplementation((data: string) => {
    const match = data.match(/echo "(__AL_DELIM_[a-f0-9]+__) \$\?"/);
    if (match) {
      callCount++;
      const delimiter = match[1];
      setTimeout(() => {
        shell.stdout.emit("data", Buffer.from(`${output}${delimiter} ${exitCode}\n`));
      }, 1);
    }
  });
}

// ── Tests ──────────────────────────────────────────────────────

describe("DockerExecTransport", () => {
  beforeEach(() => {
    mockShell = createMockShell();
    mockExecFileSync.mockReset();
    mockMkdtempSync.mockReturnValue("/tmp/al-test-123");
    mockWriteFileSync.mockReset();
    mockReadFileSync.mockReturnValue(Buffer.from("file content"));
    mockRmSync.mockReset();
    mockMkdirSync.mockReset();
  });

  describe("connect()", () => {
    it("spawns docker exec with the container name", async () => {
      const transport = new DockerExecTransport({ container: "my-container" });
      autoRespondToDelimiters(mockShell);

      await transport.connect();

      const { spawn } = await import("child_process");
      expect(spawn).toHaveBeenCalledWith(
        "docker",
        ["exec", "-i", "my-container", "bash", "--norc", "--noprofile"],
        expect.any(Object),
      );
    });

    it("passes user flag when specified", async () => {
      const transport = new DockerExecTransport({ container: "c1", user: "agent" });
      autoRespondToDelimiters(mockShell);

      await transport.connect();

      const { spawn } = await import("child_process");
      expect(spawn).toHaveBeenCalledWith(
        "docker",
        ["exec", "-i", "-u", "agent", "c1", "bash", "--norc", "--noprofile"],
        expect.any(Object),
      );
    });

    it("sets initial cwd when specified", async () => {
      const transport = new DockerExecTransport({ container: "c1", cwd: "/workspace" });
      autoRespondToDelimiters(mockShell);

      await transport.connect();

      // After the ready probe, it should send a cd command
      const writes = mockShell.stdin.write.mock.calls.map(c => c[0]);
      const cdCall = writes.find((w: string) => w.includes("cd '/workspace'"));
      expect(cdCall).toBeDefined();
    });
  });

  describe("exec()", () => {
    it("throws if not connected", async () => {
      const transport = new DockerExecTransport({ container: "c1" });
      await expect(transport.exec("ls")).rejects.toThrow("not connected");
    });

    it("sends command and delimiter, returns output", async () => {
      const transport = new DockerExecTransport({ container: "c1" });

      // First call: connect ready probe
      let probeCount = 0;
      mockShell.stdin.write.mockImplementation((data: string) => {
        const match = data.match(/echo "(__AL_DELIM_[a-f0-9]+__) \$\?"/);
        if (match) {
          probeCount++;
          const delimiter = match[1];
          setTimeout(() => {
            if (probeCount === 1) {
              // Ready probe
              shell.stdout.emit("data", Buffer.from(`${delimiter} 0\n`));
            } else {
              // Command output
              shell.stdout.emit("data", Buffer.from(`hello world\n${delimiter} 0\n`));
            }
          }, 1);
        }
      });

      const shell = mockShell;
      await transport.connect();

      const result = await transport.exec("echo hello world");
      expect(result.stdout).toBe("hello world");
      expect(result.exitCode).toBe(0);
    });

    it("captures non-zero exit codes", async () => {
      const transport = new DockerExecTransport({ container: "c1" });

      let probeCount = 0;
      mockShell.stdin.write.mockImplementation((data: string) => {
        const match = data.match(/echo "(__AL_DELIM_[a-f0-9]+__) \$\?"/);
        if (match) {
          probeCount++;
          const delimiter = match[1];
          setTimeout(() => {
            if (probeCount === 1) {
              mockShell.stdout.emit("data", Buffer.from(`${delimiter} 0\n`));
            } else {
              mockShell.stdout.emit("data", Buffer.from(`not found\n${delimiter} 1\n`));
            }
          }, 1);
        }
      });

      await transport.connect();

      const result = await transport.exec("cat /nonexistent");
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("not found");
    });

    it("captures stderr", async () => {
      const transport = new DockerExecTransport({ container: "c1" });

      let probeCount = 0;
      mockShell.stdin.write.mockImplementation((data: string) => {
        const match = data.match(/echo "(__AL_DELIM_[a-f0-9]+__) \$\?"/);
        if (match) {
          probeCount++;
          const delimiter = match[1];
          setTimeout(() => {
            if (probeCount === 1) {
              mockShell.stdout.emit("data", Buffer.from(`${delimiter} 0\n`));
            } else {
              mockShell.stderr.emit("data", Buffer.from("warning: something\n"));
              mockShell.stdout.emit("data", Buffer.from(`output\n${delimiter} 0\n`));
            }
          }, 1);
        }
      });

      await transport.connect();

      const result = await transport.exec("some-cmd");
      expect(result.stderr).toBe("warning: something");
      expect(result.stdout).toBe("output");
    });

    it("returns 130 when aborted", async () => {
      const transport = new DockerExecTransport({ container: "c1" });
      autoRespondToDelimiters(mockShell);

      await transport.connect();

      const ac = new AbortController();
      ac.abort();

      const result = await transport.exec("long-running", { signal: ac.signal });
      expect(result.exitCode).toBe(130);
      expect(result.stderr).toBe("Aborted");
    });
  });

  describe("readFiles()", () => {
    it("returns empty map for empty paths", async () => {
      const transport = new DockerExecTransport({ container: "c1" });
      autoRespondToDelimiters(mockShell);
      await transport.connect();

      const result = await transport.readFiles([]);
      expect(result.size).toBe(0);
    });

    it("uses docker cp for single file", async () => {
      const transport = new DockerExecTransport({ container: "c1" });
      autoRespondToDelimiters(mockShell);
      await transport.connect();

      mockReadFileSync.mockReturnValue(Buffer.from("hello"));

      const result = await transport.readFiles(["/app/file.txt"]);

      expect(mockExecFileSync).toHaveBeenCalledWith(
        "docker",
        ["cp", "c1:/app/file.txt", expect.any(String)],
        expect.any(Object),
      );
      expect(result.get("/app/file.txt")?.toString()).toBe("hello");
    });

    it("omits missing files from result", async () => {
      const transport = new DockerExecTransport({ container: "c1" });
      autoRespondToDelimiters(mockShell);
      await transport.connect();

      mockExecFileSync.mockImplementation(() => {
        throw new Error("no such file");
      });

      const result = await transport.readFiles(["/nonexistent"]);
      expect(result.size).toBe(0);
    });
  });

  describe("writeFiles()", () => {
    it("does nothing for empty map", async () => {
      const transport = new DockerExecTransport({ container: "c1" });
      autoRespondToDelimiters(mockShell);
      await transport.connect();

      await transport.writeFiles(new Map());
      expect(mockExecFileSync).not.toHaveBeenCalled();
    });

    it("uses docker cp for single file", async () => {
      const transport = new DockerExecTransport({ container: "c1" });
      autoRespondToDelimiters(mockShell);
      await transport.connect();

      const files = new Map<string, Buffer>();
      files.set("/app/output.txt", Buffer.from("result"));

      await transport.writeFiles(files);

      // Should ensure parent directory exists
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "docker",
        ["exec", "c1", "mkdir", "-p", "/app"],
        expect.any(Object),
      );

      // Should docker cp the file
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "docker",
        ["cp", expect.stringContaining("output.txt"), "c1:/app/output.txt"],
        expect.any(Object),
      );

      // Should have written the content locally first
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("output.txt"),
        Buffer.from("result"),
      );
    });

    it("uses tar for multiple files", async () => {
      const transport = new DockerExecTransport({ container: "c1" });
      autoRespondToDelimiters(mockShell);
      await transport.connect();

      const files = new Map<string, Buffer>();
      files.set("/app/a.txt", Buffer.from("aaa"));
      files.set("/app/b.txt", Buffer.from("bbb"));

      await transport.writeFiles(files);

      // Should create a local tar
      const tarCall = mockExecFileSync.mock.calls.find(
        (c: any[]) => c[0] === "tar" && c[1]?.[0] === "cf",
      );
      expect(tarCall).toBeDefined();

      // Should docker cp the tar to container
      const cpCall = mockExecFileSync.mock.calls.find(
        (c: any[]) => c[0] === "docker" && c[1]?.[0] === "cp" && c[1]?.[1]?.includes("batch.tar"),
      );
      expect(cpCall).toBeDefined();

      // Should extract on container
      const extractCall = mockExecFileSync.mock.calls.find(
        (c: any[]) => c[0] === "docker" && c[1]?.[0] === "exec" && c[1]?.some((a: string) => a.includes("tar xf")),
      );
      expect(extractCall).toBeDefined();
    });
  });

  describe("close()", () => {
    it("sends exit and kills the shell", async () => {
      const transport = new DockerExecTransport({ container: "c1" });
      autoRespondToDelimiters(mockShell);
      await transport.connect();

      await transport.close();

      const writes = mockShell.stdin.write.mock.calls.map(c => c[0]);
      expect(writes.some((w: string) => w.includes("exit"))).toBe(true);
      expect(mockShell.kill).toHaveBeenCalled();
    });

    it("is safe to call multiple times", async () => {
      const transport = new DockerExecTransport({ container: "c1" });
      autoRespondToDelimiters(mockShell);
      await transport.connect();

      await transport.close();
      await transport.close(); // should not throw
    });
  });
});
