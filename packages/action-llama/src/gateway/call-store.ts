import { randomUUID } from "crypto";
import type { StateStore } from "../shared/state-store.js";

export type CallStatus = "pending" | "running" | "completed" | "error";

export interface CallEntry {
  callId: string;
  callerAgent: string;
  callerInstanceId: string;
  targetAgent: string;
  context: string;
  status: CallStatus;
  returnValue?: string;
  errorMessage?: string;
  createdAt: number;
  completedAt?: number;
  depth: number;
}

const NS = "calls";

export class CallStore {
  private calls = new Map<string, CallEntry>();
  private sweepTimer: ReturnType<typeof setInterval> | undefined;
  private store?: StateStore;

  constructor(sweepIntervalSeconds = 60, store?: StateStore) {
    this.store = store;
    this.sweepTimer = setInterval(() => this.sweep(), sweepIntervalSeconds * 1000);
    if (this.sweepTimer.unref) this.sweepTimer.unref();
  }

  /** Hydrate in-memory state from the persistent store. */
  async init(): Promise<void> {
    if (!this.store) return;
    const entries = await this.store.list<CallEntry>(NS);
    for (const { value } of entries) {
      this.calls.set(value.callId, value);
    }
  }

  create(opts: {
    callerAgent: string;
    callerInstanceId: string;
    targetAgent: string;
    context: string;
    depth: number;
  }): CallEntry {
    const entry: CallEntry = {
      callId: randomUUID(),
      callerAgent: opts.callerAgent,
      callerInstanceId: opts.callerInstanceId,
      targetAgent: opts.targetAgent,
      context: opts.context,
      status: "pending",
      createdAt: Date.now(),
      depth: opts.depth,
    };
    this.calls.set(entry.callId, entry);
    this.persist(entry);
    return entry;
  }

  setRunning(callId: string): boolean {
    const entry = this.calls.get(callId);
    if (!entry || entry.status !== "pending") return false;
    entry.status = "running";
    this.persist(entry);
    return true;
  }

  complete(callId: string, returnValue?: string): boolean {
    const entry = this.calls.get(callId);
    if (!entry || (entry.status !== "pending" && entry.status !== "running")) return false;
    entry.status = "completed";
    entry.returnValue = returnValue;
    entry.completedAt = Date.now();
    this.persist(entry);
    return true;
  }

  fail(callId: string, errorMessage: string): boolean {
    const entry = this.calls.get(callId);
    if (!entry || entry.status === "completed" || entry.status === "error") return false;
    entry.status = "error";
    entry.errorMessage = errorMessage;
    entry.completedAt = Date.now();
    this.persist(entry);
    return true;
  }

  check(callId: string, callerInstanceId: string): { status: CallStatus; returnValue?: string; errorMessage?: string } | null {
    const entry = this.calls.get(callId);
    if (!entry) return null;
    if (entry.callerInstanceId !== callerInstanceId) return null;
    return {
      status: entry.status,
      returnValue: entry.returnValue,
      errorMessage: entry.errorMessage,
    };
  }

  get(callId: string): CallEntry | undefined {
    return this.calls.get(callId);
  }

  failAllByCaller(callerInstanceId: string): number {
    let count = 0;
    for (const entry of this.calls.values()) {
      if (entry.callerInstanceId === callerInstanceId && (entry.status === "pending" || entry.status === "running")) {
        entry.status = "error";
        entry.errorMessage = "caller container exited";
        entry.completedAt = Date.now();
        this.persist(entry);
        count++;
      }
    }
    return count;
  }

  private sweep(): void {
    const now = Date.now();
    const TERMINAL_TTL = 10 * 60 * 1000; // 10 minutes
    const ACTIVE_TTL = 2 * 60 * 60 * 1000; // 2 hours
    for (const [id, entry] of this.calls) {
      if (entry.status === "completed" || entry.status === "error") {
        if (entry.completedAt && now - entry.completedAt > TERMINAL_TTL) {
          this.calls.delete(id);
          this.store?.delete(NS, id).catch(() => {});
        }
      } else if (now - entry.createdAt > ACTIVE_TTL) {
        entry.status = "error";
        entry.errorMessage = "call timed out";
        entry.completedAt = now;
        this.persist(entry);
      }
    }
  }

  private persist(entry: CallEntry): void {
    // TTL: 2 hours for active, 10 minutes after completion
    const ttlSec = entry.completedAt ? 600 : 7200;
    this.store?.set(NS, entry.callId, entry, { ttl: ttlSec }).catch(() => {});
  }

  dispose(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    this.calls.clear();
  }
}
