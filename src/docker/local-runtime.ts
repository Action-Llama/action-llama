import { execFileSync, spawn } from "child_process";
import { randomUUID } from "crypto";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve, isAbsolute, dirname } from "path";
import { tmpdir } from "os";
import { NETWORK_NAME } from "./network.js";
import type { ContainerRuntime, RuntimeLaunchOpts, RuntimeCredentials, CredentialBundle, BuildImageOpts, RunningAgent } from "./runtime.js";
import { parseCredentialRef, getDefaultBackend } from "../shared/credentials.js";
import { CONSTANTS, VERSION, GIT_SHA } from "../shared/constants.js";

function docker(...args: string[]): string {
  return execFileSync("docker", args, {
    encoding: "utf-8",
    timeout: 30000,
  }).trim();
}

export class LocalDockerRuntime implements ContainerRuntime {
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
    const bundle: CredentialBundle = {};
    const backend = getDefaultBackend();

    for (const credRef of credRefs) {
      const { type, instance } = parseCredentialRef(credRef);
      const fields = await backend.readAll(type, instance);

      if (!fields) continue;

      const dstDir = join(stagingDir, type, instance);
      mkdirSync(dstDir, { recursive: true });
      if (!bundle[type]) bundle[type] = {};
      bundle[type][instance] = {};

      for (const [field, value] of Object.entries(fields)) {
        try {
          writeFileSync(join(dstDir, field), value + "\n", { mode: 0o600 });
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

      execFileSync("docker", [
        "build",
        "-t", opts.tag,
        "--build-arg", `GIT_SHA=${GIT_SHA}`,
        "--build-arg", `VERSION=${VERSION}`,
        "-f", dockerfilePath,
        contextPath,
      ], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "inherit"],
        timeout: 300_000,
        env: { ...process.env, DOCKER_BUILDKIT: "1" },
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
    const cpus = opts.cpus || 2;

    const args = [
      "run", "-d",
      "--name", containerName,
      "--network", NETWORK_NAME,
      "--user", "1000:1000",
      "--read-only",
      "--tmpfs", "/tmp:rw,exec,nosuid,uid=1000,gid=1000,size=2g",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges:true",
      "--pids-limit", "256",
      "--memory", memory,
      "--cpus", String(cpus),
    ];

    if (opts.credentials.strategy === "volume") {
      args.push("-v", `${opts.credentials.stagingDir}:/credentials:ro`);
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

  async startGatewayProxy(gatewayPort: number): Promise<void> {
    const proxyName = "al-gateway-proxy";
    
    // Check if proxy is already running
    try {
      docker("ps", "--filter", `name=${proxyName}`, "--format", "{{.Names}}");
      // If we get here, the container is already running
      return;
    } catch {
      // Container is not running, we need to start it
    }

    // Remove any existing proxy container
    try {
      docker("rm", "-f", proxyName);
    } catch {
      // Container doesn't exist, that's fine
    }

    // Start proxy container that forwards traffic from containers to host gateway
    // Use --add-host to map dockerhost to the host IP, which works across platforms
    docker(
      "run", "-d",
      "--name", proxyName,
      "--network", NETWORK_NAME,
      "--hostname", "gateway",
      "--add-host", "dockerhost:host-gateway",
      "--restart", "unless-stopped",
      "nginx:alpine",
      "sh", "-c", 
      `echo 'events { } http { server { listen 8080; location / { proxy_pass http://dockerhost:${gatewayPort}; proxy_set_header Host \\$host; proxy_set_header X-Real-IP \\$remote_addr; } } }' > /etc/nginx/nginx.conf && exec nginx -g 'daemon off;'`
    );
  }

  async stopGatewayProxy(): Promise<void> {
    const proxyName = "al-gateway-proxy";
    try {
      docker("rm", "-f", proxyName);
    } catch {
      // Container doesn't exist or is already stopped
    }
  }
}
