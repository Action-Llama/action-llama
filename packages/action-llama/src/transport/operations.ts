/**
 * Transport operations — adapts a Transport into Pi's pluggable operations interfaces.
 *
 * Each Pi tool (bash, read, write, edit, grep, find, ls) accepts a custom operations
 * object that replaces the default local filesystem/shell behavior. This module creates
 * those operations objects backed by a Transport, so tools execute remotely.
 *
 * Usage:
 *   const transport = new DockerExecTransport({ container: "my-container" });
 *   await transport.connect();
 *   const tools = createTransportTools(transport, "/workspace");
 */

import {
  createBashTool,
  createReadTool,
  createWriteTool,
  createEditTool,
  createGrepTool,
  createFindTool,
  createLsTool,
  type BashOperations,
  type ReadOperations,
  type WriteOperations,
  type EditOperations,
  type GrepOperations,
  type FindOperations,
  type LsOperations,
} from "@mariozechner/pi-coding-agent";
import type { Transport } from "./transport.js";
import { readFile } from "./transport.js";

/**
 * Create BashOperations that execute commands via the transport.
 * The transport maintains a persistent shell, so cwd and env persist across calls.
 */
export function createTransportBashOps(transport: Transport): BashOperations {
  return {
    async exec(command, cwd, options) {
      // Pi's bash tool passes the cwd for each invocation. Since our transport
      // shell is persistent, we cd to the requested cwd before running the command.
      // We wrap in a subshell-like approach: cd first, then run.
      const fullCommand = `cd ${shellQuote(cwd)} && ${command}`;

      const result = await transport.exec(fullCommand, {
        onData: options.onData,
        signal: options.signal,
        timeout: options.timeout,
      });

      return { exitCode: result.exitCode };
    },
  };
}

/** Create ReadOperations that read files via the transport. */
export function createTransportReadOps(transport: Transport): ReadOperations {
  return {
    async readFile(absolutePath: string): Promise<Buffer> {
      return readFile(transport, absolutePath);
    },

    async access(absolutePath: string): Promise<void> {
      // Check if the file exists and is readable by running a test command
      const result = await transport.exec(`test -r ${shellQuote(absolutePath)}`);
      if (result.exitCode !== 0) {
        throw new Error(`ENOENT: no such file or directory, access '${absolutePath}'`);
      }
    },
  };
}

/** Create WriteOperations that write files via the transport. */
export function createTransportWriteOps(transport: Transport): WriteOperations {
  return {
    async writeFile(absolutePath: string, content: string): Promise<void> {
      const files = new Map<string, Buffer>();
      files.set(absolutePath, Buffer.from(content, "utf-8"));
      await transport.writeFiles(files);
    },

    async mkdir(dir: string): Promise<void> {
      await transport.exec(`mkdir -p ${shellQuote(dir)}`);
    },
  };
}

/** Create EditOperations that edit files via the transport (read + write). */
export function createTransportEditOps(transport: Transport): EditOperations {
  return {
    async readFile(absolutePath: string): Promise<Buffer> {
      return readFile(transport, absolutePath);
    },

    async writeFile(absolutePath: string, content: string): Promise<void> {
      const files = new Map<string, Buffer>();
      files.set(absolutePath, Buffer.from(content, "utf-8"));
      await transport.writeFiles(files);
    },

    async access(absolutePath: string): Promise<void> {
      const result = await transport.exec(`test -r ${shellQuote(absolutePath)} && test -w ${shellQuote(absolutePath)}`);
      if (result.exitCode !== 0) {
        throw new Error(`EACCES: permission denied, access '${absolutePath}'`);
      }
    },
  };
}

/** Create GrepOperations that check paths and read files via the transport. */
export function createTransportGrepOps(transport: Transport): GrepOperations {
  return {
    async isDirectory(absolutePath: string): Promise<boolean> {
      const result = await transport.exec(`test -d ${shellQuote(absolutePath)}`);
      return result.exitCode === 0;
    },

    async readFile(absolutePath: string): Promise<string> {
      const content = await readFile(transport, absolutePath);
      return content.toString("utf-8");
    },
  };
}

/** Create FindOperations that search for files via the transport. */
export function createTransportFindOps(transport: Transport): FindOperations {
  return {
    async exists(absolutePath: string): Promise<boolean> {
      const result = await transport.exec(`test -e ${shellQuote(absolutePath)}`);
      return result.exitCode === 0;
    },

    async glob(pattern: string, cwd: string, options: { ignore: string[]; limit: number }): Promise<string[]> {
      // Use find with -name for glob matching, or fd if available
      // The Pi find tool will handle the glob pattern translation
      const ignoreArgs = options.ignore
        .map(p => `-not -path ${shellQuote(p)}`)
        .join(" ");
      const cmd = `cd ${shellQuote(cwd)} && find . -name ${shellQuote(pattern)} ${ignoreArgs} -type f 2>/dev/null | head -n ${options.limit}`;
      const result = await transport.exec(cmd);
      if (result.exitCode !== 0 || !result.stdout.trim()) {
        return [];
      }
      return result.stdout.trim().split("\n").filter(Boolean);
    },
  };
}

/** Create LsOperations that list directories via the transport. */
export function createTransportLsOps(transport: Transport): LsOperations {
  return {
    async exists(absolutePath: string): Promise<boolean> {
      const result = await transport.exec(`test -e ${shellQuote(absolutePath)}`);
      return result.exitCode === 0;
    },

    async stat(absolutePath: string): Promise<{ isDirectory: () => boolean }> {
      const result = await transport.exec(`test -d ${shellQuote(absolutePath)}`);
      const isDir = result.exitCode === 0;
      return { isDirectory: () => isDir };
    },

    async readdir(absolutePath: string): Promise<string[]> {
      const result = await transport.exec(`ls -1 ${shellQuote(absolutePath)}`);
      if (result.exitCode !== 0) {
        throw new Error(`ENOENT: no such file or directory, readdir '${absolutePath}'`);
      }
      return result.stdout.trim().split("\n").filter(Boolean);
    },
  };
}

/**
 * Create all Pi coding tools backed by a transport.
 * These tools have the same interface as local tools but execute remotely.
 */
export function createTransportTools(transport: Transport, cwd: string) {
  const bashOps = createTransportBashOps(transport);
  const readOps = createTransportReadOps(transport);
  const writeOps = createTransportWriteOps(transport);
  const editOps = createTransportEditOps(transport);
  const grepOps = createTransportGrepOps(transport);
  const findOps = createTransportFindOps(transport);
  const lsOps = createTransportLsOps(transport);

  return [
    createReadTool(cwd, { operations: readOps }),
    createBashTool(cwd, { operations: bashOps }),
    createEditTool(cwd, { operations: editOps }),
    createWriteTool(cwd, { operations: writeOps }),
    createGrepTool(cwd, { operations: grepOps }),
    createFindTool(cwd, { operations: findOps }),
    createLsTool(cwd, { operations: lsOps }),
  ];
}

/** Escape a string for use in a shell command. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
