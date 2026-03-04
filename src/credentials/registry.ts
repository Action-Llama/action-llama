import type { CredentialDefinition } from "./schema.js";
import type { AgentDefinition } from "../agents/definitions/schema.js";
import { builtinCredentials } from "./builtins/index.js";

/**
 * Resolve a credential definition by ID.
 *
 * Resolution order:
 * 1. Inline definitions on the agent definition (if provided)
 * 2. Built-in credentials shipped with action-llama
 * 3. Throw if not found
 */
export function resolveCredential(
  id: string,
  agentDefinition?: AgentDefinition
): CredentialDefinition {
  // 1. Inline definitions on the agent definition
  if (agentDefinition?.credentialDefinitions?.[id]) {
    return agentDefinition.credentialDefinitions[id];
  }

  // 2. Built-in credentials
  if (builtinCredentials[id]) {
    return builtinCredentials[id];
  }

  throw new Error(
    `Unknown credential "${id}". ` +
    `Define it in credentialDefinitions on your agent definition, or use a built-in credential.`
  );
}

/**
 * Resolve all credential definitions for an agent definition.
 * Returns definitions for both required and optional credentials.
 */
export function resolveAllCredentials(
  agentDefinition: AgentDefinition
): Map<string, CredentialDefinition> {
  const result = new Map<string, CredentialDefinition>();
  const allIds = [
    ...agentDefinition.credentials.required,
    ...agentDefinition.credentials.optional,
  ];

  for (const id of allIds) {
    result.set(id, resolveCredential(id, agentDefinition));
  }

  return result;
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
