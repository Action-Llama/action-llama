/**
 * HostUserTransport — executes commands as a different OS user via `sudo -u`,
 * maintaining a persistent shell session.
 *
 * File I/O uses direct filesystem access since we're on the same machine —
 * files are read/written as root (the scheduler process) then chowned to
 * the target user.
 */

import { spawn, type ChildProcess } from "child_process";
import { randomBytes } from "crypto";
import {
  readFileSync, writeFileSync, mkdirSync, chownSync,
  statSync,
} from "fs";
import { dirname } from "path";
import type { Transport, ExecResult, ExecOptions } from "./transport.js";

/** How long to wait for the shell to become ready after spawning (ms). */
const SHELL_READY_TIMEOUT_MS = 10_000;
/** Default command execution timeout (ms). */
const DEFAULT_EXEC_TIMEOUT_MS = 300_000;

/** Generate a unique delimiter that won't appear in command output. */
function makeDelimiter(): string {
  return `__AL_DELIM_${randomBytes(8).toString("hex")}__`;
}

export interface HostUserTransportOpts {
  /** OS user to run commands as. */
  user: string;
  /** Additional OS groups. */
  groups?: string[];
  /** Initial working directory. Default: user's home dir. */
  cwd?: string;
}

export class HostUserTransport implements Transport {
  private shell: ChildProcess | null = null;
  private ready = false;
  private buffer = "";
  private uid?: number;
  private gid?: number;

  constructor(private opts: HostUserTransportOpts) {}

  /** Start the persistent shell as the target user. Must be called before exec(). */
  async connect(): Promise<void> {
    const args = ["-u", this.opts.user, "--", "bash", "--norc", "--noprofile"];

    // If groups are specified, use sg or newgrp — but sudo -u is simpler
    // Groups are set via the user's OS group membership, not per-command

    this.shell = spawn("sudo", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.shell.stdout!.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
    });

    this.shell.on("exit", () => {
      this.ready = false;
    });

    // Wait for shell to be ready
    const readyDelim = makeDelimiter();
    this.shell.stdin!.write(`echo "${readyDelim} $?"\n`);
    await this.waitForDelimiter(readyDelim, SHELL_READY_TIMEOUT_MS);
    this.ready = true;

    // Resolve the user's uid/gid for file ownership
    try {
      const { stdout } = await this.exec("id -u");
      this.uid = parseInt(stdout.trim(), 10);
      const { stdout: gidStr } = await this.exec("id -g");
      this.gid = parseInt(gidStr.trim(), 10);
    } catch {
      // Non-critical — files won't be chowned if we can't resolve uid/gid
    }

    // Set initial cwd if specified
    if (this.opts.cwd) {
      await this.exec(`cd ${shellQuote(this.opts.cwd)}`);
    }
  }

  /**
   * Wait for a delimiter to appear in the stdout buffer.
   */
  private waitForDelimiter(delimiter: string, timeoutMs: number): Promise<{ output: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        clearInterval(poll);
        reject(new Error(`Timed out waiting for shell response (${timeoutMs}ms)`));
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

    // Direct filesystem read — the scheduler process can read any file
    for (const path of paths) {
      try {
        result.set(path, readFileSync(path));
      } catch {
        // Skip missing files
      }
    }

    return result;
  }

  async writeFiles(files: Map<string, Buffer>): Promise<void> {
    if (files.size === 0) return;

    for (const [path, content] of files) {
      const dir = dirname(path);
      if (dir !== "/" && dir !== ".") {
        mkdirSync(dir, { recursive: true });
        // Chown directory to target user
        if (this.uid != null && this.gid != null) {
          try { chownRecursiveNew(dir, this.uid, this.gid); } catch { /* best effort */ }
        }
      }

      writeFileSync(path, content);

      // Chown file to target user so they can read/write it
      if (this.uid != null && this.gid != null) {
        try { chownSync(path, this.uid, this.gid); } catch { /* best effort */ }
      }
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

/**
 * Recursively chown newly created directories up to an existing parent.
 * Only chowns directories that were created by mkdirSync (newly created).
 */
function chownRecursiveNew(dir: string, uid: number, gid: number): void {
  try {
    const stat = statSync(dir);
    if (stat.uid !== uid) {
      chownSync(dir, uid, gid);
    }
  } catch {
    // Directory doesn't exist or inaccessible
  }
}
