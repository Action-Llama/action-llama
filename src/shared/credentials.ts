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
 * Set the default credential backend (e.g. when using --env).
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
 * Parse a credential reference into its parts.
 *
 * Supported formats:
 * - "github_token"                → type="github_token", instance=undefined (needs agent context)
 * - "other-agent/github_token"    → type="github_token", agentRef="other-agent"
 *
 * Legacy format (deprecated):
 * - "github_token:default"        → type="github_token", instance="default" (with warning)
 * - "github_token:custom"         → type="github_token", instance=undefined (ignored, with warning)
 */
export function parseCredentialRef(ref: string): { type: string; instance: string; agentRef?: string } {
  // Cross-agent reference: "other-agent/type"
  const slashIdx = ref.indexOf("/");
  if (slashIdx !== -1) {
    const agentRef = ref.slice(0, slashIdx).trim();
    const type = ref.slice(slashIdx + 1).trim();
    return { type, instance: "default", agentRef };
  }

  // Legacy colon syntax: "type:instance"
  const colonIdx = ref.indexOf(":");
  if (colonIdx !== -1) {
    const type = ref.slice(0, colonIdx).trim();
    const instance = ref.slice(colonIdx + 1).trim();
    // Emit deprecation warning for legacy syntax
    if (!_suppressLegacyWarning) {
      console.error(
        `[DEPRECATED] Credential reference "${ref}" uses legacy "type:instance" syntax. ` +
        `Use just "${type}" instead. Instance is now derived from agent name.`
      );
    }
    // In legacy mode, keep the instance as-is for backwards compatibility
    return { type, instance };
  }

  // Simple type reference: "github_token"
  return { type: ref.trim(), instance: "default" };
}

// Allow suppressing legacy warnings in tests
let _suppressLegacyWarning = false;
export function suppressLegacyWarning(suppress: boolean): void {
  _suppressLegacyWarning = suppress;
}

/**
 * Resolve credentials for an agent.
 *
 * For each credential ref, resolves instance using the agent-specific → default fallback:
 * 1. Check `type/<agentName>/` → agent-specific
 * 2. Fall back to `type/default/` → shared
 *
 * Cross-agent refs "other-agent/type" check:
 * 1. `type/<other-agent>/` → that agent's specific credential
 * 2. Fall back to `type/default/` → shared
 *
 * Returns an array of { type, instance } pairs with resolved instances.
 */
export async function resolveAgentCredentials(
  agentName: string,
  credentialRefs: string[],
): Promise<Array<{ type: string; instance: string }>> {
  const resolved: Array<{ type: string; instance: string }> = [];

  for (const ref of credentialRefs) {
    const parsed = parseCredentialRef(ref);

    if (parsed.agentRef) {
      // Cross-agent reference: check other-agent first, then default
      if (await _defaultBackend.exists(parsed.type, parsed.agentRef)) {
        resolved.push({ type: parsed.type, instance: parsed.agentRef });
      } else {
        resolved.push({ type: parsed.type, instance: "default" });
      }
    } else if (parsed.instance !== "default") {
      // Legacy explicit instance — use as-is
      resolved.push({ type: parsed.type, instance: parsed.instance });
    } else {
      // Standard: check agent-specific first, then default
      if (await _defaultBackend.exists(parsed.type, agentName)) {
        resolved.push({ type: parsed.type, instance: agentName });
      } else {
        resolved.push({ type: parsed.type, instance: "default" });
      }
    }
  }

  return resolved;
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
