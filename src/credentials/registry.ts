import type { CredentialDefinition } from "./schema.js";
import { builtinCredentials } from "./builtins/index.js";

/**
 * Resolve a credential definition by ID.
 * Looks up built-in credentials shipped with action-llama.
 */
export function resolveCredential(id: string): CredentialDefinition {
  if (builtinCredentials[id]) {
    return builtinCredentials[id];
  }

  throw new Error(`Unknown credential "${id}".`);
}

/**
 * Get a built-in credential definition by ID.
 * Returns undefined if not a built-in.
 */
export function getBuiltinCredential(id: string): CredentialDefinition | undefined {
  return builtinCredentials[id];
}

/**
 * List all built-in credential IDs.
 */
export function listBuiltinCredentialIds(): string[] {
  return Object.keys(builtinCredentials);
}
