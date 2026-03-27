import { execFileSync, spawn } from "child_process";
import { randomUUID } from "crypto";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, chownSync } from "fs";
import { join, resolve, isAbsolute, dirname } from "path";
import { tmpdir } from "os";
import { NETWORK_NAME } from "./network.js";
import type { Runtime, ContainerRuntime, RuntimeLaunchOpts, RuntimeCredentials, CredentialBundle, BuildImageOpts, RunningAgent } from "./runtime.js";
import { parseCredentialRef, getDefaultBackend } from "../shared/credentials.js";
import { CONSTANTS, VERSION, GIT_SHA } from "../shared/constants.js";

function docker(...args: string[]): string {
  return execFileSync("docker", args, {
    encoding: "utf-8",
    timeout: 30000,
  }).trim();
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

/**
 * Parse a line of Docker BuildKit stderr output.
 * Returns a human-readable string for meaningful lines, or undefined to skip noise
 * (blank lines, transfer progress, BuildKit metadata).
 */
export function parseBuildKitLine(raw: string): string | undefined {
  const line = raw.replace(ANSI_RE, "").trim();
  if (!line) return undefined;

  const stepMatch = line.match(/^#\d+\s+\[(\d+\/\d+)]\s+(.+)/);
  if (stepMatch) return `Step ${stepMatch[1]}: ${stepMatch[2]}`;

  const errMatch = line.match(/^#\d+\s+ERROR\s+(.+)/);
  if (errMatch) return `Error: ${errMatch[1]}`;

  // Skip BuildKit progress/metadata noise (e.g. "#5 DONE 0.3s", "#5 sha256:abc 2MB/5MB")
  if (/^#\d+\s/.test(line)) return undefined;

  // Forward everything else (compiler errors, missing module traces, etc.)
  return line;
}

export class LocalDockerRuntime implements Runtime, ContainerRuntime {
  readonly needsGateway = true;

  async isAgentRunning(agentName: string): Promise<boolean> {
    try {
      const out = docker("ps", "--filter", `name=al-${agentName}-`, "--format", "{{.Names}}");
      return out.length > 0;
    } catch {
      return false;
    }
  }

  async listRunningAgents(): Promise<RunningAgent[]> {
    try {
      const out = docker("ps", "--filter", `name=${CONSTANTS.CONTAINER_FILTER}`, "--format", "{{.Names}}\t{{.Status}}\t{{.CreatedAt}}");
      if (!out) return [];
      return out.split("\n").filter(Boolean).map((line) => {
        const [name, status, createdAt] = line.split("\t");
        // Container name is "al-<agentName>-<runId>"
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
    const stagingDir = mkdtempSync(join(tmpdir(), CONSTANTS.CREDS_TEMP_PREFIX));
    // Use restrictive permissions for better security on multi-user systems.
    // Directory is only accessible by the owner (0700) and files are read-only (0400).
    chmodSync(stagingDir, CONSTANTS.CREDS_DIR_MODE);
    
    // Try to set ownership to container UID/GID for better isolation.
    // This may fail when running as non-root, so wrap in try-catch.
    try {
      chownSync(stagingDir, CONSTANTS.CONTAINER_UID, CONSTANTS.CONTAINER_GID);
    } catch {
      // Non-root execution - ownership change failed, continue gracefully
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

      // Chown both the type dir and instance dir — mkdirSync recursive
      // creates both, but we must chown each explicitly.
      try {
        chownSync(typeDir, CONSTANTS.CONTAINER_UID, CONSTANTS.CONTAINER_GID);
        chownSync(dstDir, CONSTANTS.CONTAINER_UID, CONSTANTS.CONTAINER_GID);
      } catch {
        // Non-root execution - ownership change failed, continue gracefully
      }

      if (!bundle[type]) bundle[type] = {};
      bundle[type][instance] = {};

      for (const [field, value] of Object.entries(fields)) {
        try {
          const filePath = join(dstDir, field);
          writeFileSync(filePath, value + "\n", { mode: CONSTANTS.CREDS_FILE_MODE });
          
          // Try to set ownership on credential file
          try {
            chownSync(filePath, CONSTANTS.CONTAINER_UID, CONSTANTS.CONTAINER_GID);
          } catch {
            // Non-root execution - ownership change failed, continue gracefully
          }

          bundle[type][instance][field] = value;
        } catch {
          // Skip unwritable fields
        }
      }
    }

    return { strategy: "volume", stagingDir, bundle };
  }

  cleanupCredentials(creds: RuntimeCredentials): void {
    if (creds.strategy === "volume") {
      try {
        rmSync(creds.stagingDir, { recursive: true, force: true });
      } catch { /* best effort */ }
    }
  }

  async buildImage(opts: BuildImageOpts): Promise<string> {
    opts.onProgress?.("Building image locally");

    // ── 1. Resolve Dockerfile content ──────────────────────────────
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

    // ── 2. Inject COPY static/ when extra files are provided ───────
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

    // ── 3. Prepare build context ───────────────────────────────────
    // When the Dockerfile or context needs modification (generated content,
    // FROM rewrite, or extra static files), build from an isolated temp dir.
    // Otherwise build directly from contextDir.
    const needsTempCtx = !!opts.dockerfileContent || hasExtraFiles || !!opts.baseImage;
    const buildDir = needsTempCtx ? mkdtempSync(join(tmpdir(), "al-ctx-")) : undefined;

    try {
      let dockerfilePath: string;
      let contextPath: string;

      if (buildDir) {
        writeFileSync(join(buildDir, "Dockerfile"), content);
        dockerfilePath = join(buildDir, "Dockerfile");
        contextPath = buildDir;

        if (hasExtraFiles) {
          const staticDir = join(buildDir, "static");
          mkdirSync(staticDir, { recursive: true });
          for (const [filename, fileContent] of Object.entries(opts.extraFiles!)) {
            const filePath = join(staticDir, filename);
            mkdirSync(dirname(filePath), { recursive: true });
            writeFileSync(filePath, fileContent);
          }
        }
      } else {
        dockerfilePath = isAbsolute(opts.dockerfile)
          ? opts.dockerfile
          : resolve(opts.contextDir, opts.dockerfile);
        contextPath = opts.contextDir;
      }

      await new Promise<void>((resolve, reject) => {
        const proc = spawn("docker", [
          "build",
          "-t", opts.tag,
          "--build-arg", `GIT_SHA=${GIT_SHA}`,
          "--build-arg", `VERSION=${VERSION}`,
          "-f", dockerfilePath,
          contextPath,
        ], {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, DOCKER_BUILDKIT: "1" },
        });

        let stderr = "";
        let stderrBuf = "";

        proc.stderr.on("data", (chunk: Buffer) => {
          const text = chunk.toString();
          stderr += text;
          stderrBuf += text;
          const lines = stderrBuf.split("\n");
          stderrBuf = lines.pop() || "";
          for (const line of lines) {
            const msg = parseBuildKitLine(line);
            if (msg !== undefined) opts.onProgress?.(msg);
          }
        });

        const timer = setTimeout(() => {
          proc.kill();
          reject(new Error("Docker build timed out after 300s"));
        }, 300_000);

        proc.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Docker build failed (exit ${code}):\n${stderr}`));
          }
        });

        proc.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
    } finally {
      if (buildDir) {
        try { rmSync(buildDir, { recursive: true }); } catch {}
      }
    }

    // Apply additional tags (e.g. semver and latest aliases)
    if (opts.additionalTags) {
      for (const alias of opts.additionalTags) {
        docker("tag", opts.tag, alias);
      }
    }

    return opts.tag;
  }

  async pushImage(localImage: string): Promise<string> {
    return localImage;
  }

  async launch(opts: RuntimeLaunchOpts): Promise<string> {
    const runId = randomUUID().slice(0, 8);
    const containerName = CONSTANTS.containerName(opts.agentName, runId);
    const memory = opts.memory || "4g";

    const args = [
      "run", "-d",
      "--name", containerName,
      "--network", NETWORK_NAME,
      "--add-host", "gateway:host-gateway",
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
    } else if (opts.credentials.strategy === "tmpfs") {
      // Mount credentials as tmpfs for enhanced security
      args.push("--tmpfs", `/credentials:rw,nosuid,nodev,noexec,uid=${CONSTANTS.CONTAINER_UID},gid=${CONSTANTS.CONTAINER_GID},mode=0700`);
      // Note: Credentials would need to be copied into tmpfs after container starts
      // This requires additional Docker exec commands - simplified for this implementation
      args.push("-v", `${opts.credentials.stagingDir}:/credentials-staging:ro`);
    }

    for (const [key, value] of Object.entries(opts.env)) {
      args.push("-e", `${key}=${value}`);
    }

    args.push(opts.image);

    docker(...args);

    return containerName;
  }

  streamLogs(
    containerName: string,
    onLine: (line: string) => void,
    onStderr?: (text: string) => void
  ): { stop: () => void } {
    const proc = spawn("docker", ["logs", "-f", containerName], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let buffer = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        onLine(line);
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text && onStderr) {
        onStderr(text);
      }
    });

    return {
      stop: () => {
        if (buffer.trim()) {
          onLine(buffer);
        }
        proc.kill();
      },
    };
  }

  waitForExit(containerName: string, timeoutSeconds: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const proc = spawn("docker", ["wait", containerName], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      const timer = setTimeout(() => {
        proc.kill();
        spawn("docker", ["kill", containerName], { stdio: "ignore" });
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
      docker("kill", containerName);
    } catch {
      // Container may already be dead
    }
  }

  async remove(containerName: string): Promise<void> {
    try {
      docker("rm", "-f", containerName);
    } catch {
      // Container may already be removed
    }
  }

  async fetchLogs(agentName: string, limit: number): Promise<string[]> {
    try {
      // List all containers matching this agent (handles scale > 1)
      const names = docker(
        "ps", "-a",
        "--filter", `name=al-${agentName}-`,
        "--format", "{{.Names}}",
      );
      if (!names) return [];

      // Collect logs from all matching containers, most recent first
      const allLines: string[] = [];
      for (const name of names.split("\n").filter(Boolean)) {
        try {
          const out = docker("logs", "--tail", String(limit), name);
          allLines.push(...out.split("\n").filter(Boolean));
        } catch {
          // Container may have been removed
        }
      }
      return allLines.slice(-limit);
    } catch {
      // No running container — local logs are in the log files, not Docker
      return [];
    }
  }

  followLogs(
    _agentName: string,
    _onLine: (line: string) => void,
    _onStderr?: (text: string) => void
  ): { stop: () => void } {
    // Local follow is handled by the file-based tail in logs.ts
    return { stop: () => {} };
  }

  getTaskUrl(): string | null {
    return null;
  }

}
