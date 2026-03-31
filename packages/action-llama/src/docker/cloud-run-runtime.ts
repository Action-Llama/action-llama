/**
 * Google Cloud Run Jobs runtime.
 * Implements Runtime and ContainerRuntime by launching agents as Cloud Run Jobs.
 */

import { randomUUID } from "crypto";
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
import type { GcpAuth } from "../cloud/gcp/auth.js";
import {
  createJob,
  deleteJob,
  runJob,
  listJobs,
  listExecutions,
  pollExecutionUntilDone,
  type CloudRunJobTemplate,
  type CloudRunContainer,
  type CloudRunVolume,
  type CloudRunExecution,
} from "../cloud/gcp/cloud-run-api.js";
import {
  createSecret,
  addSecretVersion,
  deleteSecret,
} from "../cloud/gcp/secret-manager-api.js";
import {
  listLogEntries,
  buildJobLogFilter,
  extractLogText,
} from "../cloud/gcp/logging-api.js";
import { cleanupOldImages } from "../cloud/gcp/artifact-registry-api.js";
import { parseCredentialRef, getDefaultBackend } from "../shared/credentials.js";
import { CONSTANTS, VERSION, GIT_SHA } from "../shared/constants.js";
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "fs";
import { join, resolve, isAbsolute, dirname } from "path";
import { tmpdir } from "os";
import { parseBuildKitLine } from "./local-runtime.js";

export interface CloudRunRuntimeConfig {
  auth: GcpAuth;
  project: string;
  region: string;
  artifactRegistry: string; // Artifact Registry repo name
  serviceAccount?: string;  // SA email for job execution (optional)
}

/** Convert a memory string like "4g"/"4G"/"4096m" to Cloud Run "4Gi" format */
function parseMemoryForCloudRun(memory?: string): string {
  if (!memory) return "2Gi";
  const lower = memory.toLowerCase();
  const gbMatch = lower.match(/^(\d+(?:\.\d+)?)g(?:i?)$/);
  if (gbMatch) return `${gbMatch[1]}Gi`;
  const mbMatch = lower.match(/^(\d+)m(?:i?)$/);
  if (mbMatch) return `${Math.ceil(parseInt(mbMatch[1]) / 1024)}Gi`;
  return memory;
}

export class CloudRunRuntime implements Runtime, ContainerRuntime {
  readonly needsGateway = true;

  private config: CloudRunRuntimeConfig;
  /** Map from jobId -> executionName (to support waitForExit) */
  private executionNames = new Map<string, string>();

  constructor(config: CloudRunRuntimeConfig) {
    this.config = config;
  }

  private get auth() { return this.config.auth; }
  private get project() { return this.config.project; }
  private get region() { return this.config.region; }
  private get artifactRegistry() { return this.config.artifactRegistry; }

  // ── Credential management ────────────────────────────────────────────────

  async prepareCredentials(credRefs: string[]): Promise<RuntimeCredentials> {
    const backend = getDefaultBackend();
    const bundle: CredentialBundle = {};
    const secretRefs: Array<{ secretName: string; mountPath: string }> = [];
    const runId = randomUUID().replace(/-/g, "").slice(0, 12);

    for (const credRef of credRefs) {
      const { type, instance } = parseCredentialRef(credRef);
      const fields = await backend.readAll(type, instance);
      if (!fields) continue;

      if (!bundle[type]) bundle[type] = {};
      bundle[type][instance] = {};

      for (const [field, value] of Object.entries(fields)) {
        bundle[type][instance][field] = value;

        // Create a unique secret ID for this field
        const secretId = `al-cred-${runId}-${type}-${instance}-${field}`
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "-")
          .slice(0, 255);
        const mountPath = `/credentials/${type}/${instance}/${field}`;

        try {
          await createSecret(this.auth, this.project, secretId);
          await addSecretVersion(this.auth, this.project, secretId, value);
          secretRefs.push({ secretName: secretId, mountPath });
        } catch (err: any) {
          // Log and skip — don't fail the whole launch
          console.error(`Failed to create Secret Manager secret for ${credRef}.${field}: ${err.message}`);
        }
      }
    }

    return { strategy: "secret-manager", secretRefs, bundle };
  }

  cleanupCredentials(creds: RuntimeCredentials): void {
    if (creds.strategy !== "secret-manager") return;
    for (const { secretName } of creds.secretRefs) {
      deleteSecret(this.auth, this.project, secretName).catch(() => {
        // Best effort
      });
    }
  }

  // ── Image build & push ───────────────────────────────────────────────────

  async buildImage(opts: BuildImageOpts): Promise<string> {
    opts.onProgress?.("Building image locally");

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

      await new Promise<void>((res, rej) => {
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

        let stderrBuf = "";
        let stderrAll = "";
        proc.stderr.on("data", (chunk: Buffer) => {
          const text = chunk.toString();
          stderrAll += text;
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
          rej(new Error("Docker build timed out after 300s"));
        }, 300_000);

        proc.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0) res();
          else rej(new Error(`Docker build failed (exit ${code}):\n${stderrAll}`));
        });

        proc.on("error", (err) => { clearTimeout(timer); rej(err); });
      });
    } finally {
      if (buildDir) {
        try { rmSync(buildDir, { recursive: true }); } catch {}
      }
    }

    if (opts.additionalTags) {
      for (const alias of opts.additionalTags) {
        await this._dockerExec(["tag", opts.tag, alias]);
      }
    }

    return opts.tag;
  }

  async pushImage(localImage: string): Promise<string> {
    const registry = `${this.region}-docker.pkg.dev`;
    const registryUri = `${registry}/${this.project}/${this.artifactRegistry}/${localImage}`;

    // Authenticate docker with Artifact Registry
    const token = await this.auth.getAccessToken();
    await this._dockerExec(["login", registry, "-u", "oauth2accesstoken", "-p", token]);

    // Tag and push
    await this._dockerExec(["tag", localImage, registryUri]);
    await this._dockerExec(["push", registryUri]);

    // Cleanup old images (keep 3 most recent)
    try {
      await cleanupOldImages(this.auth, this.project, this.region, this.artifactRegistry, localImage, 3);
    } catch {
      // Best effort
    }

    return registryUri;
  }

  private _dockerExec(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`docker ${args[0]} failed (exit ${code}): ${stderr}`));
      });
      proc.on("error", reject);
    });
  }

  // ── Launch & lifecycle ───────────────────────────────────────────────────

  async launch(opts: RuntimeLaunchOpts): Promise<string> {
    const runId = randomUUID().slice(0, 8);
    const jobId = CONSTANTS.containerName(opts.agentName, runId);

    const envVars = Object.entries(opts.env).map(([name, value]) => ({ name, value }));
    const memory = parseMemoryForCloudRun(opts.memory);
    const cpus = opts.cpus ? String(opts.cpus) : "1";

    // Build volumes and mounts from secret refs
    const volumes: CloudRunVolume[] = [];
    const volumeMounts: Array<{ name: string; mountPath: string }> = [];

    if (opts.credentials.strategy === "secret-manager") {
      for (const { secretName, mountPath } of opts.credentials.secretRefs) {
        const volName = secretName.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 63);
        volumes.push({
          name: volName,
          secret: {
            secret: `projects/${this.project}/secrets/${secretName}`,
            items: [{ version: "latest", path: "value" }],
          },
        });
        // Mount the secret as a file at the mountPath
        // Cloud Run secrets mount the directory, with the file at the path key
        const mountDir = mountPath.split("/").slice(0, -1).join("/");
        const fileName = mountPath.split("/").pop()!;
        volumeMounts.push({ name: volName, mountPath: mountDir });
        // Re-construct items to have the file at the right path
        volumes[volumes.length - 1].secret!.items = [{ version: "latest", path: fileName }];
      }
    }

    const container: CloudRunContainer = {
      image: opts.image,
      env: envVars,
      volumeMounts,
      resources: { limits: { memory, cpu: cpus } },
    };

    const template: CloudRunJobTemplate = {
      template: {
        containers: [container],
        volumes,
        maxRetries: 0,
        timeout: "3600s",
        serviceAccount: this.config.serviceAccount,
      },
      labels: {
        "started-by": "action-llama",
        "agent-name": opts.agentName,
      },
    };

    await createJob(this.auth, this.project, this.region, jobId, template);
    const execOp = await runJob(this.auth, this.project, this.region, jobId);

    // Extract execution name from the operation response
    const executionName = execOp?.response?.name ?? execOp?.name ?? "";
    if (executionName) {
      this.executionNames.set(jobId, executionName);
    }

    return jobId;
  }

  async isAgentRunning(agentName: string): Promise<boolean> {
    try {
      const jobs = await listJobs(this.auth, this.project, this.region);
      const prefix = `al-${agentName}-`;
      const agentJobs = jobs.filter((j) => {
        const shortName = j.name.split("/").pop() ?? "";
        return shortName.startsWith(prefix);
      });
      if (agentJobs.length === 0) return false;

      for (const job of agentJobs) {
        const jobId = job.name.split("/").pop()!;
        const execs = await listExecutions(this.auth, this.project, this.region, jobId);
        const running = execs.some((e) => !e.completionTime);
        if (running) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async listRunningAgents(): Promise<RunningAgent[]> {
    try {
      const jobs = await listJobs(this.auth, this.project, this.region);
      const agents: RunningAgent[] = [];

      for (const job of jobs) {
        const jobId = job.name.split("/").pop()!;
        if (!jobId.startsWith(CONSTANTS.CONTAINER_FILTER)) continue;

        // Extract agentName from "al-<agentName>-<runId>"
        const parts = jobId.split("-");
        const agentName = parts.slice(1, -1).join("-");

        const execs = await listExecutions(this.auth, this.project, this.region, jobId);
        const runningExecs = execs.filter((e) => !e.completionTime);

        for (const exec of runningExecs) {
          agents.push({
            agentName,
            taskId: exec.name.split("/").pop()!,
            runtimeId: jobId,
            status: "running",
            startedAt: exec.createTime ? new Date(exec.createTime) : undefined,
          });
        }
      }

      return agents;
    } catch {
      return [];
    }
  }

  async kill(runId: string): Promise<void> {
    try {
      await deleteJob(this.auth, this.project, this.region, runId);
      this.executionNames.delete(runId);
    } catch {
      // Already deleted or not found
    }
  }

  async remove(runId: string): Promise<void> {
    return this.kill(runId);
  }

  // ── Logs ─────────────────────────────────────────────────────────────────

  streamLogs(
    runId: string,
    onLine: (line: string) => void,
    _onStderr?: (text: string) => void,
  ): { stop: () => void } {
    let stopped = false;
    let lastTimestamp: string | undefined;

    const poll = async () => {
      if (stopped) return;

      try {
        const filter = buildJobLogFilter(this.region, runId, lastTimestamp);
        const resp = await listLogEntries(this.auth, this.project, filter, 100, "timestamp asc");
        for (const entry of resp.entries ?? []) {
          const text = extractLogText(entry);
          if (text) {
            for (const line of text.split("\n")) {
              if (line) onLine(line);
            }
          }
          if (entry.timestamp) lastTimestamp = entry.timestamp;
        }
      } catch {
        // Ignore transient errors
      }

      if (!stopped) {
        setTimeout(poll, 3000);
      }
    };

    setTimeout(poll, 3000);

    return {
      stop: () => { stopped = true; },
    };
  }

  async waitForExit(runId: string, timeoutSeconds: number): Promise<number> {
    const executionName = this.executionNames.get(runId);
    if (!executionName) {
      throw new Error(`No execution found for job ${runId}`);
    }

    const exec = await pollExecutionUntilDone(
      this.auth,
      this.project,
      this.region,
      executionName,
      timeoutSeconds * 1000,
    );

    this.executionNames.delete(runId);

    return this._extractExitCode(exec, runId);
  }

  private async _extractExitCode(exec: CloudRunExecution, runId: string): Promise<number> {
    const completedCondition = exec.conditions?.find((c) => c.type === "Completed");

    if (!completedCondition || completedCondition.state === "CONDITION_SUCCEEDED") {
      // Check Cloud Logging for al-rerun exit code 42
      try {
        const filter = buildJobLogFilter(this.region, runId);
        const resp = await listLogEntries(this.auth, this.project, filter, 100, "timestamp desc");
        for (const entry of resp.entries ?? []) {
          const text = extractLogText(entry);
          if (text.includes("exit code 42") || text.includes("exitCode=42")) {
            return 42;
          }
        }
      } catch {
        // Best effort
      }
      return 0;
    }

    if (completedCondition.state === "CONDITION_FAILED") {
      // Try to extract exit code from message
      const msg = completedCondition.message ?? "";
      const match = msg.match(/exit code (\d+)/i) ?? msg.match(/exitCode=(\d+)/i);
      if (match) return parseInt(match[1]);
      return 1;
    }

    return 0;
  }

  async fetchLogs(agentName: string, limit: number, _taskId?: string): Promise<string[]> {
    try {
      const jobs = await listJobs(this.auth, this.project, this.region);
      const prefix = `al-${agentName}-`;
      const agentJobs = jobs.filter((j) => {
        const id = j.name.split("/").pop() ?? "";
        return id.startsWith(prefix);
      });

      const lines: string[] = [];
      for (const job of agentJobs) {
        const jobId = job.name.split("/").pop()!;
        const filter = buildJobLogFilter(this.region, jobId);
        const resp = await listLogEntries(this.auth, this.project, filter, limit, "timestamp desc");
        for (const entry of resp.entries ?? []) {
          const text = extractLogText(entry);
          if (text) lines.push(...text.split("\n").filter(Boolean));
        }
      }

      return lines.slice(-limit);
    } catch {
      return [];
    }
  }

  followLogs(
    agentName: string,
    onLine: (line: string) => void,
    onStderr?: (text: string) => void,
    _taskId?: string,
  ): { stop: () => void } {
    let stopped = false;
    let lastTimestamp: string | undefined;

    const poll = async () => {
      if (stopped) return;

      try {
        const jobs = await listJobs(this.auth, this.project, this.region);
        const prefix = `al-${agentName}-`;

        for (const job of jobs) {
          const jobId = job.name.split("/").pop() ?? "";
          if (!jobId.startsWith(prefix)) continue;

          const filter = buildJobLogFilter(this.region, jobId, lastTimestamp);
          const resp = await listLogEntries(this.auth, this.project, filter, 100, "timestamp asc");
          for (const entry of resp.entries ?? []) {
            const text = extractLogText(entry);
            if (text) {
              for (const line of text.split("\n")) {
                if (line) onLine(line);
              }
            }
            if (entry.timestamp) lastTimestamp = entry.timestamp;
          }
        }
      } catch {
        // Ignore transient errors
      }

      if (!stopped) {
        setTimeout(poll, 3000);
      }
    };

    setTimeout(poll, 3000);

    return { stop: () => { stopped = true; } };
  }

  getTaskUrl(runId: string): string | null {
    return `https://console.cloud.google.com/run/jobs/details/${this.region}/${runId}/executions?project=${this.project}`;
  }

  async inspectContainer(_containerName: string): Promise<{ env: Record<string, string> } | null> {
    // Cloud Run Jobs don't support container-level inspect.
    // Orphans will be killed rather than re-adopted.
    return null;
  }
}
