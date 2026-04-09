/**
 * Shared polling utilities for e2e tests.
 *
 * Replaces the ad-hoc `for (let i = 0; i < N; i++) { await sleep(1000); ... }`
 * loops scattered across test files with a single, well-behaved helper that:
 *   - Uses exponential backoff (100ms → 200ms → ... → cap)
 *   - Throws on timeout with a descriptive message
 *   - Returns early as soon as the condition is met
 */

export interface PollOptions {
  /** Maximum time to wait in milliseconds. Default: 30_000 (30s). */
  timeoutMs?: number;
  /** Initial delay between checks in milliseconds. Default: 200. */
  initialDelayMs?: number;
  /** Maximum delay between checks in milliseconds. Default: 2000. */
  maxDelayMs?: number;
  /** Label used in the timeout error message. */
  label?: string;
}

/**
 * Poll `fn` until it returns a truthy value or the timeout is reached.
 * Uses exponential backoff between attempts.
 *
 * @returns The truthy value returned by `fn`.
 * @throws If the timeout is reached before `fn` returns truthy.
 */
export async function poll<T>(
  fn: () => Promise<T>,
  opts: PollOptions = {},
): Promise<T> {
  const {
    timeoutMs = 30_000,
    initialDelayMs = 50,
    maxDelayMs = 1_000,
    label = "condition",
  } = opts;

  const deadline = Date.now() + timeoutMs;
  let delay = initialDelayMs;

  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result) return result;
    } catch {
      // condition not met yet
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(delay, remaining)));
    delay = Math.min(delay * 2, maxDelayMs);
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${label}`);
}
