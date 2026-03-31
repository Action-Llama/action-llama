/**
 * HostUserRuntime — runs agents as a separate OS user via `sudo -u`.
 *
 * Provides lightweight isolation without Docker:
 *  - Agent process runs as a dedicated OS user (can't access operator credentials)
 *  - Credentials staged to a temp dir, path passed via AL_CREDENTIALS_PATH
 *  - Working directory: /tmp/al-runs/<instance-id>/ (chowned to agent user)
 *  - Logs written to /tmp/al-runs/<instance-id>.log (owned by scheduler)
 *  - No image builds, no containers, no Docker dependency
 *
 * Stdio is directed to the log file (not pipes), so the child process survives
 * scheduler restarts. On restart, `reattach()` reconstructs the in-memory state
 * from the PID file, and all methods (streamLogs, waitForExit, kill) follow the
 * same code path as a freshly launched process.
 */

import { spawn, execFileSync } from "child_process";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync,
  chownSync, readFileSync, existsSync,
  readdirSync, openSync, readSync, closeSync, statSync, watch,
  type FSWatcher,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type {
  Runtime, RuntimeLaunchOpts, RuntimeCredentials,
  CredentialBundle, RunningAgent,
} from "./runtime.js";
import { parseCredentialRef, getDefaultBackend } from "../shared/credentials.js";
import { CONSTANTS } from "../shared/constants.js";

const RUNS_DIR = join(tmpdir(), "al-runs");
const ORPHAN_POLL_MS = 500;

/** Metadata persisted alongside a running process for orphan recovery. */
interface PidFileData {
  pid: number;
  agentName: string;
  env: Record<string, string>;
  startedAt: string;
}

function pidFilePath(runId: string): string {
  return join(RUNS_DIR, `${runId}.pid`);
}

function writePidFile(runId: string, data: PidFileData): void {
  try {
    writeFileSync(pidFilePath(runId), JSON.stringify(data) + "\n", { mode: 0o644 });
  } catch { /* best effort */ }
}

function readPidFile(runId: string): PidFileData | null {
  try {
    const content = readFileSync(pidFilePath(runId), "utf-8");
    return JSON.parse(content.trim());
  } catch {
    return null;
  }
}

function removePidFile(runId: string): void {
  try {
    rmSync(pidFilePath(runId));
  } catch { /* best effort */ }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Resolve the UID for an OS user. Returns undefined if user doesn't exist. */
function resolveUid(username: string): number | undefined {
  try {
    const out = execFileSync("id", ["-u", username], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return parseInt(out, 10);
  } catch {
    return undefined;
  }
}

/** Resolve the GID for an OS user. Returns undefined if user doesn't exist. */
function resolveGid(username: string): number | undefined {
  try {
    const out = execFileSync("id", ["-g", username], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return parseInt(out, 10);
  } catch {
    return undefined;
  }
}

/**
 * Minimal process handle that both ChildProcess and OrphanProcess satisfy.
 * Keeps waitForExit / kill / shutdown on a single code path.
 */
interface ProcessHandle {
  pid: number | undefined;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: string, listener: (...args: any[]) => void): any;
}

/**
 * Wraps a bare OS PID (discovered via PID file) so it behaves like a
 * ChildProcess to the rest of the runtime.  Polls liveness and emits
 * "exit" when the process disappears.
 */
class OrphanProcess extends EventEmitter implements ProcessHandle {
  readonly pid: number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(pid: number) {
    super();
    this.pid = pid;
    this.pollTimer = setInterval(() => {
      if (!isProcessAlive(pid)) {
        this.stop();
        this.emit("exit", 0, null);
      }
    }, ORPHAN_POLL_MS);
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    try {
      process.kill(this.pid, signal);
      return true;
    } catch {
      return false;
    }
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

export class HostUserRuntime implements Runtime {
  readonly needsGateway = false;

  private runAs: string;
  private processes = new Map<string, ProcessHandle>();
  private runAgentNames = new Map<string, string>();

  constructor(runAs: string = "al-agent") {
    this.runAs = runAs;
  }

  async isAgentRunning(agentName: string): Promise<boolean> {
    for (const [, name] of this.runAgentNames) {
      if (name === agentName) return true;
    }

    // Check PID files for orphaned processes from a previous scheduler session
    try {
      if (!existsSync(RUNS_DIR)) return false;
      const prefix = `al-${agentName}-`;
      for (const f of readdirSync(RUNS_DIR)) {
        if (!f.startsWith(prefix) || !f.endsWith(".pid")) continue;
        const runId = f.slice(0, -4);
        const data = readPidFile(runId);
        if (data && isProcessAlive(data.pid)) return true;
      }
    } catch { /* best effort */ }

    return false;
  }

  async listRunningAgents(): Promise<RunningAgent[]> {
    const agents: RunningAgent[] = [];
    const knownRunIds = new Set<string>();

    // In-memory tracked processes (current scheduler session)
    for (const [runId, agentName] of this.runAgentNames) {
      if (this.processes.has(runId)) {
        agents.push({
          agentName,
          taskId: runId,
          runtimeId: runId,
          status: "running",
        });
        knownRunIds.add(runId);
      }
    }

    // Scan PID files for orphaned processes from a previous scheduler session
    try {
      if (!existsSync(RUNS_DIR)) return agents;
      for (const file of readdirSync(RUNS_DIR)) {
        if (!file.endsWith(".pid")) continue;
        const runId = file.slice(0, -4);
        if (knownRunIds.has(runId)) continue;

        const data = readPidFile(runId);
        if (!data) {
          removePidFile(runId);
          continue;
        }

        if (isProcessAlive(data.pid)) {
          agents.push({
            agentName: data.agentName,
            taskId: runId,
            runtimeId: runId,
            status: "running",
            startedAt: new Date(data.startedAt),
          });
        } else {
          removePidFile(runId);
        }
      }
    } catch { /* best effort */ }

    return agents;
  }

  async prepareCredentials(credRefs: string[]): Promise<RuntimeCredentials> {
    const stagingDir = mkdtempSync(join(tmpdir(), CONSTANTS.CREDS_TEMP_PREFIX));
    chmodSync(stagingDir, CONSTANTS.CREDS_DIR_MODE);

    const uid = resolveUid(this.runAs);
    const gid = resolveGid(this.runAs);

    if (uid !== undefined && gid !== undefined) {
      try { chownSync(stagingDir, uid, gid); } catch { /* non-root */ }
    }

    const bundle: CredentialBundle = {};
    const backend = getDefaultBackend();

    for (const credRef of credRefs) {
      const { type, instance } = parseCredentialRef(credRef);
      const fields = await backend.readAll(type, instance);
      if (!fields) continue;

      const typeDir = join(stagingDir, type);
      const dstDir = join(typeDir, instance);
      mkdirSync(dstDir, { recursive: true, mode: CONSTANTS.CREDS_DIR_MODE });

      if (uid !== undefined && gid !== undefined) {
        try {
          chownSync(typeDir, uid, gid);
          chownSync(dstDir, uid, gid);
        } catch { /* non-root */ }
      }

      if (!bundle[type]) bundle[type] = {};
      bundle[type][instance] = {};

      for (const [field, value] of Object.entries(fields)) {
        try {
          const filePath = join(dstDir, field);
          writeFileSync(filePath, value + "\n", { mode: CONSTANTS.CREDS_FILE_MODE });

          if (uid !== undefined && gid !== undefined) {
            try { chownSync(filePath, uid, gid); } catch { /* non-root */ }
          }

          bundle[type][instance][field] = value;
        } catch {
          // Skip unwritable fields
        }
      }
    }

    return { strategy: "host-user", stagingDir, bundle };
  }

  cleanupCredentials(creds: RuntimeCredentials): void {
    try {
      rmSync(creds.stagingDir, { recursive: true, force: true });
    } catch { /* best effort */ }
  }

  async launch(opts: RuntimeLaunchOpts): Promise<string> {
    const runId = `al-${opts.agentName}-${randomUUID().slice(0, 8)}`;

    // Ensure runs directory exists
    mkdirSync(RUNS_DIR, { recursive: true });

    // Create working directory
    const workDir = join(RUNS_DIR, runId);
    mkdirSync(workDir, { recursive: true, mode: 0o755 });

    const uid = resolveUid(this.runAs);
    const gid = resolveGid(this.runAs);
    if (uid !== undefined && gid !== undefined) {
      try { chownSync(workDir, uid, gid); } catch { /* non-root */ }
    }

    // Create log file — child writes directly to this fd so output survives
    // scheduler restarts. streamLogs() tails this file using fs.watch().
    const logPath = join(RUNS_DIR, `${runId}.log`);
    const logFd = openSync(logPath, "a");

    // Build env vars for the child process
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...opts.env,
      AL_CREDENTIALS_PATH: opts.credentials.stagingDir,
      AL_WORK_DIR: workDir,
      AL_INSTANCE_ID: runId,
    };

    // Find the `al` binary path
    const alBin = process.argv[1] || "al";

    // Spawn: sudo -u <runAs> <al> _run-agent <agentName>
    const proc = spawn("sudo", [
      "-u", this.runAs,
      "--preserve-env=AL_CREDENTIALS_PATH,AL_WORK_DIR,AL_INSTANCE_ID,PROMPT,GATEWAY_URL,SHUTDOWN_SECRET,OTEL_TRACE_PARENT,OTEL_EXPORTER_OTLP_ENDPOINT,PATH,HOME",
      alBin, "_run-agent", opts.agentName,
      "--project", process.cwd(),
    ], {
      stdio: ["ignore", logFd, logFd],
      env,
      cwd: workDir,
    });

    // Close the fd in the parent — child has its own copy
    closeSync(logFd);

    this.processes.set(runId, proc as unknown as ProcessHandle);
    this.runAgentNames.set(runId, opts.agentName);

    // Write PID file for orphan recovery across scheduler restarts
    if (proc.pid) {
      writePidFile(runId, {
        pid: proc.pid,
        agentName: opts.agentName,
        env: {
          ...(opts.env.SHUTDOWN_SECRET ? { SHUTDOWN_SECRET: opts.env.SHUTDOWN_SECRET } : {}),
          ...(opts.env.GATEWAY_URL ? { GATEWAY_URL: opts.env.GATEWAY_URL } : {}),
          AL_CREDENTIALS_PATH: opts.credentials.stagingDir,
        },
        startedAt: new Date().toISOString(),
      });
    }

    // Clean up tracking on exit
    proc.on("exit", () => {
      this.processes.delete(runId);
      this.runAgentNames.delete(runId);
      removePidFile(runId);
    });

    return runId;
  }

  /**
   * Re-attach to an orphaned process from a previous scheduler session.
   * Reads the PID file and reconstructs in-memory state so that streamLogs,
   * waitForExit, and kill all work through the same code path as launch().
   */
  reattach(runId: string): boolean {
    if (this.processes.has(runId)) return true;

    const data = readPidFile(runId);
    if (!data || !isProcessAlive(data.pid)) return false;

    const orphan = new OrphanProcess(data.pid);
    this.processes.set(runId, orphan);
    this.runAgentNames.set(runId, data.agentName);

    orphan.on("exit", () => {
      orphan.stop();
      this.processes.delete(runId);
      this.runAgentNames.delete(runId);
      removePidFile(runId);
    });

    return true;
  }

  streamLogs(
    runId: string,
    onLine: (line: string) => void,
    _onStderr?: (text: string) => void,
  ): { stop: () => void } {
    const logPath = join(RUNS_DIR, `${runId}.log`);
    if (!existsSync(logPath)) return { stop: () => {} };

    let offset = 0;
    let lineBuffer = "";
    let stopped = false;

    const readNewData = () => {
      if (stopped) return;
      try {
        const size = statSync(logPath).size;
        if (size <= offset) return;
        const buf = Buffer.alloc(size - offset);
        const fd = openSync(logPath, "r");
        try {
          readSync(fd, buf, 0, buf.length, offset);
        } finally {
          closeSync(fd);
        }
        offset = size;

        lineBuffer += buf.toString();
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() || "";
        for (const line of lines) {
          onLine(line);
        }
      } catch { /* file may have been removed */ }
    };

    // Read existing content, then watch for new writes (inotify/kqueue)
    readNewData();

    let watcher: FSWatcher | null = null;
    try {
      watcher = watch(logPath, () => readNewData());
    } catch { /* watch may fail on some filesystems */ }

    return {
      stop: () => {
        stopped = true;
        if (watcher) { watcher.close(); watcher = null; }
        if (lineBuffer.trim()) {
          onLine(lineBuffer);
          lineBuffer = "";
        }
      },
    };
  }

  waitForExit(runId: string, timeoutSeconds: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const proc = this.processes.get(runId);
      if (!proc) {
        resolve(1);
        return;
      }

      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        // Escalate to SIGKILL after 5s grace period
        setTimeout(() => {
          if (this.processes.has(runId)) {
            proc.kill("SIGKILL");
          }
        }, 5000);
        reject(new Error(`Agent ${runId} timed out after ${timeoutSeconds}s`));
      }, timeoutSeconds * 1000);

      proc.on("exit", (code: number | null) => {
        clearTimeout(timer);
        resolve(code ?? 1);
      });

      proc.on("error", (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async kill(runId: string): Promise<void> {
    const proc = this.processes.get(runId);
    if (proc) {
      proc.kill("SIGTERM");
      // Escalate after grace period
      setTimeout(() => {
        if (this.processes.has(runId)) {
          proc.kill("SIGKILL");
        }
      }, 5000);
      return;
    }

    // Not tracked — try PID file as last resort (e.g. kill called before reattach)
    const data = readPidFile(runId);
    if (data && isProcessAlive(data.pid)) {
      try {
        process.kill(data.pid, "SIGTERM");
        setTimeout(() => {
          try {
            if (isProcessAlive(data.pid)) {
              process.kill(data.pid, "SIGKILL");
            }
          } catch { /* process may have exited */ }
          removePidFile(runId);
        }, 5000);
      } catch { /* process may have exited */ }
    } else {
      removePidFile(runId);
    }
  }

  async remove(runId: string): Promise<void> {
    // Clean up working directory and PID file
    const workDir = join(RUNS_DIR, runId);
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch { /* best effort */ }
    removePidFile(runId);
  }

  async fetchLogs(agentName: string, limit: number): Promise<string[]> {
    // Read from log files in RUNS_DIR matching this agent
    try {
      if (!existsSync(RUNS_DIR)) return [];
      const files = readdirSync(RUNS_DIR)
        .filter(f => f.startsWith(`al-${agentName}-`) && f.endsWith(".log"))
        .sort()
        .reverse();

      const allLines: string[] = [];
      for (const file of files) {
        if (allLines.length >= limit) break;
        try {
          const content = readFileSync(join(RUNS_DIR, file), "utf-8");
          allLines.push(...content.split("\n").filter(Boolean));
        } catch { /* file may be gone */ }
      }
      return allLines.slice(-limit);
    } catch {
      return [];
    }
  }

  followLogs(
    _agentName: string,
    _onLine: (line: string) => void,
    _onStderr?: (text: string) => void,
  ): { stop: () => void } {
    // Follow is handled by the live process stream in streamLogs
    return { stop: () => {} };
  }

  getTaskUrl(): string | null {
    return null;
  }

  async inspectContainer(runId: string): Promise<{ env: Record<string, string> } | null> {
    const data = readPidFile(runId);
    if (!data) return null;
    if (!isProcessAlive(data.pid)) {
      removePidFile(runId);
      return null;
    }
    return { env: data.env };
  }

  /** Terminate all tracked child processes (called during graceful shutdown). */
  async shutdown(): Promise<void> {
    for (const [, proc] of this.processes) {
      try { proc.kill("SIGTERM"); } catch { /* best effort */ }
    }
  }
}
