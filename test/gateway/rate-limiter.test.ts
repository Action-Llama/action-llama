import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { rateLimiter } from "../../src/gateway/rate-limiter.js";
import type { StateStore } from "../../src/shared/state-store.js";

// Minimal in-memory StateStore for testing
function makeStore(): StateStore {
  const data = new Map<string, { value: unknown; expiresAt?: number }>();

  const key = (ns: string, k: string) => `${ns}:${k}`;

  return {
    async get<T>(ns: string, k: string): Promise<T | null> {
      const entry = data.get(key(ns, k));
      if (!entry) return null;
      if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
        data.delete(key(ns, k));
        return null;
      }
      return entry.value as T;
    },
    async set<T>(ns: string, k: string, value: T, opts?: { ttl?: number }): Promise<void> {
      data.set(key(ns, k), {
        value,
        expiresAt: opts?.ttl ? Date.now() + opts.ttl * 1000 : undefined,
      });
    },
    async delete(ns: string, k: string): Promise<void> {
      data.delete(key(ns, k));
    },
    async deleteAll(ns: string): Promise<void> {
      for (const k of data.keys()) {
        if (k.startsWith(`${ns}:`)) data.delete(k);
      }
    },
    async list<T>(ns: string): Promise<Array<{ key: string; value: T }>> {
      const results: Array<{ key: string; value: T }> = [];
      const prefix = `${ns}:`;
      for (const [k, entry] of data) {
        if (!k.startsWith(prefix)) continue;
        if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) continue;
        results.push({ key: k.slice(prefix.length), value: entry.value as T });
      }
      return results;
    },
    async close(): Promise<void> {},
  };
}

function makeApp(opts: Parameters<typeof rateLimiter>[0]) {
  const app = new Hono();
  app.use("/*", rateLimiter(opts));
  app.get("/test", (c) => c.json({ ok: true }));
  return app;
}

async function hit(app: Hono, ip = "1.2.3.4") {
  return app.request("/test", {
    headers: { "x-forwarded-for": ip },
  });
}

describe("rateLimiter (in-memory)", () => {
  it("allows requests under the limit", async () => {
    const app = makeApp({ max: 3, windowMs: 60_000 });
    expect((await hit(app)).status).toBe(200);
    expect((await hit(app)).status).toBe(200);
    expect((await hit(app)).status).toBe(200);
  });

  it("blocks the request that exceeds the limit", async () => {
    const app = makeApp({ max: 2, windowMs: 60_000 });
    await hit(app);
    await hit(app);
    const res = await hit(app);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });

  it("tracks IPs independently", async () => {
    const app = makeApp({ max: 1, windowMs: 60_000 });
    expect((await hit(app, "10.0.0.1")).status).toBe(200);
    expect((await hit(app, "10.0.0.2")).status).toBe(200);
    expect((await hit(app, "10.0.0.1")).status).toBe(429);
  });
});

describe("rateLimiter (durable store)", () => {
  it("allows requests under the limit", async () => {
    const store = makeStore();
    const app = makeApp({ max: 3, windowMs: 60_000, store });
    expect((await hit(app)).status).toBe(200);
    expect((await hit(app)).status).toBe(200);
    expect((await hit(app)).status).toBe(200);
  });

  it("blocks the request that exceeds the limit", async () => {
    const store = makeStore();
    const app = makeApp({ max: 2, windowMs: 60_000, store });
    await hit(app);
    await hit(app);
    const res = await hit(app);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });

  it("persists state across app instances sharing the same store", async () => {
    const store = makeStore();
    const app1 = makeApp({ max: 2, windowMs: 60_000, store });
    const app2 = makeApp({ max: 2, windowMs: 60_000, store });

    await hit(app1); // 1st hit on instance 1
    await hit(app1); // 2nd hit on instance 1

    // app2 shares the same store — should see the accumulated count
    const res = await hit(app2);
    expect(res.status).toBe(429);
  });

  it("tracks IPs independently", async () => {
    const store = makeStore();
    const app = makeApp({ max: 1, windowMs: 60_000, store });
    expect((await hit(app, "10.0.0.1")).status).toBe(200);
    expect((await hit(app, "10.0.0.2")).status).toBe(200);
    expect((await hit(app, "10.0.0.1")).status).toBe(429);
  });
});
