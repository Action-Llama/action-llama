/**
 * Cloud Run Jobs v2 REST API client.
 * Plain fetch() wrapper — no SDK dependency.
 */

import type { GcpAuth } from "./auth.js";

const BASE_URL = "https://run.googleapis.com/v2";

export class GcpApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "GcpApiError";
  }
}

export async function gcpFetch(
  auth: GcpAuth,
  url: string,
  options: RequestInit = {},
): Promise<any> {
  const token = await auth.getAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new GcpApiError(res.status, `GCP API ${url} failed (HTTP ${res.status}): ${body}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export interface CloudRunEnvVar {
  name: string;
  value?: string;
}

export interface CloudRunVolumeMount {
  name: string;
  mountPath: string;
}

export interface CloudRunContainer {
  image: string;
  env?: CloudRunEnvVar[];
  volumeMounts?: CloudRunVolumeMount[];
  resources?: { limits?: { cpu?: string; memory?: string } };
}

export interface CloudRunVolume {
  name: string;
  secret?: {
    secret: string;
    items: Array<{ version: string; path: string; mode?: number }>;
  };
}

export interface CloudRunTaskTemplate {
  containers: CloudRunContainer[];
  volumes?: CloudRunVolume[];
  maxRetries?: number;
  timeout?: string;
  serviceAccount?: string;
}

export interface CloudRunJobTemplate {
  template: CloudRunTaskTemplate;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

export interface CloudRunJob {
  name: string;
  uid: string;
  createTime: string;
  updateTime: string;
  template: CloudRunJobTemplate;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

export interface CloudRunExecution {
  name: string;
  uid: string;
  createTime: string;
  completionTime?: string;
  conditions?: Array<{ type: string; state: string; message?: string }>;
  taskCount?: number;
  completedCount?: number;
  failedCount?: number;
}

export interface CloudRunOperation {
  name: string;
  done?: boolean;
  response?: any;
  error?: { code: number; message: string };
}

function jobPath(project: string, region: string, jobId: string): string {
  return `${BASE_URL}/projects/${project}/locations/${region}/jobs/${jobId}`;
}

export async function createJob(
  auth: GcpAuth,
  project: string,
  region: string,
  jobId: string,
  template: CloudRunJobTemplate,
): Promise<CloudRunOperation> {
  const url = `${BASE_URL}/projects/${project}/locations/${region}/jobs?jobId=${encodeURIComponent(jobId)}`;
  return gcpFetch(auth, url, {
    method: "POST",
    body: JSON.stringify({ template }),
  });
}

export async function getJob(
  auth: GcpAuth,
  project: string,
  region: string,
  jobId: string,
): Promise<CloudRunJob> {
  return gcpFetch(auth, jobPath(project, region, jobId));
}

export async function deleteJob(
  auth: GcpAuth,
  project: string,
  region: string,
  jobId: string,
): Promise<CloudRunOperation> {
  return gcpFetch(auth, jobPath(project, region, jobId), { method: "DELETE" });
}

export async function runJob(
  auth: GcpAuth,
  project: string,
  region: string,
  jobId: string,
  overrides?: Record<string, unknown>,
): Promise<CloudRunOperation> {
  const url = `${jobPath(project, region, jobId)}:run`;
  return gcpFetch(auth, url, {
    method: "POST",
    body: JSON.stringify(overrides ?? {}),
  });
}

export async function getExecution(
  auth: GcpAuth,
  _project: string,
  _region: string,
  executionName: string,
): Promise<CloudRunExecution> {
  return gcpFetch(auth, `${BASE_URL}/${executionName}`);
}

export async function listExecutions(
  auth: GcpAuth,
  project: string,
  region: string,
  jobId: string,
): Promise<CloudRunExecution[]> {
  const url = `${jobPath(project, region, jobId)}/executions`;
  const data = await gcpFetch(auth, url);
  return data?.executions ?? [];
}

export async function listJobs(
  auth: GcpAuth,
  project: string,
  region: string,
): Promise<CloudRunJob[]> {
  const url = `${BASE_URL}/projects/${project}/locations/${region}/jobs`;
  const data = await gcpFetch(auth, url);
  return data?.jobs ?? [];
}

/**
 * Poll an execution until it completes or times out.
 */
export async function pollExecutionUntilDone(
  auth: GcpAuth,
  project: string,
  region: string,
  executionName: string,
  timeoutMs: number,
  pollIntervalMs = 5000,
): Promise<CloudRunExecution> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const exec = await getExecution(auth, project, region, executionName);
    if (exec.completionTime) {
      return exec;
    }
    // Check if failed even without completionTime
    const completed = exec.conditions?.find((c) => c.type === "Completed");
    if (completed && completed.state !== "CONDITION_PENDING" && completed.state !== "CONDITION_RECONCILING") {
      return exec;
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error(`Execution ${executionName} timed out after ${timeoutMs}ms`);
}
