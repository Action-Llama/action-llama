import { randomBytes } from "crypto";
import type { StateStore } from "../shared/state-store.js";
import type { Session } from "./types.js";

const NS = "sessions";
const DEFAULT_TTL_SECONDS = 24 * 60 * 60; // 24 hours

export class SessionStore {
  private store: StateStore;
  private ttl: number;

  constructor(store: StateStore, ttlSeconds = DEFAULT_TTL_SECONDS) {
    this.store = store;
    this.ttl = ttlSeconds;
  }

  async createSession(): Promise<string> {
    const id = randomBytes(32).toString("hex");
    const session: Session = {
      id,
      createdAt: Date.now(),
      lastAccessed: Date.now(),
    };
    await this.store.set<Session>(NS, id, session, { ttl: this.ttl });
    return id;
  }

  async getSession(id: string): Promise<Session | null> {
    const session = await this.store.get<Session>(NS, id);
    if (!session) return null;
    session.lastAccessed = Date.now();
    await this.store.set<Session>(NS, id, session, { ttl: this.ttl });
    return session;
  }

  async deleteSession(id: string): Promise<void> {
    await this.store.delete(NS, id);
  }
}
