export interface QueuedWorkItem<T> {
  context: T;
  receivedAt: Date;
}

export interface EnqueueResult<T> {
  accepted: boolean;
  dropped?: QueuedWorkItem<T>;
}

export interface WorkQueue<T> {
  enqueue(agentName: string, context: T, receivedAt?: Date): EnqueueResult<T>;
  dequeue(agentName: string): QueuedWorkItem<T> | undefined;
  /** Return queued items for an agent without removing them (FIFO order). */
  peek(agentName: string, limit?: number): QueuedWorkItem<T>[];
  size(agentName: string): number;
  clear(agentName: string): void;
  clearAll(): void;
  close(): void;
}
