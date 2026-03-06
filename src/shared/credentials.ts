import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import { CREDENTIALS_DIR } from "./paths.js";
import type { CredentialBackend } from "./credential-backend.js";
import { FilesystemBackend } from "./filesystem-backend.js";

// Default backend instance (local filesystem)
let _defaultBackend: CredentialBackend = new FilesystemBackend();

/**
 * Get the current default credential backend.
 */
export function getDefaultBackend(): CredentialBackend {
  return _defaultBackend;
}

/**
 * Set the default credential backend (e.g. when using --remote).
 */
export function setDefaultBackend(backend: CredentialBackend): void {
  _defaultBackend = backend;
}

/**
 * Reset the default backend to the local filesystem.
 */
export function resetDefaultBackend(): void {
  _defaultBackend = new FilesystemBackend();
}

/**
 * Parse a credential reference "type:instance" into its parts.
 * If no instance is specified, defaults to "default".
 */
export function parseCredentialRef(ref: string): { type: string; instance: string } {
  const sep = ref.indexOf(":");
  if (sep === -1) return { type: ref, instance: "default" };
  return { type: ref.slice(0, sep).trim(), instance: ref.slice(sep + 1).trim() };
}

/**
 * Get the directory path for a credential instance.
 */
export function credentialDir(type: string, instance: string): string {
  return resolve(CREDENTIALS_DIR, type, instance);
}

// --- Synchronous filesystem functions (preserved for backward compatibility) ---
// These operate directly on the local filesystem regardless of the default backend.

/**
 * Load a single field from a credential instance (sync, local filesystem).
 */
export function loadCredentialField(type: string, instance: string, field: string): string | undefined {
  const filepath = resolve(credentialDir(type, instance), field);
  if (!existsSync(filepath)) return undefined;
  return readFileSync(filepath, "utf-8").trim();
}

/**
 * Load all fields from a credential instance (sync, local filesystem).
 * Returns undefined if the instance directory does not exist.
 */
export function loadCredentialFields(type: string, instance: string): Record<string, string> | undefined {
  const dir = credentialDir(type, instance);
  if (!existsSync(dir)) return undefined;

  const result: Record<string, string> = {};
  for (const file of readdirSync(dir)) {
    const filepath = resolve(dir, file);
    result[file] = readFileSync(filepath, "utf-8").trim();
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Write a single field to a credential instance (sync, local filesystem).
 */
export function writeCredentialField(type: string, instance: string, field: string, value: string): void {
  const dir = credentialDir(type, instance);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(resolve(dir, field), value + "\n", { mode: 0o600 });
}

/**
 * Write all fields to a credential instance (sync, local filesystem).
 */
export function writeCredentialFields(type: string, instance: string, fields: Record<string, string>): void {
  for (const [field, value] of Object.entries(fields)) {
    writeCredentialField(type, instance, field, value);
  }
}

/**
 * Check if a credential instance exists (has at least one field file).
 */
export function credentialExists(type: string, instance: string): boolean {
  const dir = credentialDir(type, instance);
  if (!existsSync(dir)) return false;
  return readdirSync(dir).length > 0;
}

/**
 * List all instances of a credential type.
 * Returns an array of instance names (subdirectory names).
 */
export function listCredentialInstances(type: string): string[] {
  const dir = resolve(CREDENTIALS_DIR, type);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((entry) => {
    try {
      return statSync(resolve(dir, entry)).isDirectory();
    } catch {
      return false;
    }
  });
}

/**
 * Require that a credential instance exists. Throws if missing.
 */
export function requireCredentialRef(ref: string): void {
  const { type, instance } = parseCredentialRef(ref);
  if (!credentialExists(type, instance)) {
    throw new Error(
      `Credential "${ref}" not found at ${credentialDir(type, instance)}. Run 'al setup' to configure it.`
    );
  }
}

// --- Async backend-aware functions ---
// These delegate to the default backend (local filesystem or remote).
// Use these in code paths that support --remote.

/**
 * Load a credential field via the default backend (async).
 */
export async function backendLoadField(type: string, instance: string, field: string): Promise<string | undefined> {
  return _defaultBackend.read(type, instance, field);
}

/**
 * Load all fields for a credential instance via the default backend (async).
 */
export async function backendLoadFields(type: string, instance: string): Promise<Record<string, string> | undefined> {
  return _defaultBackend.readAll(type, instance);
}

/**
 * Check if a credential instance exists via the default backend (async).
 */
export async function backendCredentialExists(type: string, instance: string): Promise<boolean> {
  return _defaultBackend.exists(type, instance);
}

/**
 * List instances of a credential type via the default backend (async).
 */
export async function backendListInstances(type: string): Promise<string[]> {
  return _defaultBackend.listInstances(type);
}

/**
 * Require that a credential instance exists via the default backend (async).
 */
export async function backendRequireCredentialRef(ref: string): Promise<void> {
  const { type, instance } = parseCredentialRef(ref);
  const exists = await _defaultBackend.exists(type, instance);
  if (!exists) {
    throw new Error(
      `Credential "${ref}" not found. Run 'al setup' to configure it.`
    );
  }
}
