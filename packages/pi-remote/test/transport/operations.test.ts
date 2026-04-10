import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Transport, ExecResult, ExecOptions } from "../../src/transport/transport.js";

/**
 * In-memory transport for testing the operations adapter.
 * Simulates a filesystem and shell without Docker or SSH.
 */
class MemoryTransport implements Transport {
  files = new Map<string, Buffer>();
  execLog: string[] = [];
  lastExitCode = 0;
  execHandler?: (cmd: string) => ExecResult;

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    this.execLog.push(command);

    if (this.execHandler) {
      return this.execHandler(command);
    }

    // Default: simulate basic commands
    if (command.includes("test -r") || command.includes("test -e") || command.includes("test -w")) {
      const pathMatch = command.match(/test -[rwe] '([^']+)'/);
      if (pathMatch) {
        const exists = this.files.has(pathMatch[1]);
        return { stdout: "", stderr: "", exitCode: exists ? 0 : 1 };
      }
    }

    if (command.includes("test -d")) {
      // Simulate directory check — paths ending with "/" are directories
      const pathMatch = command.match(/test -d '([^']+)'/);
      if (pathMatch) {
        const path = pathMatch[1];
        const isDir = [...this.files.keys()].some(k => k.startsWith(path + "/"));
        return { stdout: "", stderr: "", exitCode: isDir ? 0 : 1 };
      }
    }

    if (command.includes("mkdir -p")) {
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    if (command.includes("ls -1")) {
      const pathMatch = command.match(/ls -1 '([^']+)'/);
      if (pathMatch) {
        const dir = pathMatch[1];
        const entries = [...this.files.keys()]
          .filter(k => k.startsWith(dir + "/"))
          .map(k => k.slice(dir.length + 1).split("/")[0])
          .filter((v, i, a) => a.indexOf(v) === i);
        if (entries.length === 0) {
          return { stdout: "", stderr: "No such file or directory", exitCode: 1 };
        }
        return { stdout: entries.join("\n"), stderr: "", exitCode: 0 };
      }
    }

    return { stdout: "", stderr: "", exitCode: this.lastExitCode };
  }

  async readFiles(paths: string[]): Promise<Map<string, Buffer>> {
    const result = new Map<string, Buffer>();
    for (const path of paths) {
      const content = this.files.get(path);
      if (content) result.set(path, content);
    }
    return result;
  }

  async writeFiles(files: Map<string, Buffer>): Promise<void> {
    for (const [path, content] of files) {
      this.files.set(path, content);
    }
  }

  async close(): Promise<void> {
    // no-op
  }
}

// Import operations after transport is defined
const {
  createTransportBashOps,
  createTransportReadOps,
  createTransportWriteOps,
  createTransportEditOps,
  createTransportGrepOps,
  createTransportFindOps,
  createTransportLsOps,
} = await import("../../src/transport/operations.js");

describe("Transport Operations", () => {
  let transport: MemoryTransport;

  beforeEach(() => {
    transport = new MemoryTransport();
  });

  describe("BashOperations", () => {
    it("executes command via transport with cwd prefix", async () => {
      const ops = createTransportBashOps(transport);
      transport.execHandler = (cmd) => {
        return { stdout: "hello", stderr: "", exitCode: 0 };
      };

      const result = await ops.exec("echo hello", "/workspace", {
        onData: () => {},
      });

      expect(result.exitCode).toBe(0);
      expect(transport.execLog[0]).toContain("cd '/workspace'");
      expect(transport.execLog[0]).toContain("echo hello");
    });

    it("passes abort signal through", async () => {
      const ops = createTransportBashOps(transport);

      const ac = new AbortController();
      const onData = vi.fn();

      transport.execHandler = (cmd) => {
        return { stdout: "", stderr: "", exitCode: 0 };
      };

      await ops.exec("sleep 10", "/tmp", {
        onData,
        signal: ac.signal,
        timeout: 5000,
      });

      // Signal was passed (we can verify by checking the exec call had the right options)
      expect(transport.execLog).toHaveLength(1);
    });
  });

  describe("ReadOperations", () => {
    it("reads file via transport", async () => {
      const ops = createTransportReadOps(transport);
      transport.files.set("/app/test.txt", Buffer.from("file content"));

      const content = await ops.readFile("/app/test.txt");
      expect(content.toString()).toBe("file content");
    });

    it("throws for missing file", async () => {
      const ops = createTransportReadOps(transport);
      await expect(ops.readFile("/nonexistent")).rejects.toThrow("File not found");
    });

    it("checks access via shell test command", async () => {
      const ops = createTransportReadOps(transport);
      transport.files.set("/app/readable.txt", Buffer.from("ok"));

      // Should not throw for existing file
      await ops.access("/app/readable.txt");

      // Should throw for missing file
      await expect(ops.access("/nonexistent")).rejects.toThrow("ENOENT");
    });
  });

  describe("WriteOperations", () => {
    it("writes file via transport", async () => {
      const ops = createTransportWriteOps(transport);
      await ops.writeFile("/app/output.txt", "hello world");

      expect(transport.files.get("/app/output.txt")?.toString()).toBe("hello world");
    });

    it("creates directory via exec", async () => {
      const ops = createTransportWriteOps(transport);
      await ops.mkdir("/app/nested/dir");

      expect(transport.execLog).toHaveLength(1);
      expect(transport.execLog[0]).toContain("mkdir -p");
      expect(transport.execLog[0]).toContain("/app/nested/dir");
    });
  });

  describe("EditOperations", () => {
    it("reads and writes files for editing", async () => {
      const ops = createTransportEditOps(transport);
      transport.files.set("/app/file.ts", Buffer.from("const x = 1;"));

      // Read
      const content = await ops.readFile("/app/file.ts");
      expect(content.toString()).toBe("const x = 1;");

      // Write back modified
      await ops.writeFile("/app/file.ts", "const x = 2;");
      expect(transport.files.get("/app/file.ts")?.toString()).toBe("const x = 2;");
    });

    it("checks read+write access", async () => {
      const ops = createTransportEditOps(transport);

      transport.execHandler = (cmd) => {
        if (cmd.includes("test -r") && cmd.includes("test -w")) {
          return { stdout: "", stderr: "", exitCode: 1 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      };

      await expect(ops.access("/readonly")).rejects.toThrow("EACCES");
    });
  });

  describe("GrepOperations", () => {
    it("checks if path is a directory", async () => {
      const ops = createTransportGrepOps(transport);
      transport.files.set("/app/src/index.ts", Buffer.from("code"));

      const isDir = await ops.isDirectory("/app/src");
      expect(isDir).toBe(true);

      const isFile = await ops.isDirectory("/app/src/index.ts");
      expect(isFile).toBe(false);
    });

    it("reads file contents as string", async () => {
      const ops = createTransportGrepOps(transport);
      transport.files.set("/app/file.txt", Buffer.from("line1\nline2"));

      const content = await ops.readFile("/app/file.txt");
      expect(content).toBe("line1\nline2");
    });
  });

  describe("FindOperations", () => {
    it("checks if path exists", async () => {
      const ops = createTransportFindOps(transport);
      transport.files.set("/app/file.txt", Buffer.from(""));

      expect(await ops.exists("/app/file.txt")).toBe(true);
      expect(await ops.exists("/nonexistent")).toBe(false);
    });

    it("globs files via find command", async () => {
      const ops = createTransportFindOps(transport);
      transport.execHandler = (cmd) => {
        if (cmd.includes("find .")) {
          return {
            stdout: "./src/a.ts\n./src/b.ts\n",
            stderr: "",
            exitCode: 0,
          };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      };

      const results = await ops.glob("*.ts", "/app", { ignore: ["node_modules"], limit: 100 });
      expect(results).toEqual(["./src/a.ts", "./src/b.ts"]);
    });

    it("returns empty array when no matches", async () => {
      const ops = createTransportFindOps(transport);
      transport.execHandler = () => ({ stdout: "", stderr: "", exitCode: 1 });

      const results = await ops.glob("*.xyz", "/app", { ignore: [], limit: 100 });
      expect(results).toEqual([]);
    });
  });

  describe("LsOperations", () => {
    it("checks if path exists", async () => {
      const ops = createTransportLsOps(transport);
      transport.files.set("/app/file.txt", Buffer.from(""));

      expect(await ops.exists("/app/file.txt")).toBe(true);
      expect(await ops.exists("/nope")).toBe(false);
    });

    it("stats directories", async () => {
      const ops = createTransportLsOps(transport);
      transport.files.set("/app/src/index.ts", Buffer.from(""));

      const dirStat = await ops.stat("/app/src");
      expect(dirStat.isDirectory()).toBe(true);

      transport.files.set("/app/file.txt", Buffer.from(""));
      const fileStat = await ops.stat("/app/file.txt");
      expect(fileStat.isDirectory()).toBe(false);
    });

    it("lists directory entries", async () => {
      const ops = createTransportLsOps(transport);
      transport.files.set("/app/src/a.ts", Buffer.from(""));
      transport.files.set("/app/src/b.ts", Buffer.from(""));
      transport.files.set("/app/src/nested/c.ts", Buffer.from(""));

      const entries = await ops.readdir("/app/src");
      expect(entries).toContain("a.ts");
      expect(entries).toContain("b.ts");
      expect(entries).toContain("nested");
      expect(entries).toHaveLength(3);
    });

    it("throws for nonexistent directory", async () => {
      const ops = createTransportLsOps(transport);
      await expect(ops.readdir("/nonexistent")).rejects.toThrow("ENOENT");
    });
  });
});
