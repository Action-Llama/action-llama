/**
 * Custom error classes for Action Llama.
 *
 * Using typed errors instead of generic Error enables the CLI wrapper
 * to provide context-aware error messages and recovery hints.
 */

export class ConfigError extends Error {
  override name = "ConfigError";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export class CredentialError extends Error {
  override name = "CredentialError";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export class CloudProviderError extends Error {
  override name = "CloudProviderError";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export class AgentError extends Error {
  override name = "AgentError";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

// --- Unrecoverable error detection ---
// Consolidated from agents/runner.ts and agents/execution-engine.ts.

export const UNRECOVERABLE_PATTERNS = [
  "permission denied",
  "could not read from remote repository",
  "resource not accessible by personal access token",
  "bad credentials",
  "authentication failed",
  "the requested url returned error: 403",
  "denied to ",
];

export function isUnrecoverableError(text: string): boolean {
  const lower = text.toLowerCase();
  return UNRECOVERABLE_PATTERNS.some((p) => lower.includes(p));
}

export const UNRECOVERABLE_THRESHOLD = 3;
