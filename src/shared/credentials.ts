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
      `Credential "${name}" not found at ${resolve(CREDENTIALS_DIR, name)}. Run 'al init' first.`
    );
  }
  return value;
}

export function writeCredential(name: string, value: string): void {
  mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(resolve(CREDENTIALS_DIR, name), value + "\n", { mode: 0o600 });
}
