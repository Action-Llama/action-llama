import { resolve } from "path";
import { CREDENTIALS_DIR } from "./paths.js";
import type { CredentialBackend } from "./credential-backend.js";
import { FilesystemBackend } from "./filesystem-backend.js";
import { CredentialError } from "./errors.js";

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

// --- Unified async API (backend-aware) ---
// These functions delegate to the default backend (local filesystem or remote).

/**
 * Load a single field from a credential instance.
 */
export async function loadCredentialField(type: string, instance: string, field: string): Promise<string | undefined> {
  return _defaultBackend.read(type, instance, field);
}

/**
 * Load all fields from a credential instance.
 * Returns undefined if the instance directory does not exist.
 */
export async function loadCredentialFields(type: string, instance: string): Promise<Record<string, string> | undefined> {
  return _defaultBackend.readAll(type, instance);
}

/**
 * Write a single field to a credential instance.
 */
export async function writeCredentialField(type: string, instance: string, field: string, value: string): Promise<void> {
  return _defaultBackend.write(type, instance, field, value);
}

/**
 * Write all fields to a credential instance.
 */
export async function writeCredentialFields(type: string, instance: string, fields: Record<string, string>): Promise<void> {
  return _defaultBackend.writeAll(type, instance, fields);
}

/**
 * Check if a credential instance exists (has at least one field file).
 */
export async function credentialExists(type: string, instance: string): Promise<boolean> {
  return _defaultBackend.exists(type, instance);
}

/**
 * List all instances of a credential type.
 * Returns an array of instance names (subdirectory names).
 */
export async function listCredentialInstances(type: string): Promise<string[]> {
  return _defaultBackend.listInstances(type);
}

/**
 * Require that a credential instance exists. Throws if missing.
 */
export async function requireCredentialRef(ref: string): Promise<void> {
  const { type, instance } = parseCredentialRef(ref);
  const exists = await _defaultBackend.exists(type, instance);
  if (!exists) {
    throw new CredentialError(
      `Credential "${ref}" not found. Run 'al doctor' to configure it.`
    );
  }
}

// --- Env-var-safe encoding for credential parts ---
// AWS Lambda (and ECS) require env var keys to match [a-zA-Z][a-zA-Z0-9_]+.
// Credential instance names may contain hyphens or dots, so we encode them.

/**
 * Encode a credential part (type, instance, or field) for use in an env var name.
 * Replaces any character that isn't [a-zA-Z0-9_] with _xHH (hex code).
 */
export function sanitizeEnvPart(part: string): string {
  return part.replace(/[^a-zA-Z0-9_]/g, (ch) => {
    return `_x${ch.charCodeAt(0).toString(16).padStart(2, "0")}`;
  });
}

/**
 * Decode an env-var-safe credential part back to the original string.
 * Reverses the encoding done by sanitizeEnvPart.
 */
export function unsanitizeEnvPart(encoded: string): string {
  return encoded.replace(/_x([0-9a-f]{2})/g, (_, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });
}


