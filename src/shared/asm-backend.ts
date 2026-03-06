import { createHash, createHmac } from "crypto";
import type { CredentialBackend, CredentialEntry } from "./credential-backend.js";

/**
 * AWS Secrets Manager credential backend.
 * Maps type/instance/field → secret name: <prefix>/<type>/<instance>/<field>
 *
 * Uses the AWS Secrets Manager REST API directly (no SDK dependency) with
 * AWS Sigv4 request signing.
 *
 * Auth resolution order:
 * 1. AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars
 * 2. AWS CLI profile (`aws configure export-credentials`)
 */
export class AwsSecretsManagerBackend implements CredentialBackend {
  private region: string;
  private prefix: string;

  constructor(awsRegion: string, secretPrefix = "action-llama") {
    this.region = awsRegion;
    this.prefix = secretPrefix;
  }

  private secretName(type: string, instance: string, field: string): string {
    // AWS SM allows [a-zA-Z0-9/_+=.@-] — use slashes as separators
    return `${this.prefix}/${type}/${instance}/${field}`;
  }

  private parseSecretName(name: string): { type: string; instance: string; field: string } | null {
    const parts = name.split("/");
    if (parts.length !== 4 || parts[0] !== this.prefix) return null;
    return { type: parts[1], instance: parts[2], field: parts[3] };
  }

  async read(type: string, instance: string, field: string): Promise<string | undefined> {
    const name = this.secretName(type, instance, field);
    try {
      const data = await this.apiRequest("secretsmanager.GetSecretValue", {
        SecretId: name,
      });
      return data.SecretString;
    } catch (err: any) {
      if (err.message?.includes("ResourceNotFoundException")) return undefined;
      throw err;
    }
  }

  async write(type: string, instance: string, field: string, value: string): Promise<void> {
    const name = this.secretName(type, instance, field);

    // Try to create; if already exists, update
    try {
      await this.apiRequest("secretsmanager.CreateSecret", {
        Name: name,
        SecretString: value,
      });
    } catch (err: any) {
      if (err.message?.includes("ResourceExistsException")) {
        await this.apiRequest("secretsmanager.PutSecretValue", {
          SecretId: name,
          SecretString: value,
        });
      } else {
        throw err;
      }
    }
  }

  async list(): Promise<CredentialEntry[]> {
    const entries: CredentialEntry[] = [];
    let nextToken: string | undefined;

    do {
      const params: Record<string, unknown> = {
        Filters: [{ Key: "name", Values: [`${this.prefix}/`] }],
        MaxResults: 100,
      };
      if (nextToken) params.NextToken = nextToken;

      const data = await this.apiRequest("secretsmanager.ListSecrets", params);

      for (const secret of data.SecretList || []) {
        const parsed = this.parseSecretName(secret.Name);
        if (parsed) entries.push(parsed);
      }

      nextToken = data.NextToken;
    } while (nextToken);

    return entries;
  }

  async exists(type: string, instance: string): Promise<boolean> {
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

  // --- AWS API ---

  private async apiRequest(target: string, body: unknown): Promise<any> {
    const service = "secretsmanager";
    const host = `${service}.${this.region}.amazonaws.com`;
    const url = `https://${host}/`;
    const bodyStr = JSON.stringify(body);

    const headers = this.signRequest("POST", host, service, bodyStr);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": target,
      },
      body: bodyStr,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AWS ${service} ${target} failed: ${res.status} ${text}`);
    }

    return res.json();
  }

  private signRequest(
    method: string,
    host: string,
    service: string,
    body: string
  ): Record<string, string> {
    const { accessKeyId, secretAccessKey, sessionToken } = this.getAwsCredentials();

    const now = new Date();
    const dateStamp = now.toISOString().replace(/[-:]/g, "").slice(0, 8);
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z/, "Z");

    const bodyHash = createHash("sha256").update(body).digest("hex");

    const canonicalHeaders = `host:${host}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = "host;x-amz-date";

    const canonicalRequest = [
      method, "/", "",
      canonicalHeaders,
      signedHeaders,
      bodyHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${this.region}/${service}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");

    const signingKey = this.getSignatureKey(secretAccessKey, dateStamp, this.region, service);
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

    const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const headers: Record<string, string> = {
      "Host": host,
      "X-Amz-Date": amzDate,
      "Authorization": authHeader,
    };

    if (sessionToken) {
      headers["X-Amz-Security-Token"] = sessionToken;
    }

    return headers;
  }

  private getSignatureKey(key: string, dateStamp: string, region: string, service: string): Buffer {
    const kDate = createHmac("sha256", `AWS4${key}`).update(dateStamp).digest();
    const kRegion = createHmac("sha256", kDate).update(region).digest();
    const kService = createHmac("sha256", kRegion).update(service).digest();
    return createHmac("sha256", kService).update("aws4_request").digest();
  }

  private getAwsCredentials(): {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  } {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    if (accessKeyId && secretAccessKey) {
      return {
        accessKeyId,
        secretAccessKey,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      };
    }

    // Fall back to AWS CLI
    try {
      const { execFileSync } = require("child_process");
      const credsOutput: string = execFileSync("aws", [
        "configure", "export-credentials",
        "--format", "env",
      ], { encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] });

      const creds: Record<string, string> = {};
      for (const line of credsOutput.split("\n")) {
        const match = line.match(/^export\s+(\w+)=(.+)$/);
        if (match) creds[match[1]] = match[2].replace(/^"|"$/g, "");
      }

      if (creds.AWS_ACCESS_KEY_ID && creds.AWS_SECRET_ACCESS_KEY) {
        return {
          accessKeyId: creds.AWS_ACCESS_KEY_ID,
          secretAccessKey: creds.AWS_SECRET_ACCESS_KEY,
          sessionToken: creds.AWS_SESSION_TOKEN,
        };
      }
    } catch { /* fall through */ }

    throw new Error(
      "No AWS credentials found. Either:\n" +
      "  1. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY env vars, or\n" +
      "  2. Configure AWS CLI: aws configure"
    );
  }
}
