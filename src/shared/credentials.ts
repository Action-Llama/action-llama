import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { resolve } from "path";
import { CREDENTIALS_DIR } from "./paths.js";

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

/**
 * Load a single field from a credential instance.
 */
export function loadCredentialField(type: string, instance: string, field: string): string | undefined {
  const filepath = resolve(credentialDir(type, instance), field);
  if (!existsSync(filepath)) return undefined;
  return readFileSync(filepath, "utf-8").trim();
}

/**
 * Load all fields from a credential instance.
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
 * Write a single field to a credential instance.
 */
export function writeCredentialField(type: string, instance: string, field: string, value: string): void {
  const dir = credentialDir(type, instance);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(resolve(dir, field), value + "\n", { mode: 0o600 });
}

/**
 * Write all fields to a credential instance.
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
