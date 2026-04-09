/**
 * Process helpers — spawn `al` commands and manage child processes.
 */

import { spawn, execFile, type ChildProcess } from "child_process";
import { resolve } from "path";
import type { TestProject } from "./project-factory.js";

// Resolve the `al` binary from the built package
const AL_BIN = resolve(
  import.meta.dirname ?? new URL(".", import.meta.url).pathname,
  "../../../action-llama/dist/cli/main.js",
);

export interface AlProcess {
  pid: number;
  readonly stdout: string;
  readonly stderr: string;
  exitCode: number | null;
  kill(signal?: NodeJS.Signals): void;
  waitForExit(timeoutMs?: number): Promise<number>;
  waitForOutput(pattern: string | RegExp, timeoutMs?: number): Promise<void>;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run an `al` command and wait for completion.
 */
export async function alExec(
  args: string[],
  project: TestProject,
  opts?: { env?: Record<string, string>; timeout?: number; skipProjectArg?: boolean },
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      ...opts?.env,
      AL_CREDENTIALS_DIR: `${project.dir}/.al-credentials`,
    };

    const fullArgs = opts?.skipProjectArg
      ? [AL_BIN, ...args]
      : [AL_BIN, ...args, "--project", project.dir];

    execFile(
      process.execPath,
      fullArgs,
      {
        cwd: project.dir,
        env,
        timeout: opts?.timeout ?? 30_000,
      },
      (err, stdout, stderr) => {
        const exitCode = err && "code" in err ? (err as any).code ?? 1 : err ? 1 : 0;
        resolve({ stdout, stderr, exitCode });
      },
    );
  });
}

/**
 * Start a long-running `al` command (e.g. `al start`).
 * Returns an AlProcess handle for monitoring and control.
 */
export function alSpawn(
  args: string[],
  project: TestProject,
  opts?: { env?: Record<string, string>; coverageDir?: string },
): AlProcess {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...opts?.env,
    AL_CREDENTIALS_DIR: `${project.dir}/.al-credentials`,
  };

  if (opts?.coverageDir) {
    env.NODE_V8_COVERAGE = opts.coverageDir;
  }

  const child = spawn(
    process.execPath,
    [AL_BIN, ...args, "--project", project.dir],
    {
      cwd: project.dir,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;

  child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
  child.on("exit", (code) => { exitCode = code; });

  const handle: AlProcess = {
    get pid() { return child.pid ?? 0; },
    get stdout() { return stdout; },
    get stderr() { return stderr; },
    get exitCode() { return exitCode; },
    set exitCode(v) { exitCode = v; },

    kill(signal: NodeJS.Signals = "SIGTERM") {
      if (child.pid && exitCode === null) {
        child.kill(signal);
      }
    },

    async waitForExit(timeoutMs = 30_000): Promise<number> {
      if (exitCode !== null) return exitCode;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`al process did not exit within ${timeoutMs}ms`));
        }, timeoutMs);

        child.on("exit", (code) => {
          clearTimeout(timer);
          resolve(code ?? 1);
        });
      });
    },

    async waitForOutput(pattern: string | RegExp, timeoutMs = 30_000): Promise<void> {
      const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        if (regex.test(stdout) || regex.test(stderr)) return;
        await new Promise((r) => setTimeout(r, 100));
      }

      throw new Error(
        `Timed out waiting for output matching ${pattern}.\n` +
        `stdout: ${stdout.slice(-500)}\nstderr: ${stderr.slice(-500)}`,
      );
    },
  };

  return handle;
}

/**
 * Wait for a scheduler to be healthy by polling the health endpoint.
 */
export async function waitForHealthy(port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      // Connection refused — keep polling
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  throw new Error(`Scheduler health check failed after ${timeoutMs}ms on port ${port}`);
}

/**
 * Make an authenticated HTTP request to the control API.
 */
export async function controlRequest(
  method: string,
  path: string,
  port: number,
  apiKey: string,
  body?: unknown,
): Promise<{ status: number; data: any }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data: any;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  return { status: res.status, data };
}
