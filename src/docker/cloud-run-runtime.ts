import { execFileSync } from "child_process";
import type { ContainerRuntime, RuntimeLaunchOpts, RuntimeCredentials, SecretMount, BuildImageOpts, RunningAgent } from "./runtime.js";
import { parseCredentialRef } from "../shared/credentials.js";
import { AWS_CONSTANTS } from "../shared/aws-constants.js";

export interface CloudRunJobConfig {
  gcpProject: string;
  region: string;
  artifactRegistry: string;     // e.g. "us-central1-docker.pkg.dev/my-project/al-images"
  serviceAccount: string;       // Job SA for secret access + execution
  secretPrefix?: string;        // GSM secret prefix
}

/**
 * GCP Cloud Run Jobs runtime.
 *
 * Launches agents as Cloud Run job executions with GSM secrets mounted
 * as files at /credentials/<type>/<instance>/<field>.
 *
 * Auth resolution order (same as GoogleSecretManagerBackend):
 * 1. GCP_SERVICE_ACCOUNT_KEY env var (JSON key — CI/Railway)
 * 2. GOOGLE_APPLICATION_CREDENTIALS env var (file path)
 * 3. gcloud auth application-default login (local dev)
 *
 * The runtime SA (your machine) needs:
 *   - run.jobs.create, run.jobs.run, run.jobs.get
 *   - run.executions.get, run.executions.cancel
 *   - artifactregistry.repositories.uploadArtifacts (for pushImage)
 *
 * The job SA (container) needs per-agent:
 *   - secretmanager.secretAccessor on its specific secrets
 */
export class CloudRunJobRuntime implements ContainerRuntime {
  readonly needsGateway = false;

  private config: CloudRunJobConfig;
  private prefix: string;
  private accessToken: string | undefined;
  private tokenExpiry = 0;

  constructor(config: CloudRunJobConfig) {
    this.config = config;
    this.prefix = config.secretPrefix || AWS_CONSTANTS.DEFAULT_SECRET_PREFIX;
  }

  // --- Agent tracking ---

  async isAgentRunning(agentName: string): Promise<boolean> {
    const jobName = AWS_CONSTANTS.agentFamily(agentName);
    const { gcpProject, region } = this.config;
    const fullName = `projects/${gcpProject}/locations/${region}/jobs/${jobName}`;

    try {
      // List recent executions for this job
      const res = await this.gcpRequest("GET",
        `https://run.googleapis.com/v2/${fullName}/executions?pageSize=1`
      );
      if (!res.ok) return false;

      const data = await res.json() as { executions?: Array<{ completionTime?: string }> };
      const latest = data.executions?.[0];
      // If the latest execution has no completionTime, it's still running
      return !!latest && !latest.completionTime;
    } catch {
      return false;
    }
  }

  async listRunningAgents(): Promise<RunningAgent[]> {
    const { gcpProject, region } = this.config;
    const parent = `projects/${gcpProject}/locations/${region}`;

    const jobsRes = await this.gcpRequest("GET",
      `https://run.googleapis.com/v2/${parent}/jobs?pageSize=100`
    );
    if (!jobsRes.ok) return [];

    const jobsData = await jobsRes.json() as { jobs?: Array<{ name: string }> };
    const jobs = (jobsData.jobs ?? []).filter((j) => {
      const name = j.name.split("/").pop() ?? "";
      return name.startsWith(AWS_CONSTANTS.CONTAINER_FILTER);
    });

    const running: RunningAgent[] = [];
    for (const job of jobs) {
      const jobName = job.name.split("/").pop()!;
      const agentName = AWS_CONSTANTS.agentNameFromFamily(jobName);

      const execRes = await this.gcpRequest("GET",
        `https://run.googleapis.com/v2/${job.name}/executions?pageSize=1`
      );
      if (!execRes.ok) continue;

      const execData = await execRes.json() as {
        executions?: Array<{
          name: string;
          createTime?: string;
          completionTime?: string;
        }>;
      };

      const latest = execData.executions?.[0];
      if (latest && !latest.completionTime) {
        running.push({
          agentName,
          taskId: latest.name.split("/").pop() ?? "unknown",
          status: "RUNNING",
          startedAt: latest.createTime ? new Date(latest.createTime) : undefined,
        });
      }
    }

    return running;
  }

  // --- Credential preparation ---

  async prepareCredentials(credRefs: string[]): Promise<RuntimeCredentials> {
    const mounts: SecretMount[] = [];

    for (const credRef of credRefs) {
      const { type, instance } = parseCredentialRef(credRef);

      // List all fields for this credential by querying GSM
      const fields = await this.listSecretFields(type, instance);

      for (const field of fields) {
        const secretName = this.gsmSecretName(type, instance, field);
        mounts.push({
          secretId: secretName,
          mountPath: `/credentials/${type}/${instance}/${field}`,
        });
      }
    }

    return { strategy: "secrets-manager", mounts };
  }

  cleanupCredentials(_creds: RuntimeCredentials): void {
    // No-op — cloud secrets don't need cleanup
  }

  // --- Image management ---

  async buildImage(opts: BuildImageOpts): Promise<string> {
    const remoteTag = `${this.config.artifactRegistry}/${opts.tag}`;

    // Use Cloud Build — no local Docker needed
    // Submits the build context to Cloud Build which builds and pushes in one step
    opts.onProgress?.("Submitting to Cloud Build");
    execFileSync("gcloud", [
      "builds", "submit",
      "--tag", remoteTag,
      "--gcs-log-dir", `gs://${this.config.gcpProject}_cloudbuild/logs`,
      "--project", this.config.gcpProject,
      "--region", this.config.region,
      "--quiet",
    ], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "inherit"],
      timeout: 600_000, // 10 min for cloud builds
      cwd: opts.contextDir,
    });

    return remoteTag;
  }

  async pushImage(localImage: string): Promise<string> {
    const remoteTag = `${this.config.artifactRegistry}/${localImage}`;

    // Tag and push the local image to Artifact Registry
    this.dockerExec("tag", localImage, remoteTag);
    this.dockerExec("push", remoteTag);

    return remoteTag;
  }

  // --- Container lifecycle ---

  async launch(opts: RuntimeLaunchOpts): Promise<string> {
    const jobName = AWS_CONSTANTS.agentFamily(opts.agentName);

    // Build the job spec with secret volume mounts
    const secretMounts = opts.credentials.strategy === "secrets-manager"
      ? opts.credentials.mounts
      : [];

    // Use per-agent SA if available (created by `al doctor -c`),
    // otherwise fall back to the shared SA from config
    const perAgentSa = AWS_CONSTANTS.serviceAccountEmail(opts.agentName, this.config.gcpProject);
    const serviceAccount = opts.serviceAccount || perAgentSa;

    // Create or update the Cloud Run job
    await this.createOrUpdateJob(jobName, {
      image: opts.image,
      env: opts.env,
      secretMounts,
      memory: opts.memory || "4Gi",
      cpus: String(opts.cpus || 2),
      serviceAccount,
    });

    // Execute the job and return the execution name
    const executionName = await this.executeJob(jobName);
    return executionName;
  }

  streamLogs(
    executionName: string,
    onLine: (line: string) => void,
    onStderr?: (text: string) => void
  ): { stop: () => void } {
    let stopped = false;
    let lastTimestamp: string | undefined;

    const poll = async () => {
      while (!stopped) {
        try {
          const entries = await this.readLogs(executionName, lastTimestamp);
          for (const entry of entries) {
            if (entry.timestamp) lastTimestamp = entry.timestamp;
            if (entry.textPayload) {
              onLine(entry.textPayload);
            } else if (entry.jsonPayload) {
              onLine(JSON.stringify(entry.jsonPayload));
            }
          }
        } catch (err: any) {
          if (!stopped && onStderr) {
            onStderr(`Log polling error: ${err.message}`);
          }
        }
        // Cloud Logging has ~5-15s ingestion delay
        if (!stopped) await sleep(5000);
      }
    };

    poll();

    return {
      stop: () => { stopped = true; },
    };
  }

  async waitForExit(executionName: string, timeoutSeconds: number): Promise<number> {
    const deadline = Date.now() + timeoutSeconds * 1000;

    while (Date.now() < deadline) {
      const status = await this.getExecutionStatus(executionName);

      if (status.succeeded) return 0;
      if (status.failed) return 1;
      if (status.cancelled) return 130;

      await sleep(5000);
    }

    // Timeout — cancel the execution
    await this.kill(executionName);
    throw new Error(`Cloud Run execution ${executionName} timed out after ${timeoutSeconds}s`);
  }

  async kill(executionName: string): Promise<void> {
    try {
      await this.gcpRequest(
        "POST",
        `https://run.googleapis.com/v2/${executionName}:cancel`,
        {}
      );
    } catch {
      // Execution may already be finished
    }
  }

  async remove(_executionName: string): Promise<void> {
    // Cloud Run auto-cleans up executions
  }

  async fetchLogs(agentName: string, limit: number): Promise<string[]> {
    const jobName = AWS_CONSTANTS.agentFamily(agentName);
    const token = await this.getAccessToken();

    const res = await fetch("https://logging.googleapis.com/v2/entries:list", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        resourceNames: [`projects/${this.config.gcpProject}`],
        filter: `resource.type="cloud_run_job" AND labels."run.googleapis.com/job_name"="${jobName}"`,
        orderBy: "timestamp desc",
        pageSize: limit,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Cloud Logging read failed: ${res.status} ${body}`);
    }

    const data = await res.json() as {
      entries?: Array<{ textPayload?: string; jsonPayload?: unknown }>;
    };

    return (data.entries ?? [])
      .reverse()
      .map((e) => e.textPayload ?? (e.jsonPayload ? JSON.stringify(e.jsonPayload) : ""))
      .filter(Boolean);
  }

  followLogs(
    agentName: string,
    onLine: (line: string) => void,
    onStderr?: (text: string) => void
  ): { stop: () => void } {
    let stopped = false;
    const jobName = AWS_CONSTANTS.agentFamily(agentName);
    let lastTimestamp: string | undefined;

    const poll = async () => {
      while (!stopped) {
        try {
          const token = await this.getAccessToken();
          let filter = `resource.type="cloud_run_job" AND labels."run.googleapis.com/job_name"="${jobName}"`;
          if (lastTimestamp) {
            filter += ` AND timestamp>"${lastTimestamp}"`;
          } else {
            // Start from 1 minute ago
            filter += ` AND timestamp>="${new Date(Date.now() - 60_000).toISOString()}"`;
          }

          const res = await fetch("https://logging.googleapis.com/v2/entries:list", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              resourceNames: [`projects/${this.config.gcpProject}`],
              filter,
              orderBy: "timestamp asc",
              pageSize: 100,
            }),
          });

          if (!res.ok) {
            const body = await res.text();
            throw new Error(`Cloud Logging read failed: ${res.status} ${body}`);
          }

          const data = await res.json() as {
            entries?: Array<{ timestamp?: string; textPayload?: string; jsonPayload?: unknown }>;
          };

          for (const entry of data.entries ?? []) {
            if (entry.timestamp) lastTimestamp = entry.timestamp;
            const line = entry.textPayload ?? (entry.jsonPayload ? JSON.stringify(entry.jsonPayload) : "");
            if (line) onLine(line);
          }
        } catch (err: any) {
          if (!stopped && onStderr) {
            onStderr(`Log polling error: ${err.message}`);
          }
        }
        if (!stopped) await sleep(5000);
      }
    };

    poll();

    return { stop: () => { stopped = true; } };
  }

  getTaskUrl(executionName: string): string | null {
    // executionName format: projects/{project}/locations/{region}/jobs/{jobName}/executions/{executionId}
    const parts = executionName.split("/");
    if (parts.length >= 8) {
      const project = parts[1];
      const region = parts[3];
      const jobName = parts[5];
      const executionId = parts[7];
      return `https://console.cloud.google.com/run/jobs/executions/details/${region}/${jobName}/${executionId}?project=${project}`;
    }
    return null;
  }

  // --- Internal: GCP API helpers ---

  private gsmSecretName(type: string, instance: string, field: string): string {
    return `${this.prefix}--${type}--${instance}--${field}`;
  }

  private async listSecretFields(type: string, instance: string): Promise<string[]> {
    const prefix = `${this.prefix}--${type}--${instance}--`;
    const token = await this.getAccessToken();
    const url = `https://secretmanager.googleapis.com/v1/projects/${this.config.gcpProject}/secrets?filter=name:${encodeURIComponent(prefix)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to list GSM secrets for ${type}:${instance}: ${res.status} ${body}`);
    }

    const data = await res.json() as { secrets?: Array<{ name: string }> };
    const fields: string[] = [];

    for (const secret of data.secrets || []) {
      const secretId = secret.name.split("/").pop()!;
      const parts = secretId.split("--");
      if (parts.length === 4 && parts[0] === this.prefix && parts[1] === type && parts[2] === instance) {
        fields.push(parts[3]);
      }
    }

    return fields;
  }

  private async createOrUpdateJob(
    jobName: string,
    opts: {
      image: string;
      env: Record<string, string>;
      secretMounts: SecretMount[];
      memory: string;
      cpus: string;
      serviceAccount: string;
    }
  ): Promise<void> {
    const { gcpProject, region } = this.config;
    const parent = `projects/${gcpProject}/locations/${region}`;
    const fullName = `${parent}/jobs/${jobName}`;

    // Build volume mounts and volumes from secret mounts
    const volumes: Array<Record<string, unknown>> = [];
    const volumeMounts: Array<Record<string, string>> = [];

    for (let i = 0; i < opts.secretMounts.length; i++) {
      const mount = opts.secretMounts[i];
      const volName = `secret-${i}`;
      volumes.push({
        name: volName,
        secret: {
          secret: `projects/${gcpProject}/secrets/${mount.secretId}`,
          items: [{ version: "latest", path: mount.mountPath.split("/").pop()! }],
        },
      });
      // Mount the volume at the parent directory of the target path
      const parentDir = mount.mountPath.split("/").slice(0, -1).join("/");
      volumeMounts.push({ name: volName, mountPath: parentDir });
    }

    // Deduplicate volume mounts with the same mountPath — Cloud Run only allows
    // one mount per path, so we need to use a single volume per directory
    const mountsByDir = new Map<string, SecretMount[]>();
    for (const mount of opts.secretMounts) {
      const dir = mount.mountPath.split("/").slice(0, -1).join("/");
      if (!mountsByDir.has(dir)) mountsByDir.set(dir, []);
      mountsByDir.get(dir)!.push(mount);
    }

    // Rebuild volumes/mounts properly — one volume per unique directory
    volumes.length = 0;
    volumeMounts.length = 0;
    let volIdx = 0;
    for (const [dir, mounts] of mountsByDir) {
      const volName = `secrets-${volIdx++}`;
      volumes.push({
        name: volName,
        secret: {
          // For multi-file secret volumes, use items to map each secret
          // Cloud Run requires using secret references
          items: mounts.map((m) => ({
            version: "latest",
            path: m.mountPath.split("/").pop()!,
            secret: `projects/${gcpProject}/secrets/${m.secretId}`,
          })),
        },
      });
      volumeMounts.push({ name: volName, mountPath: dir });
    }

    const envVars = Object.entries(opts.env).map(([name, value]) => ({ name, value }));

    // Derive timeout from TIMEOUT_SECONDS env var (set by container-runner)
    const timeoutSeconds = opts.env.TIMEOUT_SECONDS || "3600";

    const jobSpec = {
      template: {
        template: {
          containers: [{
            image: opts.image,
            env: envVars,
            resources: {
              limits: {
                memory: opts.memory,
                cpu: opts.cpus,
              },
            },
            volumeMounts,
          }],
          volumes,
          serviceAccount: opts.serviceAccount,
          timeout: `${timeoutSeconds}s`,
          maxRetries: 0,
        },
      },
    };

    // Try to update existing job, create if not found
    const updateRes = await this.gcpRequest(
      "PATCH",
      `https://run.googleapis.com/v2/${fullName}`,
      jobSpec
    );

    if (updateRes.status === 404) {
      await updateRes.text(); // drain
      const createRes = await this.gcpRequest(
        "POST",
        `https://run.googleapis.com/v2/${parent}/jobs?jobId=${jobName}`,
        jobSpec
      );
      if (!createRes.ok) {
        const body = await createRes.text();
        throw new Error(`Failed to create Cloud Run job ${jobName}: ${createRes.status} ${body}`);
      }
      await createRes.text(); // drain
    } else if (!updateRes.ok) {
      const body = await updateRes.text();
      throw new Error(`Failed to update Cloud Run job ${jobName}: ${updateRes.status} ${body}`);
    } else {
      await updateRes.text(); // drain
    }
  }

  private async executeJob(jobName: string): Promise<string> {
    const { gcpProject, region } = this.config;
    const fullName = `projects/${gcpProject}/locations/${region}/jobs/${jobName}`;

    const res = await this.gcpRequest(
      "POST",
      `https://run.googleapis.com/v2/${fullName}:run`,
      {}
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to execute Cloud Run job ${jobName}: ${res.status} ${body}`);
    }

    const data = await res.json() as { metadata?: { name: string }; name?: string };
    // The response is an Operation; the execution name is in metadata or name
    return data.metadata?.name || data.name || fullName;
  }

  private async getExecutionStatus(executionName: string): Promise<{
    succeeded: boolean;
    failed: boolean;
    cancelled: boolean;
  }> {
    const res = await this.gcpRequest("GET", `https://run.googleapis.com/v2/${executionName}`);

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to get execution status: ${res.status} ${body}`);
    }

    const data = await res.json() as {
      conditions?: Array<{ type: string; state: string }>;
      completionTime?: string;
      cancelledCount?: number;
      failedCount?: number;
      succeededCount?: number;
    };

    // Check terminal conditions
    const completed = data.conditions?.find((c) => c.type === "Completed");
    if (!completed || completed.state !== "CONDITION_SUCCEEDED") {
      // Not done yet — check if explicitly failed or cancelled
      return {
        succeeded: false,
        failed: (data.failedCount ?? 0) > 0,
        cancelled: (data.cancelledCount ?? 0) > 0,
      };
    }

    return {
      succeeded: (data.succeededCount ?? 0) > 0,
      failed: (data.failedCount ?? 0) > 0,
      cancelled: (data.cancelledCount ?? 0) > 0,
    };
  }

  private async readLogs(
    executionName: string,
    afterTimestamp?: string
  ): Promise<Array<{ timestamp?: string; textPayload?: string; jsonPayload?: unknown }>> {
    const token = await this.getAccessToken();

    // Extract execution short name for the filter
    const execShortName = executionName.split("/").pop()!;
    let filter = `resource.type="cloud_run_job" AND labels."run.googleapis.com/execution_name"="${execShortName}"`;
    if (afterTimestamp) {
      filter += ` AND timestamp>"${afterTimestamp}"`;
    }

    const params = new URLSearchParams({
      resourceNames: `projects/${this.config.gcpProject}`,
      filter,
      orderBy: "timestamp asc",
      pageSize: "100",
    });

    const res = await fetch(`https://logging.googleapis.com/v2/entries:list`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        resourceNames: [`projects/${this.config.gcpProject}`],
        filter,
        orderBy: "timestamp asc",
        pageSize: 100,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Cloud Logging read failed: ${res.status} ${body}`);
    }

    const data = await res.json() as {
      entries?: Array<{ timestamp?: string; textPayload?: string; jsonPayload?: unknown }>;
    };

    return data.entries || [];
  }

  // --- Internal: Auth ---

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry - 60_000) {
      return this.accessToken;
    }

    // GCP_SERVICE_ACCOUNT_KEY env var (JSON key for CI/Railway)
    const saKeyJson = process.env.GCP_SERVICE_ACCOUNT_KEY;
    if (saKeyJson) {
      return this.getTokenFromServiceAccountKey(JSON.parse(saKeyJson));
    }

    // Fall back to gcloud ADC
    return this.getTokenFromGcloud();
  }

  private async getTokenFromServiceAccountKey(key: {
    client_email: string;
    private_key: string;
    token_uri: string;
  }): Promise<string> {
    const { createSign } = await import("crypto");

    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const claims = Buffer.from(JSON.stringify({
      iss: key.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: key.token_uri,
      iat: now,
      exp: now + 3600,
    })).toString("base64url");

    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${claims}`);
    const signature = signer.sign(key.private_key, "base64url");
    const jwt = `${header}.${claims}.${signature}`;

    const res = await fetch(key.token_uri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to get access token: ${res.status} ${body}`);
    }

    const data = await res.json() as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + data.expires_in * 1000;
    return this.accessToken;
  }

  private async getTokenFromGcloud(): Promise<string> {
    try {
      const token = execFileSync("gcloud", ["auth", "application-default", "print-access-token"], {
        encoding: "utf-8",
        timeout: 10_000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      this.accessToken = token;
      this.tokenExpiry = Date.now() + 3500_000;
      return token;
    } catch (err: any) {
      throw new Error(
        "Failed to get GCP access token. Either:\n" +
        "  1. Set GCP_SERVICE_ACCOUNT_KEY env var with a service account JSON key, or\n" +
        "  2. Run: gcloud auth application-default login\n" +
        `Original error: ${err.message}`
      );
    }
  }

  private async gcpRequest(method: string, url: string, body?: unknown): Promise<Response> {
    const token = await this.getAccessToken();
    return fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  private dockerExec(...args: string[]): string {
    return execFileSync("docker", args, {
      encoding: "utf-8",
      timeout: 300_000, // 5 min for push
    }).trim();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
