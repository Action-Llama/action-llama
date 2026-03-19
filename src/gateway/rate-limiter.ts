import type { Context, Next } from "hono";
import type { StateStore } from "../shared/state-store.js";

interface RateLimiterOpts {
  /** Maximum requests per window */
  max: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Optional persistent store. When provided, rate-limit state survives restarts. */
  store?: StateStore;
}

const NS = "rate-limits";

/**
 * Sliding-window rate limiter keyed by IP.
 *
 * When a StateStore is provided, hit timestamps are persisted to it so that
 * limits survive process restarts and compose correctly across instances that
 * share the same store. Without a store it falls back to an in-memory Map
 * (single-process, ephemeral).
 */
export function rateLimiter(opts: RateLimiterOpts) {
  const hits = new Map<string, number[]>();

  // Cleanup interval is only needed for the in-memory path; the store path
  // relies on TTL-based expiry built into StateStore.
  if (!opts.store) {
    const cleanup = setInterval(() => {
      const cutoff = Date.now() - opts.windowMs;
      for (const [key, timestamps] of hits) {
        const filtered = timestamps.filter((t) => t > cutoff);
        if (filtered.length === 0) {
          hits.delete(key);
        } else {
          hits.set(key, filtered);
        }
      }
    }, opts.windowMs);
    if (cleanup.unref) cleanup.unref();
  }

  return async (c: Context, next: Next) => {
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      c.req.header("x-real-ip") ||
      "unknown";

    const now = Date.now();
    const cutoff = now - opts.windowMs;

    let timestamps: number[];
    if (opts.store) {
      const stored = await opts.store.get<number[]>(NS, ip);
      timestamps = (stored ?? []).filter((t) => t > cutoff);
    } else {
      timestamps = (hits.get(ip) ?? []).filter((t) => t > cutoff);
    }

    if (timestamps.length >= opts.max) {
      c.header("Retry-After", String(Math.ceil(opts.windowMs / 1000)));
      return c.json({ error: "too many requests" }, 429);
    }

    timestamps.push(now);

    if (opts.store) {
      await opts.store.set(NS, ip, timestamps, {
        ttl: Math.ceil(opts.windowMs / 1000),
      });
    } else {
      hits.set(ip, timestamps);
    }

    await next();
  };
}
