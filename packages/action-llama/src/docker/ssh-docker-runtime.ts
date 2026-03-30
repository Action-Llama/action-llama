/**
 * SshDockerRuntime — ContainerRuntime that wraps Docker commands in SSH calls.
 * Used for VPS deployments where Docker runs on a remote server.
 */

import { randomUUID } from "crypto";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join, isAbsolute, resolve, dirname } from "path";
import { tmpdir } from "os";
import { spawn } from "child_process";
import type {
  Runtime,
  ContainerRuntime,
  RuntimeLaunchOpts,
  RuntimeCredentials,
  CredentialBundle,
  BuildImageOpts,
  RunningAgent,
} from "./runtime.js";
import { sshExec, sshSpawn, scpBuffer, type SshConfig } from "../cloud/vps/ssh.js";
import { CONSTANTS, VERSION, GIT_SHA } from "../shared/constants.js";
import { VPS_CONSTANTS } from "../cloud/vps/constants.js";

/** Run a docker command on the remote host and return stdout */
async function remoteDocker(config: SshConfig, ...args: string[]): Promise<string> {
  // Shell-escape arguments for SSH
  const escaped = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
  const result = await sshExec(config, `docker ${escaped}`);
  if (result.exitCode !== 0) {
    throw new Error(`Remote docker ${args[0]} failed (exit ${result.exitCode}): ${result.stderr}`);
  }
  return result.stdout;
}

export class SshDockerRuntime implements Runtime, ContainerRuntime {
  readonly needsGateway = false; // scheduler runs on the same VPS

  private sshConfig: SshConfig;

  constructor(sshConfig: SshConfig) {
    this.sshConfig = sshConfig;
  }

  async isAgentRunning(agentName: string): Promise<boolean> {
    try {
      const out = await remoteDocker(
        this.sshConfig,
        "ps", "--filter", `name=al-${agentName}-`, "--format", "{{.Names}}",
      );
      return out.length > 0;
    } catch {
      return false;
    }
  }

  async listRunningAgents(): Promise<RunningAgent[]> {
    try {
      const out = await remoteDocker(
        this.sshConfig,
        "ps", "--filter", `name=${CONSTANTS.CONTAINER_FILTER}`, "--format", "{{.Names}}\t{{.Status}}\t{{.CreatedAt}}",
      );
      if (!out) return [];
      return out.split("\n").filter(Boolean).map((line) => {
        const [name, status, createdAt] = line.split("\t");
        const parts = name.split("-");
        const agentName = parts.slice(1, -1).join("-");
        return {
          agentName,
          taskId: name,
          runtimeId: name,
          status: status ?? "unknown",
          startedAt: createdAt ? new Date(createdAt) : undefined,
        };
      });
    } catch {
      return [];
    }
  }

  async prepareCredentials(credRefs: string[]): Promise<RuntimeCredentials> {
    // Stage credentials locally, then scp them to the VPS
    const { parseCredentialRef, getDefaultBackend } = await import("../shared/credentials.js");
    const backend = getDefaultBackend();
    const bundle: CredentialBundle = {};

    const remoteDir = `/tmp/al-creds-${randomUUID().slice(0, 8)}`;
    await sshExec(this.sshConfig, `mkdir -p '${remoteDir}'`);

    for (const credRef of credRefs) {
      const { type, instance } = parseCredentialRef(credRef);
      const fields = await backend.readAll(type, instance);
      if (!fields) continue;

      if (!bundle[type]) bundle[type] = {};
      bundle[type][instance] = {};

      for (const [field, value] of Object.entries(fields)) {
        const remotePath = `${remoteDir}/${type}/${instance}/${field}`;
        await scpBuffer(this.sshConfig, value + "\n", remotePath);
        bundle[type][instance][field] = value;
      }
    }

    // Set ownership to container UID/GID so the non-root container user can read
    const { CONSTANTS } = await import("../shared/constants.js");
    await sshExec(this.sshConfig, `chown -R ${CONSTANTS.CONTAINER_UID}:${CONSTANTS.CONTAINER_GID} '${remoteDir}'`);

    return { strategy: "volume", stagingDir: remoteDir, bundle };
  }

  cleanupCredentials(creds: RuntimeCredentials): void {
    if (creds.strategy === "volume") {
      // Best-effort remote cleanup
      sshExec(this.sshConfig, `rm -rf '${creds.stagingDir}'`).catch(() => {});
    }
  }

  async buildImage(opts: BuildImageOpts): Promise<string> {
    opts.onProgress?.("Building image on VPS via SSH");

    // 1. Resolve Dockerfile content
    let content: string;
    if (opts.dockerfileContent) {
      content = opts.dockerfileContent;
    } else {
      const src = isAbsolute(opts.dockerfile)
        ? opts.dockerfile
        : resolve(opts.contextDir, opts.dockerfile);
      content = readFileSync(src, "utf-8");
    }

    if (opts.baseImage) {
      content = content.replace(/^FROM\s+\S+/m, `FROM ${opts.baseImage}`);
    }

    // 2. Inject COPY static/ when extra files are provided
    const hasExtraFiles = opts.extraFiles && Object.keys(opts.extraFiles).length > 0;
    if (hasExtraFiles && !content.includes("COPY static/ /app/static/")) {
      const copyLine = "COPY static/ /app/static/";
      const userIdx = content.indexOf("\nUSER ");
      if (userIdx !== -1) {
        content = content.slice(0, userIdx) + "\n" + copyLine + content.slice(userIdx);
      } else {
        content += "\n" + copyLine + "\n";
      }
    }

    // 3. Prepare local build context as tar, pipe to remote docker build
    const buildDir = mkdtempSync(join(tmpdir(), "al-ctx-"));

    try {
      writeFileSync(join(buildDir, "Dockerfile"), content);

      if (hasExtraFiles) {
        const staticDir = join(buildDir, "static");
        mkdirSync(staticDir, { recursive: true });
        for (const [filename, fileContent] of Object.entries(opts.extraFiles!)) {
          const filePath = join(staticDir, filename);
          mkdirSync(dirname(filePath), { recursive: true });
          writeFileSync(filePath, fileContent);
        }
      }

      // Copy non-Dockerfile context files if contextDir is different from buildDir
      // For generated Dockerfiles, buildDir IS the context
      if (!opts.dockerfileContent && !opts.baseImage && !hasExtraFiles) {
        // Direct context — tar the actual context dir
        await this.tarPipeBuild(opts.contextDir, opts.tag, opts);
      } else {
        await this.tarPipeBuild(buildDir, opts.tag, opts);
      }
    } finally {
      try {
        rmSync(buildDir, { recursive: true });
      } catch {}
    }

    return opts.tag;
  }

  private tarPipeBuild(contextDir: string, tag: string, opts: BuildImageOpts): Promise<void> {
    return new Promise((resolve, reject) => {
      // tar -C <dir> -c . | ssh docker build -t <tag> --build-arg ... -
      const tar = spawn("tar", ["-C", contextDir, "-c", "."], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, COPYFILE_DISABLE: "1" },
      });

      const sshArgs = [
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=10",
        "-p", String(this.sshConfig.port),
        "-i", this.sshConfig.keyPath.replace("~", process.env.HOME || ""),
        `${this.sshConfig.user}@${this.sshConfig.host}`,
        `docker build -t '${tag}' --build-arg 'GIT_SHA=${GIT_SHA}' --build-arg 'VERSION=${VERSION}' -`,
      ];

      const ssh = spawn("ssh", sshArgs, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      tar.stdout.pipe(ssh.stdin);

      let stderr = "";
      ssh.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        // Forward progress to callback
        for (const line of text.split("\n").filter(Boolean)) {
          opts.onProgress?.(line.trim());
        }
      });

      tar.on("error", reject);
      ssh.on("error", reject);

      const timer = setTimeout(() => {
        tar.kill();
        ssh.kill();
        reject(new Error("Remote docker build timed out after 300s"));
      }, 300_000);

      ssh.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`Remote docker build failed (exit ${code}):\n${stderr}`));
      });
    });
  }

  async pushImage(localImage: string): Promise<string> {
    // No registry — images are built directly on the VPS
    return localImage;
  }

  async launch(opts: RuntimeLaunchOpts): Promise<string> {
    const runId = randomUUID().slice(0, 8);
    const containerName = CONSTANTS.containerName(opts.agentName, runId);
    const memory = opts.memory || "4g";

    const args = [
      "run", "-d",
      "--name", containerName,
      "--user", "1000:1000",
      "--read-only",
      "--tmpfs", "/tmp:rw,exec,nosuid,uid=1000,gid=1000",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges:true",
      "--pids-limit", "256",
      "--memory", memory,
    ];

    if (opts.cpus) {
      args.push("--cpus", String(opts.cpus));
    }

    if (opts.credentials.strategy === "volume") {
      args.push("-v", `${opts.credentials.stagingDir}:/credentials:ro`);
    }

    for (const [key, value] of Object.entries(opts.env)) {
      args.push("-e", `${key}=${value}`);
    }

    args.push(opts.image);

    await remoteDocker(this.sshConfig, ...args);
    return containerName;
  }

  streamLogs(
    containerName: string,
    onLine: (line: string) => void,
    onStderr?: (text: string) => void,
  ): { stop: () => void } {
    const proc = sshSpawn(this.sshConfig, `docker logs -f '${containerName}'`);

    let buffer = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        onLine(line);
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text && onStderr) onStderr(text);
    });

    return {
      stop: () => {
        if (buffer.trim()) onLine(buffer);
        proc.kill();
      },
    };
  }

  async waitForExit(containerName: string, timeoutSeconds: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const proc = sshSpawn(this.sshConfig, `docker wait '${containerName}'`);

      let stdout = "";
      proc.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      const timer = setTimeout(() => {
        proc.kill();
        // Kill the container remotely
        sshExec(this.sshConfig, `docker kill '${containerName}'`).catch(() => {});
        reject(new Error(`Container ${containerName} timed out after ${timeoutSeconds}s`));
      }, timeoutSeconds * 1000);

      proc.on("close", () => {
        clearTimeout(timer);
        resolve(parseInt(stdout.trim(), 10));
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async kill(containerName: string): Promise<void> {
    try {
      await remoteDocker(this.sshConfig, "kill", containerName);
    } catch {
      // Container may already be dead
    }
  }

  async remove(containerName: string): Promise<void> {
    try {
      await remoteDocker(this.sshConfig, "rm", "-f", containerName);
    } catch {
      // Container may already be removed
    }
  }

  async fetchLogs(agentName: string, limit: number): Promise<string[]> {
    try {
      const names = await remoteDocker(
        this.sshConfig,
        "ps", "-a", "--filter", `name=al-${agentName}-`, "--format", "{{.Names}}",
      );
      if (!names) return [];

      const allLines: string[] = [];
      for (const name of names.split("\n").filter(Boolean)) {
        try {
          const out = await remoteDocker(this.sshConfig, "logs", "--tail", String(limit), name);
          allLines.push(...out.split("\n").filter(Boolean));
        } catch {
          // Container may have been removed
        }
      }
      return allLines.slice(-limit);
    } catch {
      return [];
    }
  }

  followLogs(
    agentName: string,
    onLine: (line: string) => void,
    onStderr?: (text: string) => void,
  ): { stop: () => void } {
    // Find latest container for this agent, then follow its logs
    let stopped = false;
    let currentProc: ReturnType<typeof sshSpawn> | undefined;

    const startFollowing = async () => {
      try {
        const names = await remoteDocker(
          this.sshConfig,
          "ps", "--filter", `name=al-${agentName}-`, "--format", "{{.Names}}",
        );
        const latest = names.split("\n").filter(Boolean)[0];
        if (!latest || stopped) return;

        currentProc = sshSpawn(this.sshConfig, `docker logs -f '${latest}'`);

        let buffer = "";
        currentProc.stdout?.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) onLine(line);
        });

        currentProc.stderr?.on("data", (chunk: Buffer) => {
          const text = chunk.toString().trim();
          if (text && onStderr) onStderr(text);
        });
      } catch {
        // Agent may not be running yet
      }
    };

    startFollowing();

    return {
      stop: () => {
        stopped = true;
        currentProc?.kill();
      },
    };
  }

  getTaskUrl(): string | null {
    return null; // No cloud console for VPS
  }

  async inspectContainer(): Promise<null> {
    return null;
  }
}
