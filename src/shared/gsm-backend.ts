import type { CredentialBackend, CredentialEntry } from "./credential-backend.js";
import { AWS_CONSTANTS } from "./aws-constants.js";

/**
 * Google Secret Manager credential backend.
 * Maps type/instance/field → secret name: <prefix>/<type>/<instance>/<field>
 *
 * Uses the Google Cloud REST API directly (no SDK dependency) with
 * Application Default Credentials via `google-auth-library` or a
 * service account key in GCP_SERVICE_ACCOUNT_KEY env var.
 *
 * Auth resolution order:
 * 1. GCP_SERVICE_ACCOUNT_KEY env var (JSON key — used on Railway/CI)
 * 2. GOOGLE_APPLICATION_CREDENTIALS env var (file path)
 * 3. gcloud auth application-default login (local dev)
 */
export class GoogleSecretManagerBackend implements CredentialBackend {
  private gcpProject: string;
  private prefix: string;
  private accessToken: string | undefined;
  private tokenExpiry = 0;

  constructor(gcpProject: string, secretPrefix = AWS_CONSTANTS.DEFAULT_SECRET_PREFIX) {
    this.gcpProject = gcpProject;
    this.prefix = secretPrefix;
  }

  private secretName(type: string, instance: string, field: string): string {
    // GSM secret names allow [a-zA-Z0-9_-] — we use dashes as separators
    // since slashes aren't allowed in secret IDs
    return `${this.prefix}--${type}--${instance}--${field}`;
  }

  private parseSecretName(name: string): { type: string; instance: string; field: string } | null {
    const parts = name.split("--");
    if (parts.length !== 4 || parts[0] !== this.prefix) return null;
    return { type: parts[1], instance: parts[2], field: parts[3] };
  }

  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 60s buffer)
    if (this.accessToken && Date.now() < this.tokenExpiry - 60_000) {
      return this.accessToken;
    }

    // Try GCP_SERVICE_ACCOUNT_KEY env var first (JSON key for Railway/CI)
    const saKeyJson = process.env.GCP_SERVICE_ACCOUNT_KEY;
    if (saKeyJson) {
      const token = await this.getTokenFromServiceAccountKey(JSON.parse(saKeyJson));
      return token;
    }

    // Fall back to Application Default Credentials via gcloud
    const token = await this.getTokenFromGcloud();
    return token;
  }

  private async getTokenFromServiceAccountKey(key: {
    client_email: string;
    private_key: string;
    token_uri: string;
  }): Promise<string> {
    // Build JWT for OAuth2 token exchange
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const claims = Buffer.from(JSON.stringify({
      iss: key.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: key.token_uri,
      iat: now,
      exp: now + 3600,
    })).toString("base64url");

    const { createSign } = await import("crypto");
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
      throw new Error(`Failed to get access token from service account: ${res.status} ${body}`);
    }

    const data = await res.json() as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + data.expires_in * 1000;
    return this.accessToken;
  }

  private async getTokenFromGcloud(): Promise<string> {
    const { execFileSync } = await import("child_process");
    try {
      const token = execFileSync("gcloud", ["auth", "application-default", "print-access-token"], {
        encoding: "utf-8",
        timeout: 10_000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      this.accessToken = token;
      // gcloud tokens typically last 1 hour
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

  private async apiRequest(method: string, path: string, body?: unknown): Promise<Response> {
    const token = await this.getAccessToken();
    const url = `https://secretmanager.googleapis.com/v1/${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res;
  }

  async read(type: string, instance: string, field: string): Promise<string | undefined> {
    const name = this.secretName(type, instance, field);
    const path = `projects/${this.gcpProject}/secrets/${name}/versions/latest:access`;
    const res = await this.apiRequest("GET", path);
    if (res.status === 404) return undefined;
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GSM read failed for ${name}: ${res.status} ${body}`);
    }
    const data = await res.json() as { payload: { data: string } };
    return Buffer.from(data.payload.data, "base64").toString("utf-8").trim();
  }

  async write(type: string, instance: string, field: string, value: string): Promise<void> {
    const name = this.secretName(type, instance, field);
    const secretPath = `projects/${this.gcpProject}/secrets/${name}`;

    // Try to create the secret (ignore if already exists)
    const createRes = await this.apiRequest("POST", `projects/${this.gcpProject}/secrets`, {
      secretId: name,
      replication: { automatic: {} },
    });
    if (!createRes.ok && createRes.status !== 409) {
      const body = await createRes.text();
      throw new Error(`GSM create secret failed for ${name}: ${createRes.status} ${body}`);
    }
    // Drain the response body
    if (createRes.status === 409) await createRes.text();

    // Add a new version with the value
    const addRes = await this.apiRequest("POST", `${secretPath}:addVersion`, {
      payload: { data: Buffer.from(value).toString("base64") },
    });
    if (!addRes.ok) {
      const body = await addRes.text();
      throw new Error(`GSM add version failed for ${name}: ${addRes.status} ${body}`);
    }
    await addRes.text(); // drain
  }

  async list(): Promise<CredentialEntry[]> {
    const entries: CredentialEntry[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({ filter: `name:${this.prefix}--` });
      if (pageToken) params.set("pageToken", pageToken);

      const res = await this.apiRequest(
        "GET",
        `projects/${this.gcpProject}/secrets?${params.toString()}`
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`GSM list failed: ${res.status} ${body}`);
      }

      const data = await res.json() as {
        secrets?: Array<{ name: string }>;
        nextPageToken?: string;
      };

      for (const secret of data.secrets || []) {
        // secret.name is fully qualified: projects/<id>/secrets/<secretId>
        const secretId = secret.name.split("/").pop()!;
        const parsed = this.parseSecretName(secretId);
        if (parsed) entries.push(parsed);
      }

      pageToken = data.nextPageToken;
    } while (pageToken);

    return entries;
  }

  async exists(type: string, instance: string): Promise<boolean> {
    // Check if any secret exists for this type/instance by trying to list with prefix
    const entries = await this.list();
    return entries.some((e) => e.type === type && e.instance === instance);
  }

  async readAll(type: string, instance: string): Promise<Record<string, string> | undefined> {
    const entries = await this.list();
    const matching = entries.filter((e) => e.type === type && e.instance === instance);
    if (matching.length === 0) return undefined;

    const result: Record<string, string> = {};
    for (const entry of matching) {
      const value = await this.read(type, instance, entry.field);
      if (value !== undefined) result[entry.field] = value;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  async writeAll(type: string, instance: string, fields: Record<string, string>): Promise<void> {
    for (const [field, value] of Object.entries(fields)) {
      await this.write(type, instance, field, value);
    }
  }

  async listInstances(type: string): Promise<string[]> {
    const entries = await this.list();
    const instances = new Set<string>();
    for (const entry of entries) {
      if (entry.type === type) instances.add(entry.instance);
    }
    return [...instances];
  }
}
