import { execFile as execFileCb, spawn } from "child_process";
import { promisify } from "util";
import type { ServerConfig } from "../shared/server.js";

const execFile = promisify(execFileCb);

export interface SshOptions {
  host: string;
  user: string;
  port: number;
  keyPath?: string;
}

export function sshOptionsFromConfig(config: ServerConfig): SshOptions {
  return {
    host: config.host,
    user: config.user ?? "root",
    port: config.port ?? 22,
    keyPath: config.keyPath,
  };
}

/**
 * Build the common SSH argument array (user@host, port, key, strict host checking off).
 */
export function buildSshArgs(opts: SshOptions): string[] {
  const args: string[] = [
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "BatchMode=yes",
    "-p", String(opts.port),
  ];
  if (opts.keyPath) {
    args.push("-i", opts.keyPath);
  }
  args.push(`${opts.user}@${opts.host}`);
  return args;
}

/**
 * Execute a command on the remote server via SSH.
 * Returns stdout on success, throws on non-zero exit.
 */
export async function sshExec(opts: SshOptions, command: string): Promise<string> {
  const args = buildSshArgs(opts);
  args.push(command);
  const { stdout } = await execFile("ssh", args, { maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

/**
 * Rsync a local path to a remote path.
 */
export async function rsyncTo(
  opts: SshOptions,
  localPath: string,
  remotePath: string,
  excludes?: string[],
  extraFlags?: string[],
): Promise<void> {
  const sshCmd = [
    "ssh",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "BatchMode=yes",
    "-p", String(opts.port),
    ...(opts.keyPath ? ["-i", opts.keyPath] : []),
  ].join(" ");

  const args: string[] = [
    "-az", "--delete",
    "-e", sshCmd,
  ];

  if (excludes) {
    for (const ex of excludes) {
      args.push("--exclude", ex);
    }
  }
  if (extraFlags) {
    args.push(...extraFlags);
  }

  // Ensure localPath ends with / so rsync copies contents, not the directory itself
  const src = localPath.endsWith("/") ? localPath : `${localPath}/`;
  args.push(src, `${opts.user}@${opts.host}:${remotePath}`);

  await execFile("rsync", args, { maxBuffer: 10 * 1024 * 1024 });
}

/**
 * Spawn an SSH command as a long-running child process (for streaming output).
 * Returns the ChildProcess — caller is responsible for killing it.
 */
export function sshSpawn(opts: SshOptions, command: string) {
  const args = buildSshArgs(opts);
  args.push(command);
  return spawn("ssh", args, { stdio: ["ignore", "pipe", "pipe"] });
}
