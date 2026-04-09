/**
 * SshTransport — executes commands on a remote host via a persistent SSH
 * connection. Shell state (cwd, env vars) persists across exec() calls.
 *
 * File I/O uses the same SSH connection's stdin/stdout with base64 encoding
 * to avoid opening additional connections.
 */

import { spawn, type ChildProcess } from "child_process";
import { randomBytes } from "crypto";
import type { Transport, ExecResult, ExecOptions } from "./transport.js";

/** How long to wait for the shell to become ready after connecting (ms). */
const SHELL_READY_TIMEOUT_MS = 15_000;
/** Default command execution timeout (ms). */
const DEFAULT_EXEC_TIMEOUT_MS = 300_000;

/** Generate a unique delimiter that won't appear in command output. */
function makeDelimiter(): string {
  return `__AL_DELIM_${randomBytes(8).toString("hex")}__`;
}

export interface SshTransportOpts {
  /** SSH hostname or IP address. */
  host: string;
  /** SSH port. Default: 22. */
  port?: number;
  /** SSH user. */
  user?: string;
  /** Path to SSH private key. */
  keyPath?: string;
  /** Initial working directory on the remote. Default: "~". */
  cwd?: string;
  /** Additional SSH options (e.g. StrictHostKeyChecking). */
  sshOptions?: Record<string, string>;
  /** Timeout for the initial shell ready probe (ms). Default: 15000. */
  connectTimeoutMs?: number;
}

export class SshTransport implements Transport {
  private shell: ChildProcess | null = null;
  private ready = false;
  private buffer = "";

  constructor(private opts: SshTransportOpts) {}

  /** Establish the persistent SSH shell session. Must be called before exec(). */
  async connect(): Promise<void> {
    const args: string[] = [
      "-tt",          // Force PTY allocation for interactive shell
      "-o", "BatchMode=yes",
      "-o", "ServerAliveInterval=15",
      "-o", "ServerAliveCountMax=3",
    ];

    if (this.opts.port) {
      args.push("-p", String(this.opts.port));
    }

    if (this.opts.keyPath) {
      args.push("-i", this.opts.keyPath);
    }

    // Apply custom SSH options
    if (this.opts.sshOptions) {
      for (const [key, value] of Object.entries(this.opts.sshOptions)) {
        args.push("-o", `${key}=${value}`);
      }
    }

    const target = this.opts.user
      ? `${this.opts.user}@${this.opts.host}`
      : this.opts.host;
    args.push(target);

    // Launch interactive shell
    args.push("bash", "--norc", "--noprofile");

    this.shell = spawn("ssh", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.shell.stdout!.on("data", (chunk: Buffer) => {
      // Strip ANSI escape sequences and carriage returns from PTY output
      this.buffer += stripAnsi(chunk.toString());
    });

    this.shell.on("exit", () => {
      this.ready = false;
    });

    // Wait for shell to be ready
    const readyDelim = makeDelimiter();
    this.shell.stdin!.write(`echo "${readyDelim} $?"\n`);
    await this.waitForDelimiter(readyDelim, this.opts.connectTimeoutMs ?? SHELL_READY_TIMEOUT_MS);
    this.ready = true;

    // Set initial cwd if specified
    if (this.opts.cwd) {
      await this.exec(`cd ${shellQuote(this.opts.cwd)}`);
    }
  }

  /**
   * Wait for a delimiter to appear in the stdout buffer.
   * Returns the output before the delimiter and the exit code.
   */
  private waitForDelimiter(delimiter: string, timeoutMs: number): Promise<{ output: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        clearInterval(poll);
        reject(new Error(`Timed out waiting for SSH shell response (${timeoutMs}ms)`));
      }, timeoutMs);

      const check = () => {
        const idx = this.buffer.indexOf(delimiter);
        if (idx === -1) return;

        const lineEnd = this.buffer.indexOf("\n", idx);
        if (lineEnd === -1) return;

        const output = this.buffer.slice(0, idx);
        const delimLine = this.buffer.slice(idx, lineEnd);
        this.buffer = this.buffer.slice(lineEnd + 1);

        clearTimeout(timer);
        clearInterval(poll);

        const match = delimLine.match(/\s+(\d+)\s*$/);
        const exitCode = match ? parseInt(match[1], 10) : 0;

        resolve({ output, exitCode });
      };

      const poll = setInterval(check, 10);
      check();
    });
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    if (!this.shell || !this.ready) {
      throw new Error("Transport not connected. Call connect() first.");
    }

    const delimiter = makeDelimiter();
    let stderr = "";

    const stderrHandler = (chunk: Buffer) => {
      stderr += chunk.toString();
    };
    this.shell.stderr!.on("data", stderrHandler);

    // Abort handling
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      this.shell?.stdin?.write("\x03\n");
    };
    if (options?.signal) {
      if (options.signal.aborted) {
        this.shell.stderr!.removeListener("data", stderrHandler);
        return { stdout: "", stderr: "Aborted", exitCode: 130 };
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    const timeoutMs = options?.timeout ?? DEFAULT_EXEC_TIMEOUT_MS;

    // Streaming
    let streamingInterval: ReturnType<typeof setInterval> | undefined;
    let lastStreamedIdx = 0;
    if (options?.onData) {
      streamingInterval = setInterval(() => {
        if (this.buffer.length > lastStreamedIdx) {
          const newData = this.buffer.slice(lastStreamedIdx);
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
      this.shell.stderr!.removeListener("data", stderrHandler);
      if (options?.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
      if (streamingInterval) clearInterval(streamingInterval);
    }
  }

  async readFiles(paths: string[]): Promise<Map<string, Buffer>> {
    const result = new Map<string, Buffer>();
    if (paths.length === 0) return result;

    // Use base64 encoding over the shell to read files without extra connections.
    // For each file: base64-encode → capture in delimiter-framed output → decode locally.
    for (const path of paths) {
      try {
        const { stdout, exitCode } = await this.exec(
          `test -r ${shellQuote(path)} && base64 ${shellQuote(path)} || echo "__AL_FILE_MISSING__"`,
          { timeout: 30_000 },
        );
        if (exitCode === 0 && !stdout.includes("__AL_FILE_MISSING__")) {
          // Remove any whitespace (base64 may be wrapped)
          const cleaned = stdout.replace(/\s/g, "");
          result.set(path, Buffer.from(cleaned, "base64"));
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return result;
  }

  async writeFiles(files: Map<string, Buffer>): Promise<void> {
    if (files.size === 0) return;

    // Use base64 encoding over the shell to write files without extra connections.
    for (const [path, content] of files) {
      const dir = path.substring(0, path.lastIndexOf("/"));
      if (dir && dir !== "/") {
        await this.exec(`mkdir -p ${shellQuote(dir)}`, { timeout: 10_000 });
      }

      const b64 = content.toString("base64");
      // Use heredoc to avoid shell argument length limits
      await this.exec(
        `echo '${b64}' | base64 -d > ${shellQuote(path)}`,
        { timeout: 30_000 },
      );
    }
  }

  async close(): Promise<void> {
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

/** Strip ANSI escape sequences and carriage returns from PTY output. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\r/g, "");
}
