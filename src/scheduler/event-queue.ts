import type { StateStore } from "../shared/state-store.js";

export interface QueuedEvent {
  agentType: string;
  text: string;
  timestamp: string;
}

export type EventListener = (event: QueuedEvent) => void;

export class EventQueue {
  private listeners: EventListener[] = [];

  onEvent(listener: EventListener): void {
    this.listeners.push(listener);
  }

  push(event: QueuedEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

// --- Bounded per-agent work queue ---

export interface QueuedWorkItem<T> {
  context: T;
  receivedAt: Date;
}

export interface EnqueueResult<T> {
  accepted: boolean;
  dropped?: QueuedWorkItem<T>;
}

const NS = "queues";

export class WorkQueue<T> {
  private queues = new Map<string, QueuedWorkItem<T>[]>();
  private maxSize: number;
  private store?: StateStore;

  constructor(maxSize = 100, store?: StateStore) {
    this.maxSize = maxSize;
    this.store = store;
  }

  /** Hydrate in-memory state from the persistent store. */
  async init(): Promise<void> {
    if (!this.store) return;
    const entries = await this.store.list<Array<{ context: T; receivedAt: string }>>(NS);
    for (const { key, value } of entries) {
      this.queues.set(
        key,
        value.map((item) => ({ context: item.context, receivedAt: new Date(item.receivedAt) }))
      );
    }
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
    this.persist(agentName);
    return { accepted: true, dropped };
  }

  dequeue(agentName: string): QueuedWorkItem<T> | undefined {
    const queue = this.queues.get(agentName);
    if (!queue || queue.length === 0) return undefined;
    const item = queue.shift();
    this.persist(agentName);
    return item;
  }

  size(agentName: string): number {
    return this.queues.get(agentName)?.length ?? 0;
  }

  clear(agentName: string): void {
    this.queues.delete(agentName);
    this.store?.delete(NS, agentName).catch(() => {});
  }

  clearAll(): void {
    this.queues.clear();
    this.store?.deleteAll(NS).catch(() => {});
  }

  private persist(agentName: string): void {
    const queue = this.queues.get(agentName);
    if (!queue || queue.length === 0) {
      this.store?.delete(NS, agentName).catch(() => {});
    } else {
      this.store?.set(NS, agentName, queue, { ttl: 86400 }).catch(() => {}); // 24h TTL
    }
  }
}

/** @deprecated Use WorkQueue instead */
export const WebhookEventQueue = WorkQueue;
export type QueuedWebhookEvent<T> = QueuedWorkItem<T>;
