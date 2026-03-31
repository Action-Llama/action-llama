import type { QueuedWorkItem, EnqueueResult, WorkQueue } from "../shared/work-queue.js";

// Re-export for backward compatibility
export type { QueuedWorkItem, EnqueueResult, WorkQueue } from "../shared/work-queue.js";

/**
 * In-memory WorkQueue — suitable for tests and single-process use
 * where durability is not required. State is lost when the process exits.
 */
export class MemoryWorkQueue<T> implements WorkQueue<T> {
  private queues = new Map<string, QueuedWorkItem<T>[]>();
  private maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  enqueue(agentName: string, context: T, receivedAt?: Date): EnqueueResult<T> {
    let queue = this.queues.get(agentName);
    if (!queue) {
      queue = [];
      this.queues.set(agentName, queue);
    }
    let dropped: QueuedWorkItem<T> | undefined;
    if (queue.length >= this.maxSize) {
      dropped = queue.shift();
    }
    queue.push({ context, receivedAt: receivedAt || new Date() });
    return { accepted: true, dropped };
  }

  dequeue(agentName: string): QueuedWorkItem<T> | undefined {
    const queue = this.queues.get(agentName);
    if (!queue || queue.length === 0) return undefined;
    return queue.shift();
  }

  peek(agentName: string, limit?: number): QueuedWorkItem<T>[] {
    const queue = this.queues.get(agentName);
    if (!queue || queue.length === 0) return [];
    return limit !== undefined ? queue.slice(0, limit) : [...queue];
  }

  size(agentName: string): number {
    return this.queues.get(agentName)?.length ?? 0;
  }

  clear(agentName: string): void {
    this.queues.delete(agentName);
  }

  clearAll(): void {
    this.queues.clear();
  }

  close(): void {
    this.queues.clear();
  }
}

// --- Factory ---

export interface SqliteWorkQueueOpts {
  type: "sqlite";
  /** Path to the .db file (created if missing). */
  path: string;
}

export interface MemoryWorkQueueOpts {
  type: "memory";
}

export type WorkQueueOpts = SqliteWorkQueueOpts | MemoryWorkQueueOpts;

/**
 * Create a WorkQueue from configuration.
 *
 * Uses dynamic imports so native modules (better-sqlite3)
 * are only loaded when actually needed.
 */
export async function createWorkQueue<T>(
  maxSize: number,
  opts: WorkQueueOpts,
): Promise<WorkQueue<T>> {
  if (opts.type === "sqlite") {
    const { SqliteWorkQueue } = await import("./event-queue-sqlite.js");
    return new SqliteWorkQueue<T>(maxSize, opts.path);
  }
  return new MemoryWorkQueue<T>(maxSize);
}
