/**
 * SSH filesystem credential backend.
 * Same path layout as FilesystemBackend but all operations over SSH.
 * Used to push/read credentials on a VPS.
 */

import type { CredentialBackend, CredentialEntry } from "./credential-backend.js";
import { sshExec, scpBuffer, type SshConfig } from "../cloud/vps/ssh.js";
import { VPS_CONSTANTS } from "../cloud/vps/constants.js";

export class SshFilesystemBackend implements CredentialBackend {
  private sshConfig: SshConfig;
  private baseDir: string;

  constructor(sshConfig: SshConfig, baseDir?: string) {
    this.sshConfig = sshConfig;
    this.baseDir = baseDir || VPS_CONSTANTS.REMOTE_CREDENTIALS_DIR;
  }

  async read(type: string, instance: string, field: string): Promise<string | undefined> {
    const path = `${this.baseDir}/${type}/${instance}/${field}`;
    const result = await sshExec(this.sshConfig, `cat '${path}' 2>/dev/null`);
    if (result.exitCode !== 0) return undefined;
    return result.stdout.trim() || undefined;
  }

  async write(type: string, instance: string, field: string, value: string): Promise<void> {
    const path = `${this.baseDir}/${type}/${instance}/${field}`;
    await scpBuffer(this.sshConfig, value + "\n", path);
  }

  async list(): Promise<CredentialEntry[]> {
    const result = await sshExec(
      this.sshConfig,
      `find ${this.baseDir} -type f 2>/dev/null | sort`,
      60_000,
    );
    if (result.exitCode !== 0 || !result.stdout) return [];

    const entries: CredentialEntry[] = [];
    for (const line of result.stdout.split("\n").filter(Boolean)) {
      // line: ~/.action-llama/credentials/type/instance/field
      const rel = line.replace(this.baseDir + "/", "");
      const parts = rel.split("/");
      if (parts.length === 3) {
        entries.push({ type: parts[0], instance: parts[1], field: parts[2] });
      }
    }
    return entries;
  }

  async exists(type: string, instance: string): Promise<boolean> {
    const path = `${this.baseDir}/${type}/${instance}`;
    const result = await sshExec(this.sshConfig, `test -d '${path}' && ls '${path}' | head -1`);
    return result.exitCode === 0 && result.stdout.length > 0;
  }

  async readAll(type: string, instance: string): Promise<Record<string, string> | undefined> {
    const dir = `${this.baseDir}/${type}/${instance}`;
    const result = await sshExec(this.sshConfig, `ls '${dir}' 2>/dev/null`);
    if (result.exitCode !== 0 || !result.stdout) return undefined;

    const fields: Record<string, string> = {};
    for (const field of result.stdout.split("\n").filter(Boolean)) {
      const value = await this.read(type, instance, field);
      if (value !== undefined) fields[field] = value;
    }
    return Object.keys(fields).length > 0 ? fields : undefined;
  }

  async writeAll(type: string, instance: string, fields: Record<string, string>): Promise<void> {
    for (const [field, value] of Object.entries(fields)) {
      await this.write(type, instance, field, value);
    }
  }

  async listInstances(type: string): Promise<string[]> {
    const dir = `${this.baseDir}/${type}`;
    const result = await sshExec(this.sshConfig, `ls -d '${dir}'/*/ 2>/dev/null | xargs -I{} basename {}`);
    if (result.exitCode !== 0 || !result.stdout) return [];
    return result.stdout.split("\n").filter(Boolean);
  }
}
