/**
 * WaitingRegistry — tracks agent sessions that are suspended mid-conversation,
 * waiting for a specific trigger (webhook or agent-trigger) to resume.
 *
 * Sessions are matched FIFO within each agent. The registry is the single source
 * of truth for all waiting sessions and handles matching, timeout cleanup, and
 * persistence to the KV store for restart recovery.
 */

import type { WebhookContext } from "../webhooks/types.js";
import type { PersistenceStore } from "../shared/persistence/index.js";

// ── Filter types ─────────────────────────────────────────────

export type WaitFilter =
  | { type: "webhook"; source?: string; event?: string; match?: Record<string, string> }
  | { type: "agent-trigger"; sourceAgent?: string };

// ── Waiting instance ─────────────────────────────────────────

export interface WaitingSession {
  sessionId: string;
  agentName: string;
  filter: WaitFilter;
  deadline: number;          // epoch ms
  registeredAt: number;      // epoch ms (for FIFO ordering)
  runId: string;             // container name (for pause/unpause)
  runtimeType: string;       // "container" | "host-user" | "ssh"
  cwd: string;               // transport working directory to restore
  // In-memory only (not persisted — recreated on resume)
  resolve?: (payload: any) => void;
  reject?: (err: Error) => void;
  timeoutTimer?: ReturnType<typeof setTimeout>;
}

/** Serializable subset of WaitingSession for persistence. */
interface PersistedWaitingSession {
  sessionId: string;
  agentName: string;
  filter: WaitFilter;
  deadline: number;
  registeredAt: number;
  runId: string;
  runtimeType: string;
  cwd: string;
}

// ── Dot-path matching helper ─────────────────────────────────

/**
 * Check if a dot-path key matches a value in an object.
 * e.g. matchDotPath({ a: { b: "c" } }, "a.b", "c") → true
 */
export function matchDotPath(obj: any, key: string, value: string): boolean {
  const parts = key.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return false;
    current = current[part];
  }
  return String(current) === value;
}

// ── Registry ─────────────────────────────────────────────────

const KV_NAMESPACE = "waiting-sessions";

export class WaitingRegistry {
  private entries = new Map<string, WaitingSession>();

  /**
   * Register a waiting session. Starts its timeout timer.
   */
  register(entry: WaitingSession): void {
    // Start timeout timer
    const remaining = entry.deadline - Date.now();
    if (remaining <= 0) {
      // Already expired — reject immediately
      entry.reject?.(new Error("Wait timeout expired before registration"));
      return;
    }

    entry.timeoutTimer = setTimeout(() => {
      const removed = this.remove(entry.sessionId);
      if (removed) {
        removed.reject?.(new Error("Wait timeout expired"));
      }
    }, remaining);
    entry.timeoutTimer.unref?.();

    this.entries.set(entry.sessionId, entry);
  }

  /**
   * Find and remove a matching waiting session for a webhook trigger (FIFO).
   * Returns null if no match found.
   */
  matchWebhook(agentName: string, context: WebhookContext): WaitingSession | null {
    // Find all entries for this agent, sorted by registeredAt (FIFO)
    const candidates = this.getByAgent(agentName)
      .filter((e) => e.filter.type === "webhook")
      .sort((a, b) => a.registeredAt - b.registeredAt);

    for (const entry of candidates) {
      const filter = entry.filter as Extract<WaitFilter, { type: "webhook" }>;

      // Check source filter
      if (filter.source && filter.source !== context.source) continue;

      // Check event filter
      if (filter.event && filter.event !== context.event) continue;

      // Check dot-path match predicates on the context
      if (filter.match) {
        let allMatch = true;
        for (const [key, value] of Object.entries(filter.match)) {
          if (!matchDotPath(context, key, value)) {
            allMatch = false;
            break;
          }
        }
        if (!allMatch) continue;
      }

      // Match found — remove from registry and clear timeout
      return this._removeAndCleanup(entry.sessionId);
    }

    return null;
  }

  /**
   * Find and remove a matching waiting session for an agent trigger (FIFO).
   * Returns null if no match found.
   */
  matchAgentTrigger(agentName: string, sourceAgent: string): WaitingSession | null {
    const candidates = this.getByAgent(agentName)
      .filter((e) => e.filter.type === "agent-trigger")
      .sort((a, b) => a.registeredAt - b.registeredAt);

    for (const entry of candidates) {
      const filter = entry.filter as Extract<WaitFilter, { type: "agent-trigger" }>;

      // If sourceAgent is specified, it must match
      if (filter.sourceAgent && filter.sourceAgent !== sourceAgent) continue;

      return this._removeAndCleanup(entry.sessionId);
    }

    return null;
  }

  /**
   * Remove a waiting session by ID (for timeout/kill).
   */
  remove(sessionId: string): WaitingSession | null {
    return this._removeAndCleanup(sessionId);
  }

  /**
   * Get all waiting sessions for a specific agent.
   */
  getByAgent(agentName: string): WaitingSession[] {
    return Array.from(this.entries.values()).filter((e) => e.agentName === agentName);
  }

  /**
   * Get all waiting sessions.
   */
  getAll(): WaitingSession[] {
    return Array.from(this.entries.values());
  }

  /**
   * Get the total number of waiting sessions.
   */
  count(): number {
    return this.entries.size;
  }

  /**
   * Persist all waiting sessions to the KV store.
   */
  async persist(store: PersistenceStore): Promise<void> {
    // Clear existing entries
    await store.kv.deleteAll(KV_NAMESPACE);

    for (const entry of this.entries.values()) {
      const persisted: PersistedWaitingSession = {
        sessionId: entry.sessionId,
        agentName: entry.agentName,
        filter: entry.filter,
        deadline: entry.deadline,
        registeredAt: entry.registeredAt,
        runId: entry.runId,
        runtimeType: entry.runtimeType,
        cwd: entry.cwd,
      };
      await store.kv.set(KV_NAMESPACE, entry.sessionId, persisted);
    }
  }

  /**
   * Rehydrate waiting sessions from the KV store.
   * Returns a new registry with loaded entries (no in-memory resolve/reject callbacks).
   */
  static async rehydrate(store: PersistenceStore): Promise<WaitingRegistry> {
    const registry = new WaitingRegistry();
    const entries = await store.kv.list<PersistedWaitingSession>(KV_NAMESPACE);
    const now = Date.now();

    for (const { value } of entries) {
      // Skip expired entries
      if (value.deadline <= now) {
        await store.kv.delete(KV_NAMESPACE, value.sessionId);
        continue;
      }

      const entry: WaitingSession = {
        ...value,
        // No resolve/reject — cold restart sessions get new runners on match
      };

      // Start timeout timer for remaining time
      entry.timeoutTimer = setTimeout(() => {
        registry.remove(entry.sessionId);
      }, entry.deadline - now);
      entry.timeoutTimer.unref?.();

      registry.entries.set(entry.sessionId, entry);
    }

    return registry;
  }

  /**
   * Remove an entry and clean up its timeout timer.
   */
  private _removeAndCleanup(sessionId: string): WaitingSession | null {
    const entry = this.entries.get(sessionId);
    if (!entry) return null;

    this.entries.delete(sessionId);
    if (entry.timeoutTimer) {
      clearTimeout(entry.timeoutTimer);
      entry.timeoutTimer = undefined;
    }
    return entry;
  }
}
