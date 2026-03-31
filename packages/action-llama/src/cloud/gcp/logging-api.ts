/**
 * Cloud Logging v2 REST API client.
 * Plain fetch() wrapper — no SDK dependency.
 */

import { gcpFetch } from "./cloud-run-api.js";
import type { GcpAuth } from "./auth.js";

const BASE_URL = "https://logging.googleapis.com/v2";

export interface LogEntry {
  logName?: string;
  textPayload?: string;
  jsonPayload?: Record<string, any>;
  timestamp?: string;
  insertId?: string;
  severity?: string;
  resource?: {
    type: string;
    labels: Record<string, string>;
  };
}

export interface ListLogEntriesResponse {
  entries?: LogEntry[];
  nextPageToken?: string;
}

export async function listLogEntries(
  auth: GcpAuth,
  project: string,
  filter: string,
  pageSize?: number,
  orderBy?: string,
  pageToken?: string,
): Promise<ListLogEntriesResponse> {
  const url = `${BASE_URL}/entries:list`;
  const body: Record<string, any> = {
    resourceNames: [`projects/${project}`],
    filter,
  };
  if (pageSize) body.pageSize = pageSize;
  if (orderBy) body.orderBy = orderBy;
  if (pageToken) body.pageToken = pageToken;

  return gcpFetch(auth, url, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Build a Cloud Logging filter for Cloud Run Job logs.
 */
export function buildJobLogFilter(
  region: string,
  jobId: string,
  afterTimestamp?: string,
): string {
  let filter = `resource.type="cloud_run_job" AND resource.labels.job_name="${jobId}" AND resource.labels.location="${region}"`;
  if (afterTimestamp) {
    filter += ` AND timestamp>"${afterTimestamp}"`;
  }
  return filter;
}

/**
 * Extract the text content from a log entry.
 */
export function extractLogText(entry: LogEntry): string {
  if (entry.textPayload) return entry.textPayload;
  if (entry.jsonPayload) return JSON.stringify(entry.jsonPayload);
  return "";
}
