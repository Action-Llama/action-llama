import { randomUUID } from "crypto";

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

export class CallStore {
  private calls = new Map<string, CallEntry>();
  private sweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(sweepIntervalSeconds = 60) {
    this.sweepTimer = setInterval(() => this.sweep(), sweepIntervalSeconds * 1000);
    if (this.sweepTimer.unref) this.sweepTimer.unref();
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
    return entry;
  }

  setRunning(callId: string): boolean {
    const entry = this.calls.get(callId);
    if (!entry || entry.status !== "pending") return false;
    entry.status = "running";
    return true;
  }

  complete(callId: string, returnValue?: string): boolean {
    const entry = this.calls.get(callId);
    if (!entry || (entry.status !== "pending" && entry.status !== "running")) return false;
    entry.status = "completed";
    entry.returnValue = returnValue;
    entry.completedAt = Date.now();
    return true;
  }

  fail(callId: string, errorMessage: string): boolean {
    const entry = this.calls.get(callId);
    if (!entry || entry.status === "completed" || entry.status === "error") return false;
    entry.status = "error";
    entry.errorMessage = errorMessage;
    entry.completedAt = Date.now();
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
        }
      } else if (now - entry.createdAt > ACTIVE_TTL) {
        entry.status = "error";
        entry.errorMessage = "call timed out";
        entry.completedAt = now;
      }
    }
  }

  dispose(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    this.calls.clear();
  }
}
