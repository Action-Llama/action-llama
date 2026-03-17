/**
 * SSH helper module for VPS operations.
 * Wraps ssh/scp commands with consistent options.
 */

import { execFile, spawn, type ChildProcess } from "child_process";
import { homedir } from "os";

export interface SshConfig {
  host: string;
  user: string;
  port: number;
  keyPath: string;
}

export interface SshExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Resolve ~ in key path to the home directory */
function resolveKeyPath(keyPath: string): string {
  if (keyPath.startsWith("~/")) {
    return keyPath.replace("~", homedir());
  }
  return keyPath;
}

/** Common SSH options for non-interactive, secure connections */
function sshOpts(config: SshConfig): string[] {
  return [
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-p", String(config.port),
    "-i", resolveKeyPath(config.keyPath),
  ];
}

/** SSH destination string (user@host) */
function dest(config: SshConfig): string {
  return `${config.user}@${config.host}`;
}

/**
 * Execute a command on the remote host and return the result.
 * Rejects if the process fails to spawn; resolves with exitCode otherwise.
 */
export function sshExec(config: SshConfig, command: string, timeoutMs = 30_000): Promise<SshExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "ssh",
      [...sshOpts(config), dest(config), command],
      { encoding: "utf-8", timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (error && !("code" in error)) {
          reject(error);
          return;
        }
        resolve({
          stdout: stdout?.trim() ?? "",
          stderr: stderr?.trim() ?? "",
          exitCode: (error as any)?.code ?? 0,
        });
      },
    );
  });
}

/**
 * Spawn a long-running SSH command with streaming output.
 * Returns the ChildProcess handle.
 */
export function sshSpawn(config: SshConfig, command: string): ChildProcess {
  return spawn("ssh", [...sshOpts(config), dest(config), command], {
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/**
 * Copy a local file to the remote host via scp.
 */
export function scp(config: SshConfig, localPath: string, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "scp",
      [
        ...sshOpts(config),
        localPath,
        `${dest(config)}:${remotePath}`,
      ],
      { encoding: "utf-8", timeout: 60_000 },
      (error) => {
        if (error) reject(error);
        else resolve();
      },
    );
  });
}

/**
 * Write data to a remote file by piping through SSH.
 */
export function scpBuffer(config: SshConfig, data: Buffer | string, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const dir = remotePath.substring(0, remotePath.lastIndexOf("/"));
    const proc = spawn("ssh", [
      ...sshOpts(config),
      dest(config),
      `mkdir -p '${dir}' && cat > '${remotePath}' && chmod 600 '${remotePath}'`,
    ], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`scpBuffer failed (exit ${code}): ${stderr}`));
    });

    proc.on("error", reject);
    proc.stdin.end(data);
  });
}

/**
 * Test SSH connectivity to the remote host.
 */
export async function testConnection(config: SshConfig): Promise<boolean> {
  try {
    const result = await sshExec(config, "echo ok", 15_000);
    return result.exitCode === 0 && result.stdout.includes("ok");
  } catch {
    return false;
  }
}
