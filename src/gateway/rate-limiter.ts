import type { Context, Next } from "hono";

interface RateLimiterOpts {
  /** Maximum requests per window */
  max: number;
  /** Window size in milliseconds */
  windowMs: number;
}

/**
 * Simple in-memory sliding-window rate limiter keyed by IP.
 * Designed for single-process use (local scheduler or cloud scheduler instance).
 */
export function rateLimiter(opts: RateLimiterOpts) {
  const hits = new Map<string, number[]>();

  // Periodically clean up old entries to prevent unbounded growth
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

  return async (c: Context, next: Next) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
      || c.req.header("x-real-ip")
      || "unknown";

    const now = Date.now();
    const cutoff = now - opts.windowMs;
    const timestamps = (hits.get(ip) || []).filter((t) => t > cutoff);

    if (timestamps.length >= opts.max) {
      c.header("Retry-After", String(Math.ceil(opts.windowMs / 1000)));
      return c.json({ error: "too many requests" }, 429);
    }

    timestamps.push(now);
    hits.set(ip, timestamps);
    await next();
  };
}
