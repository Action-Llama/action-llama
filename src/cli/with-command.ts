import { ConfigError, CredentialError, CloudProviderError, AgentError } from "../shared/errors.js";

/**
 * Wraps a CLI command handler with consistent error handling.
 *
 * - Catches errors and prints context-aware messages
 * - Shows recovery hints for known error types
 * - Shows stack traces when DEBUG is set
 * - Calls process.exit(1) on failure
 *
 * This replaces the ad-hoc try/catch + process.exit(1) pattern
 * that was duplicated across every command.
 */
export function withCommand<T extends (...args: any[]) => Promise<void>>(fn: T): T {
  return (async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (err: unknown) {
      if (err instanceof CredentialError) {
        console.error(`Credential error: ${err.message}`);
      } else if (err instanceof ConfigError) {
        console.error(`Configuration error: ${err.message}`);
      } else if (err instanceof CloudProviderError) {
        console.error(`Cloud error: ${err.message}`);
      } else if (err instanceof AgentError) {
        console.error(`Agent error: ${err.message}`);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        if (err instanceof Error && err.cause) {
          console.error(`Cause: ${err.cause}`);
        }
      }
      if (process.env.DEBUG && err instanceof Error) {
        console.error(err.stack);
      }
      process.exit(1);
    }
  }) as unknown as T;
}
