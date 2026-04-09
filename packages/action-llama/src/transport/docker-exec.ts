/**
 * DockerExecTransport — executes commands inside a running Docker container
 * via `docker exec -i`, maintaining a persistent shell session.
 *
 * Shell state (cwd, env vars) persists across exec() calls because all commands
 * run in the same sh process. File I/O uses `docker cp` for efficient batch
 * transfers without framing issues.
 */

import { spawn, execFileSync, type ChildProcess } from "child_process";
import { randomBytes } from "crypto";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, mkdirSync } from "fs";
import { join, dirname, basename } from "path";
import { tmpdir } from "os";
import type { Transport, ExecResult, ExecOptions } from "./transport.js";

/** How long to wait for the shell to become ready after spawning (ms). */
const SHELL_READY_TIMEOUT_MS = 10_000;
/** Default command execution timeout (ms). */
const DEFAULT_EXEC_TIMEOUT_MS = 300_000;

/** Generate a unique delimiter that won't appear in command output. */
function makeDelimiter(): string {
  return `__AL_DELIM_${randomBytes(8).toString("hex")}__`;
}

export interface DockerExecTransportOpts {
  /** The Docker container name or ID to connect to. */
  container: string;
  /** User to run as inside the container. Default: undefined (container default). */
  user?: string;
  /** Initial working directory. Default: "/" */
  cwd?: string;
}

export class DockerExecTransport implements Transport {
  private container: string;
  private shell: ChildProcess | null = null;
  private ready = false;
  private buffer = "";
  private user?: string;
  private _closed = false;

  constructor(private opts: DockerExecTransportOpts) {
    this.container = opts.container;
    this.user = opts.user;
  }

  /** Start the persistent shell session. Must be called before exec(). */
  async connect(): Promise<void> {
    const args = ["exec", "-i"];
    if (this.user) {
      args.push("-u", this.user);
    }
    args.push(this.container, "sh");

    this.shell = spawn("docker", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Absorb EPIPE on stdin — the spawned process may exit before we write to it
    // (e.g. container not found, Docker daemon unreachable, or mocked Docker).
    this.shell.stdin!.on("error", () => {});

    this.shell.stdout!.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
    });

    this.shell.on("exit", () => {
      this.ready = false;
    });

    // Wait for shell to be ready by sending a probe command
    const readyDelim = makeDelimiter();
    this.shell.stdin!.write(`echo "${readyDelim} $?"\n`);
    await this.waitForDelimiter(readyDelim, SHELL_READY_TIMEOUT_MS);
    this.ready = true;

    // Set initial cwd if specified
    if (this.opts.cwd) {
      await this.exec(`cd ${shellQuote(this.opts.cwd)}`);
    }
  }

  /**
   * Wait for a delimiter to appear in the stdout buffer.
   * Returns the output that appeared before the delimiter.
   * Also parses the exit code from the delimiter line.
   */
  private waitForDelimiter(delimiter: string, timeoutMs: number): Promise<{ output: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        clearInterval(poll);
        reject(new Error(`Timed out waiting for shell response (${timeoutMs}ms)`));
      }, timeoutMs);

      const check = () => {
        if (this._closed) {
          clearTimeout(timer);
          clearInterval(poll);
          reject(new Error("Transport closed"));
          return;
        }
        const idx = this.buffer.indexOf(delimiter);
        if (idx === -1) return;

        // Find the end of the delimiter line
        const lineEnd = this.buffer.indexOf("\n", idx);
        if (lineEnd === -1) return;

        const output = this.buffer.slice(0, idx);
        const delimLine = this.buffer.slice(idx, lineEnd);
        this.buffer = this.buffer.slice(lineEnd + 1);

        clearTimeout(timer);
        clearInterval(poll);

        // Parse exit code from delimiter line: "__AL_DELIM_xxx__ 0"
        const match = delimLine.match(/\s+(\d+)\s*$/);
        const exitCode = match ? parseInt(match[1], 10) : 0;

        resolve({ output, exitCode });
      };

      const poll = setInterval(check, 10);
      // Check immediately in case data already arrived
      check();
    });
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    if (!this.shell || !this.ready) {
      throw new Error("Transport not connected. Call connect() first.");
    }

    const delimiter = makeDelimiter();
    let stderr = "";

    // Capture stderr for this command
    const stderrHandler = (chunk: Buffer) => {
      stderr += chunk.toString();
    };
    this.shell.stderr!.on("data", stderrHandler);

    // Set up abort handling
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      // Send Ctrl+C to the shell to interrupt the running command
      this.shell?.stdin?.write("\x03\n");
    };
    if (options?.signal) {
      if (options.signal.aborted) {
        this.shell?.stderr?.removeListener("data", stderrHandler);
        return { stdout: "", stderr: "Aborted", exitCode: 130 };
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    const timeoutMs = options?.timeout ?? DEFAULT_EXEC_TIMEOUT_MS;

    // Set up streaming if onData callback provided
    let streamingInterval: ReturnType<typeof setInterval> | undefined;
    let lastStreamedIdx = 0;
    if (options?.onData) {
      streamingInterval = setInterval(() => {
        if (this.buffer.length > lastStreamedIdx) {
          const newData = this.buffer.slice(lastStreamedIdx);
          // Don't stream past a delimiter if one appeared
          const delimIdx = newData.indexOf("__AL_DELIM_");
          const safeData = delimIdx >= 0 ? newData.slice(0, delimIdx) : newData;
          if (safeData.length > 0) {
            options.onData!(Buffer.from(safeData));
            lastStreamedIdx += safeData.length;
          }
        }
      }, 50);
    }

    try {
      // Send the command, then send the delimiter probe.
      // The delimiter line echoes the exit code of the command ($?).
      this.shell.stdin!.write(`${command}\necho "${delimiter} $?"\n`);

      const { output, exitCode } = await this.waitForDelimiter(delimiter, timeoutMs);

      return {
        stdout: output.trimEnd(),
        stderr: stderr.trimEnd(),
        exitCode: aborted ? 130 : exitCode,
      };
    } catch (err) {
      if (aborted) {
        return { stdout: "", stderr: "Aborted", exitCode: 130 };
      }
      throw err;
    } finally {
      this.shell?.stderr?.removeListener("data", stderrHandler);
      if (options?.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
      if (streamingInterval) clearInterval(streamingInterval);
    }
  }

  async readFiles(paths: string[]): Promise<Map<string, Buffer>> {
    const result = new Map<string, Buffer>();
    if (paths.length === 0) return result;

    if (paths.length === 1) {
      return this.readSingleFile(paths[0]);
    }

    // Batch read: tar on the container → docker cp the tar → extract locally
    const tmpDir = mkdtempSync(join(tmpdir(), "al-read-"));
    try {
      const tarName = `al-batch-${randomBytes(4).toString("hex")}.tar`;
      const remoteTar = `/tmp/${tarName}`;

      // Create tar on container (ignoring missing files, using absolute paths)
      const pathArgs = paths.map(p => shellQuote(p)).join(" ");
      execFileSync("docker", [
        "exec", this.container,
        "sh", "-c", `tar cf ${remoteTar} --ignore-failed-read -P ${pathArgs} 2>/dev/null; true`,
      ], {
        timeout: 30_000,
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Copy tar to local
      execFileSync("docker", ["cp", `${this.container}:${remoteTar}`, join(tmpDir, "batch.tar")], {
        timeout: 30_000,
      });

      // Clean up tar on container
      execFileSync("docker", ["exec", this.container, "rm", "-f", remoteTar], {
        timeout: 5_000,
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Extract locally (with -P to preserve absolute paths)
      execFileSync("tar", ["xf", join(tmpDir, "batch.tar"), "-P", "-C", tmpDir], {
        timeout: 30_000,
      });

      // Read extracted files — tar with -P preserves the full path under tmpDir
      for (const path of paths) {
        const localPath = join(tmpDir, path);
        try {
          result.set(path, readFileSync(localPath));
        } catch {
          // File wasn't in the tar (didn't exist on container)
        }
      }
    } catch {
      // Fallback: read files one by one
      for (const path of paths) {
        try {
          const single = await this.readSingleFile(path);
          const content = single.get(path);
          if (content) result.set(path, content);
        } catch {
          // Skip missing files
        }
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }

    return result;
  }

  private async readSingleFile(path: string): Promise<Map<string, Buffer>> {
    const result = new Map<string, Buffer>();
    const tmpDir = mkdtempSync(join(tmpdir(), "al-read-"));
    try {
      execFileSync("docker", ["cp", `${this.container}:${path}`, join(tmpDir, "file")], {
        timeout: 30_000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      result.set(path, readFileSync(join(tmpDir, "file")));
    } catch {
      // File not found — omit from result
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    return result;
  }

  async writeFiles(files: Map<string, Buffer>): Promise<void> {
    if (files.size === 0) return;

    const tmpDir = mkdtempSync(join(tmpdir(), "al-write-"));

    try {
      if (files.size === 1) {
        const [[path, content]] = [...files.entries()];

        // Ensure parent directory exists on container
        const dir = dirname(path);
        if (dir !== "/" && dir !== ".") {
          execFileSync("docker", ["exec", this.container, "mkdir", "-p", dir], {
            timeout: 10_000,
            stdio: ["pipe", "pipe", "pipe"],
          });
        }

        const localPath = join(tmpDir, basename(path));
        writeFileSync(localPath, content);
        execFileSync("docker", ["cp", localPath, `${this.container}:${path}`], {
          timeout: 30_000,
        });
        return;
      }

      // Batch write: create a tar locally → docker cp to container → extract
      for (const [path, content] of files) {
        const localPath = join(tmpDir, "payload", path);
        mkdirSync(dirname(localPath), { recursive: true });
        writeFileSync(localPath, content);
      }

      // Create tar preserving absolute paths.
      // List top-level entries explicitly (not ".") to avoid a "." entry in the
      // tar that maps to "/" on extract and fails with permission errors when
      // the container user is non-root.
      const tarPath = join(tmpDir, "batch.tar");
      const payloadDir = join(tmpDir, "payload");
      const topEntries = readdirSync(payloadDir);
      execFileSync("tar", ["cf", tarPath, "-P", "-C", payloadDir, ...topEntries], {
        timeout: 30_000,
      });

      // Copy tar to container
      const remoteTar = `/tmp/al-batch-${randomBytes(4).toString("hex")}.tar`;
      execFileSync("docker", ["cp", tarPath, `${this.container}:${remoteTar}`], {
        timeout: 30_000,
      });

      // Extract on container and clean up
      execFileSync("docker", [
        "exec", this.container,
        "sh", "-c", `tar xf ${remoteTar} -P -C / && rm -f ${remoteTar}`,
      ], {
        timeout: 30_000,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  async close(): Promise<void> {
    this._closed = true;
    if (this.shell) {
      this.ready = false;
      try {
        this.shell.stdin?.write("exit\n");
        this.shell.stdin?.end();
      } catch {
        // stdin may already be closed
      }
      this.shell.kill();
      this.shell = null;
    }
  }
}

/** Escape a string for use in a shell command. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
