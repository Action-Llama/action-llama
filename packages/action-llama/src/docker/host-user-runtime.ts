/**
 * HostUserRuntime — runs agents as a separate OS user via `sudo -u`.
 *
 * Provides lightweight isolation without Docker:
 *  - Agent process runs as a dedicated OS user (can't access operator credentials)
 *  - Credentials staged to a temp dir, path passed via AL_CREDENTIALS_PATH
 *  - Working directory: /tmp/al-runs/<instance-id>/ (chowned to agent user)
 *  - Logs written to /tmp/al-runs/<instance-id>.log (owned by scheduler)
 *  - No image builds, no containers, no Docker dependency
 */

import { spawn, execFileSync, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync,
  chownSync, readFileSync, existsSync, createWriteStream,
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

interface LogStreamState {
  stdoutBuffer: string;
  stderrBuffer: string;
  bufferedLines: string[];
  bufferedStderr: string[];
  onLine: ((line: string) => void) | null;
  onStderr: ((text: string) => void) | null;
}

export class HostUserRuntime implements Runtime {
  readonly needsGateway = false;

  private runAs: string;
  private processes = new Map<string, ChildProcess>();
  private runAgentNames = new Map<string, string>();
  private logStreams = new Map<string, LogStreamState>();

  constructor(runAs: string = "al-agent") {
    this.runAs = runAs;
  }

  async isAgentRunning(agentName: string): Promise<boolean> {
    for (const [, name] of this.runAgentNames) {
      if (name === agentName) return true;
    }
    return false;
  }

  async listRunningAgents(): Promise<RunningAgent[]> {
    const agents: RunningAgent[] = [];
    for (const [runId, agentName] of this.runAgentNames) {
      if (this.processes.has(runId)) {
        agents.push({
          agentName,
          taskId: runId,
          runtimeId: runId,
          status: "running",
        });
      }
    }
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

    // Create log file (owned by scheduler user, not agent user)
    const logPath = join(RUNS_DIR, `${runId}.log`);
    const logStream = createWriteStream(logPath, { flags: "a" });

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
      stdio: ["ignore", "pipe", "pipe"],
      env,
      cwd: workDir,
    });

    // Set up buffering stream state — captures all output from process start,
    // so streamLogs() can flush buffered lines without any data loss.
    const streamState: LogStreamState = {
      stdoutBuffer: "",
      stderrBuffer: "",
      bufferedLines: [],
      bufferedStderr: [],
      onLine: null,
      onStderr: null,
    };

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      // Always write raw data to the run log file
      logStream.write(text);
      // Assemble complete lines and forward or buffer them
      streamState.stdoutBuffer += text;
      const lines = streamState.stdoutBuffer.split("\n");
      streamState.stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        if (streamState.onLine) {
          streamState.onLine(line);
        } else {
          streamState.bufferedLines.push(line);
        }
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      logStream.write(text);
      const trimmed = text.trim();
      if (trimmed) {
        if (streamState.onStderr) {
          streamState.onStderr(trimmed);
        } else {
          streamState.bufferedStderr.push(trimmed);
        }
      }
    });

    this.logStreams.set(runId, streamState);
    this.processes.set(runId, proc);
    this.runAgentNames.set(runId, opts.agentName);

    // Clean up tracking on exit
    proc.on("exit", () => {
      // Flush any remaining partial stdout line
      if (streamState.stdoutBuffer.trim()) {
        if (streamState.onLine) {
          streamState.onLine(streamState.stdoutBuffer);
        } else {
          streamState.bufferedLines.push(streamState.stdoutBuffer);
        }
        streamState.stdoutBuffer = "";
      }
      logStream.end();
      this.processes.delete(runId);
      this.runAgentNames.delete(runId);
      this.logStreams.delete(runId);
    });

    return runId;
  }

  streamLogs(
    runId: string,
    onLine: (line: string) => void,
    onStderr?: (text: string) => void,
  ): { stop: () => void } {
    const proc = this.processes.get(runId);
    if (!proc) return { stop: () => {} };

    const streamState = this.logStreams.get(runId);
    if (!streamState) return { stop: () => {} };

    // Flush lines buffered between launch() and now (no data loss)
    for (const line of streamState.bufferedLines) {
      onLine(line);
    }
    streamState.bufferedLines.length = 0;

    for (const text of streamState.bufferedStderr) {
      if (onStderr) onStderr(text);
    }
    streamState.bufferedStderr.length = 0;

    // Forward all future lines through the callbacks
    streamState.onLine = onLine;
    streamState.onStderr = onStderr ?? null;

    return {
      stop: () => {
        streamState.onLine = null;
        streamState.onStderr = null;
        if (streamState.stdoutBuffer.trim()) {
          onLine(streamState.stdoutBuffer);
          streamState.stdoutBuffer = "";
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

      proc.on("exit", (code) => {
        clearTimeout(timer);
        resolve(code ?? 1);
      });

      proc.on("error", (err) => {
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
    }
  }

  async remove(runId: string): Promise<void> {
    // Clean up working directory
    const workDir = join(RUNS_DIR, runId);
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch { /* best effort */ }
  }

  async fetchLogs(agentName: string, limit: number): Promise<string[]> {
    // Read from log files in RUNS_DIR matching this agent
    try {
      if (!existsSync(RUNS_DIR)) return [];
      const { readdirSync } = await import("fs");
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

  async inspectContainer(): Promise<null> {
    return null;
  }
}
