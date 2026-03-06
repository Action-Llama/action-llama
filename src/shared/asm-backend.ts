import {
  SecretsManagerClient,
  GetSecretValueCommand,
  CreateSecretCommand,
  PutSecretValueCommand,
  ListSecretsCommand,
} from "@aws-sdk/client-secrets-manager";
import type { CredentialBackend, CredentialEntry } from "./credential-backend.js";
import { AWS_CONSTANTS } from "./aws-constants.js";

/**
 * AWS Secrets Manager credential backend.
 * Maps type/instance/field -> secret name: <prefix>/<type>/<instance>/<field>
 *
 * Uses the AWS SDK v3 with the default credential provider chain:
 * 1. Environment variables (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)
 * 2. Shared credentials file (~/.aws/credentials)
 * 3. SSO / IAM instance roles
 */
export class AwsSecretsManagerBackend implements CredentialBackend {
  private client: SecretsManagerClient;
  private prefix: string;

  constructor(awsRegion: string, secretPrefix = AWS_CONSTANTS.DEFAULT_SECRET_PREFIX) {
    this.client = new SecretsManagerClient({ region: awsRegion });
    this.prefix = secretPrefix;
  }

  private secretName(type: string, instance: string, field: string): string {
    return `${this.prefix}/${type}/${instance}/${field}`;
  }

  private parseSecretName(name: string): { type: string; instance: string; field: string } | null {
    const parts = name.split("/");
    if (parts.length !== 4 || parts[0] !== this.prefix) return null;
    return { type: parts[1], instance: parts[2], field: parts[3] };
  }

  async read(type: string, instance: string, field: string): Promise<string | undefined> {
    try {
      const res = await this.client.send(new GetSecretValueCommand({
        SecretId: this.secretName(type, instance, field),
      }));
      return res.SecretString;
    } catch (err: any) {
      if (err.name === "ResourceNotFoundException") return undefined;
      throw err;
    }
  }

  async write(type: string, instance: string, field: string, value: string): Promise<void> {
    const name = this.secretName(type, instance, field);
    try {
      await this.client.send(new CreateSecretCommand({ Name: name, SecretString: value }));
    } catch (err: any) {
      if (err.name === "ResourceExistsException") {
        await this.client.send(new PutSecretValueCommand({ SecretId: name, SecretString: value }));
      } else {
        throw err;
      }
    }
  }

  async list(): Promise<CredentialEntry[]> {
    const entries: CredentialEntry[] = [];
    let nextToken: string | undefined;

    do {
      const res = await this.client.send(new ListSecretsCommand({
        Filters: [{ Key: "name", Values: [`${this.prefix}/`] }],
        MaxResults: 100,
        NextToken: nextToken,
      }));

      for (const secret of res.SecretList || []) {
        if (secret.Name) {
          const parsed = this.parseSecretName(secret.Name);
          if (parsed) entries.push(parsed);
        }
      }

      nextToken = res.NextToken;
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
}
