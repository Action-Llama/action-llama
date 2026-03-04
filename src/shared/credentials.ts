import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { CREDENTIALS_DIR } from "./paths.js";

export function loadCredential(name: string): string | undefined {
  const filepath = resolve(CREDENTIALS_DIR, name);
  if (!existsSync(filepath)) return undefined;
  return readFileSync(filepath, "utf-8").trim();
}

export function requireCredential(name: string): string {
  const value = loadCredential(name);
  if (!value) {
    throw new Error(
      `Credential "${name}" not found at ${resolve(CREDENTIALS_DIR, name)}. Run 'al new' first.`
    );
  }
  return value;
}

export function writeCredential(name: string, value: string): void {
  mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(resolve(CREDENTIALS_DIR, name), value + "\n", { mode: 0o600 });
}

// --- Structured credential support (multi-field, stored as JSON) ---

export function loadStructuredCredential(name: string): Record<string, string> | undefined {
  const filepath = resolve(CREDENTIALS_DIR, name);
  if (!existsSync(filepath)) return undefined;
  const raw = readFileSync(filepath, "utf-8").trim();
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return undefined;
  }
}

export function writeStructuredCredential(name: string, fields: Record<string, string>): void {
  mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(resolve(CREDENTIALS_DIR, name), JSON.stringify(fields) + "\n", { mode: 0o600 });
}
