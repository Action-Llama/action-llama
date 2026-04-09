/**
 * Transport — the abstraction layer between the scheduler (brain) and runtime (body).
 *
 * A transport provides a persistent connection to a runtime environment (container, VM,
 * OS user) through which the scheduler can execute commands and transfer files. The agent
 * (LLM) doesn't know about the transport — it sees standard tools (bash, read, write, edit)
 * that happen to execute remotely.
 *
 * Transport implementations:
 *  - DockerExecTransport — local Docker via `docker exec`
 *  - SshTransport — remote VMs via SSH (future)
 *  - HostUserTransport — local OS user via `sudo -u` (future)
 */

/** Result of executing a command on the runtime. */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/** Options for command execution. */
export interface ExecOptions {
  /** Callback for streaming stdout data as it arrives. */
  onData?: (data: Buffer) => void;
  /** AbortSignal to cancel execution. */
  signal?: AbortSignal;
  /** Timeout in milliseconds. */
  timeout?: number;
}

/**
 * Transport interface — the contract all transport implementations must satisfy.
 *
 * Provides two channels:
 *  1. A persistent shell session for command execution (exec)
 *  2. A file transfer mechanism for reading/writing files (readFiles/writeFiles)
 */
export interface Transport {
  /** Open / reconnect the transport session. */
  connect(): Promise<void>;

  /**
   * Execute a command in the persistent shell session.
   * Shell state (cwd, env vars) persists across calls.
   */
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;

  /**
   * Read multiple files from the runtime in a single batch.
   * Returns a map of path → contents. Missing files are omitted from the result.
   */
  readFiles(paths: string[]): Promise<Map<string, Buffer>>;

  /**
   * Write multiple files to the runtime in a single batch.
   * Creates parent directories as needed.
   */
  writeFiles(files: Map<string, Buffer>): Promise<void>;

  /** Close the transport connection and release resources. */
  close(): Promise<void>;
}

/** Convenience: read a single file via the transport. */
export async function readFile(transport: Transport, path: string): Promise<Buffer> {
  const result = await transport.readFiles([path]);
  const content = result.get(path);
  if (!content) {
    throw new Error(`File not found: ${path}`);
  }
  return content;
}

/** Convenience: write a single file via the transport. */
export async function writeFile(transport: Transport, path: string, content: Buffer): Promise<void> {
  const files = new Map<string, Buffer>();
  files.set(path, content);
  await transport.writeFiles(files);
}
