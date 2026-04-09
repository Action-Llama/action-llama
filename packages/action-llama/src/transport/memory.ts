/**
 * MemoryTransport — in-memory transport for testing.
 *
 * Simulates a filesystem and shell without any external dependencies.
 * Use this to test upper layers (Pi tools, scheduler integration) without
 * needing Docker or SSH.
 */

import type { Transport, ExecResult, ExecOptions } from "./transport.js";

export interface MemoryExecHandler {
  (command: string, options?: ExecOptions): ExecResult | Promise<ExecResult>;
}

export class MemoryTransport implements Transport {
  /** In-memory filesystem: path → contents. */
  files = new Map<string, Buffer>();

  /** Log of all exec() calls for assertions. */
  execLog: string[] = [];

  /** Current working directory (tracked for cwd state). */
  cwd = "/";

  /** Custom handler for exec calls. When set, overrides default behavior. */
  execHandler?: MemoryExecHandler;

  /** Whether close() has been called. */
  closed = false;

  async connect(): Promise<void> {
    this.closed = false;
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    if (this.closed) throw new Error("Transport is closed");
    this.execLog.push(command);

    if (this.execHandler) {
      return this.execHandler(command, options);
    }

    return this.defaultExec(command);
  }

  private defaultExec(command: string): ExecResult {
    // Simulate basic shell commands for testing

    // test -r / test -e / test -w
    const testMatch = command.match(/test -([rewxd]) '([^']+)'/);
    if (testMatch) {
      const [, flag, path] = testMatch;
      if (flag === "d") {
        const isDir = [...this.files.keys()].some(k => k.startsWith(path + "/"));
        return { stdout: "", stderr: "", exitCode: isDir ? 0 : 1 };
      }
      const exists = this.files.has(path);
      return { stdout: "", stderr: "", exitCode: exists ? 0 : 1 };
    }

    // Combined test: test -r <path> && test -w <path>
    const combinedTest = command.match(/test -r '([^']+)' && test -w '([^']+)'/);
    if (combinedTest) {
      const exists = this.files.has(combinedTest[1]);
      return { stdout: "", stderr: "", exitCode: exists ? 0 : 1 };
    }

    // mkdir -p
    if (command.includes("mkdir -p")) {
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    // ls -1
    const lsMatch = command.match(/ls -1 '([^']+)'/);
    if (lsMatch) {
      const dir = lsMatch[1];
      const entries = [...this.files.keys()]
        .filter(k => k.startsWith(dir + "/"))
        .map(k => k.slice(dir.length + 1).split("/")[0])
        .filter((v, i, a) => a.indexOf(v) === i);
      if (entries.length === 0) {
        return { stdout: "", stderr: "No such file or directory", exitCode: 1 };
      }
      return { stdout: entries.join("\n"), stderr: "", exitCode: 0 };
    }

    // echo
    const echoMatch = command.match(/^echo (.+)$/);
    if (echoMatch) {
      return { stdout: echoMatch[1], stderr: "", exitCode: 0 };
    }

    return { stdout: "", stderr: "", exitCode: 0 };
  }

  async readFiles(paths: string[]): Promise<Map<string, Buffer>> {
    if (this.closed) throw new Error("Transport is closed");
    const result = new Map<string, Buffer>();
    for (const path of paths) {
      const content = this.files.get(path);
      if (content) result.set(path, content);
    }
    return result;
  }

  async writeFiles(files: Map<string, Buffer>): Promise<void> {
    if (this.closed) throw new Error("Transport is closed");
    for (const [path, content] of files) {
      this.files.set(path, content);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  // ── Test helpers ────────────────────────────────────────────

  /** Add a file to the in-memory filesystem. */
  addFile(path: string, content: string): void {
    this.files.set(path, Buffer.from(content, "utf-8"));
  }

  /** Get file content as string, or undefined if not found. */
  getFile(path: string): string | undefined {
    return this.files.get(path)?.toString("utf-8");
  }

  /** Reset state for a fresh test. */
  reset(): void {
    this.files.clear();
    this.execLog = [];
    this.cwd = "/";
    this.execHandler = undefined;
    this.closed = false;
  }
}
