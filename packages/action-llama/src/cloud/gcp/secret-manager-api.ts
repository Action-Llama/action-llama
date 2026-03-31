/**
 * Secret Manager v1 REST API client.
 * Plain fetch() wrapper — no SDK dependency.
 */

import { gcpFetch } from "./cloud-run-api.js";
import type { GcpAuth } from "./auth.js";

const BASE_URL = "https://secretmanager.googleapis.com/v1";

function secretPath(project: string, secretId: string): string {
  return `${BASE_URL}/projects/${project}/secrets/${secretId}`;
}

export async function createSecret(
  auth: GcpAuth,
  project: string,
  secretId: string,
): Promise<any> {
  const url = `${BASE_URL}/projects/${project}/secrets?secretId=${encodeURIComponent(secretId)}`;
  return gcpFetch(auth, url, {
    method: "POST",
    body: JSON.stringify({ replication: { automatic: {} } }),
  });
}

export async function addSecretVersion(
  auth: GcpAuth,
  project: string,
  secretId: string,
  payload: string,
): Promise<any> {
  const url = `${secretPath(project, secretId)}:addVersion`;
  const data = Buffer.from(payload, "utf-8").toString("base64");
  return gcpFetch(auth, url, {
    method: "POST",
    body: JSON.stringify({ payload: { data } }),
  });
}

export async function deleteSecret(
  auth: GcpAuth,
  project: string,
  secretId: string,
): Promise<void> {
  await gcpFetch(auth, secretPath(project, secretId), { method: "DELETE" });
}

export async function accessSecretVersion(
  auth: GcpAuth,
  project: string,
  secretId: string,
  version = "latest",
): Promise<string> {
  const url = `${secretPath(project, secretId)}/versions/${version}:access`;
  const data = await gcpFetch(auth, url);
  return Buffer.from(data.payload.data, "base64").toString("utf-8");
}
