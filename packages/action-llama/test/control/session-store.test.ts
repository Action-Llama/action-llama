import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionStore } from "../../src/control/session-store.js";
import type { StateStore } from "../../src/shared/state-store.js";
import type { Session } from "../../src/control/types.js";

function mockStateStore(): StateStore & {
  _data: Map<string, { value: unknown; expiresAt?: number }>;
} {
  const data = new Map<string, { value: unknown; expiresAt?: number }>();

  return {
    _data: data,
    async get<T>(ns: string, key: string): Promise<T | null> {
      const entry = data.get(`${ns}:${key}`);
      if (!entry) return null;
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        data.delete(`${ns}:${key}`);
        return null;
      }
      return entry.value as T;
    },
    async set<T>(ns: string, key: string, value: T, opts?: { ttl?: number }): Promise<void> {
      const expiresAt = opts?.ttl ? Date.now() + opts.ttl * 1000 : undefined;
      data.set(`${ns}:${key}`, { value, expiresAt });
    },
    async delete(ns: string, key: string): Promise<void> {
      data.delete(`${ns}:${key}`);
    },
    async deleteAll(ns: string): Promise<void> {
      for (const k of data.keys()) {
        if (k.startsWith(`${ns}:`)) data.delete(k);
      }
    },
    async list<T>(ns: string): Promise<Array<{ key: string; value: T }>> {
      const results: Array<{ key: string; value: T }> = [];
      for (const [k, entry] of data.entries()) {
        if (!k.startsWith(`${ns}:`)) continue;
        if (entry.expiresAt && Date.now() > entry.expiresAt) continue;
        results.push({ key: k.slice(ns.length + 1), value: entry.value as T });
      }
      return results;
    },
    async close(): Promise<void> {},
  };
}

describe("SessionStore", () => {
  it("createSession returns a 64-character hex string", async () => {
    const store = new SessionStore(mockStateStore());
    const id = await store.createSession();
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("createSession returns unique IDs", async () => {
    const store = new SessionStore(mockStateStore());
    const ids = await Promise.all(Array.from({ length: 10 }, () => store.createSession()));
    const unique = new Set(ids);
    expect(unique.size).toBe(10);
  });

  it("getSession returns the session after creation", async () => {
    const store = new SessionStore(mockStateStore());
    const id = await store.createSession();
    const session = await store.getSession(id);
    expect(session).not.toBeNull();
    expect(session!.id).toBe(id);
    expect(typeof session!.createdAt).toBe("number");
    expect(typeof session!.lastAccessed).toBe("number");
  });

  it("getSession returns null for unknown ID", async () => {
    const store = new SessionStore(mockStateStore());
    const session = await store.getSession("nonexistent");
    expect(session).toBeNull();
  });

  it("getSession updates lastAccessed on each call", async () => {
    const store = new SessionStore(mockStateStore());
    const id = await store.createSession();
    const first = await store.getSession(id);
    await new Promise((r) => setTimeout(r, 5));
    const second = await store.getSession(id);
    expect(second!.lastAccessed).toBeGreaterThanOrEqual(first!.lastAccessed);
  });

  it("deleteSession removes the session", async () => {
    const store = new SessionStore(mockStateStore());
    const id = await store.createSession();
    await store.deleteSession(id);
    const session = await store.getSession(id);
    expect(session).toBeNull();
  });

  it("getSession returns null after TTL expires", async () => {
    const underlying = mockStateStore();
    const store = new SessionStore(underlying, 1); // 1 second TTL
    const id = await store.createSession();

    // Manually expire the entry by backdating it
    const key = `sessions:${id}`;
    const entry = underlying._data.get(key);
    if (entry) {
      entry.expiresAt = Date.now() - 1;
    }

    const session = await store.getSession(id);
    expect(session).toBeNull();
  });
});
