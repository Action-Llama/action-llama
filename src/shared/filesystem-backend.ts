import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import { CREDENTIALS_DIR } from "./paths.js";
import type { CredentialBackend, CredentialEntry } from "./credential-backend.js";

/**
 * Filesystem credential backend.
 * Stores credentials at ~/.action-llama-credentials/<type>/<instance>/<field>.
 * This is the default local-first backend.
 */
export class FilesystemBackend implements CredentialBackend {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || CREDENTIALS_DIR;
  }

  // Static sync methods for compatibility during migration
  static readSync(type: string, instance: string, field: string, baseDir?: string): string | undefined {
    const dir = baseDir || CREDENTIALS_DIR;
    const filepath = resolve(dir, type, instance, field);
    if (!existsSync(filepath)) return undefined;
    return readFileSync(filepath, "utf-8").trim();
  }

  static writeSync(type: string, instance: string, field: string, value: string, baseDir?: string): void {
    const dir = baseDir || CREDENTIALS_DIR;
    const instDir = resolve(dir, type, instance);
    mkdirSync(instDir, { recursive: true, mode: 0o700 });
    writeFileSync(resolve(instDir, field), value + "\n", { mode: 0o600 });
  }

  static readAllSync(type: string, instance: string, baseDir?: string): Record<string, string> | undefined {
    const dir = baseDir || CREDENTIALS_DIR;
    const instDir = resolve(dir, type, instance);
    if (!existsSync(instDir)) return undefined;

    const result: Record<string, string> = {};
    for (const file of readdirSync(instDir)) {
      const filepath = resolve(instDir, file);
      if (safeIsDir(filepath)) continue;
      result[file] = readFileSync(filepath, "utf-8").trim();
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  static existsSync(type: string, instance: string, baseDir?: string): boolean {
    const dir = baseDir || CREDENTIALS_DIR;
    const instDir = resolve(dir, type, instance);
    if (!existsSync(instDir)) return false;
    return readdirSync(instDir).length > 0;
  }

  async read(type: string, instance: string, field: string): Promise<string | undefined> {
    const filepath = resolve(this.baseDir, type, instance, field);
    if (!existsSync(filepath)) return undefined;
    return readFileSync(filepath, "utf-8").trim();
  }

  async write(type: string, instance: string, field: string, value: string): Promise<void> {
    const dir = resolve(this.baseDir, type, instance);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(resolve(dir, field), value + "\n", { mode: 0o600 });
  }

  async list(): Promise<CredentialEntry[]> {
    const entries: CredentialEntry[] = [];
    if (!existsSync(this.baseDir)) return entries;

    for (const type of readdirSync(this.baseDir)) {
      const typePath = resolve(this.baseDir, type);
      if (!safeIsDir(typePath)) continue;

      for (const instance of readdirSync(typePath)) {
        const instPath = resolve(typePath, instance);
        if (!safeIsDir(instPath)) continue;

        for (const field of readdirSync(instPath)) {
          const fieldPath = resolve(instPath, field);
          if (safeIsDir(fieldPath)) continue; // skip subdirectories
          entries.push({ type, instance, field });
        }
      }
    }

    return entries;
  }

  async exists(type: string, instance: string): Promise<boolean> {
    const dir = resolve(this.baseDir, type, instance);
    if (!existsSync(dir)) return false;
    return readdirSync(dir).length > 0;
  }

  async readAll(type: string, instance: string): Promise<Record<string, string> | undefined> {
    const dir = resolve(this.baseDir, type, instance);
    if (!existsSync(dir)) return undefined;

    const result: Record<string, string> = {};
    for (const file of readdirSync(dir)) {
      const filepath = resolve(dir, file);
      if (safeIsDir(filepath)) continue;
      result[file] = readFileSync(filepath, "utf-8").trim();
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  async writeAll(type: string, instance: string, fields: Record<string, string>): Promise<void> {
    for (const [field, value] of Object.entries(fields)) {
      await this.write(type, instance, field, value);
    }
  }

  async listInstances(type: string): Promise<string[]> {
    const dir = resolve(this.baseDir, type);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((entry) => safeIsDir(resolve(dir, entry)));
  }
}

function safeIsDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
