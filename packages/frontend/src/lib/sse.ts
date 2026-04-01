import type { AgentStatus, SchedulerInfo, LogLine, AgentInstance, InvalidationSignal } from "./api";

export interface SSEMessage {
  agents?: AgentStatus[];
  schedulerInfo?: SchedulerInfo | null;
  recentLogs?: LogLine[];
  instances?: AgentInstance[];
  invalidated?: InvalidationSignal[];
}

export type ConnectionState = "connecting" | "connected" | "disconnected";

export interface SSECallbacks {
  onMessage: (msg: SSEMessage) => void;
  onConnectionChange: (state: ConnectionState) => void;
}

export class SSEConnection {
  private es: EventSource | null = null;
  private backoff = 1000;
  private readonly maxBackoff = 30_000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private callbacks: SSECallbacks;

  constructor(callbacks: SSECallbacks) {
    this.callbacks = callbacks;
  }

  connect(): void {
    if (this.destroyed) return;
    this.cleanup();
    this.callbacks.onConnectionChange("connecting");

    const es = new EventSource("/dashboard/api/status-stream");
    this.es = es;

    es.onopen = () => {
      this.backoff = 1000;
      this.callbacks.onConnectionChange("connected");
    };

    es.onerror = () => {
      this.callbacks.onConnectionChange("disconnected");
      this.cleanup();
      this.scheduleReconnect();
    };

    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        this.callbacks.onMessage(parsed);
      } catch {
        // Ignore parse errors (e.g. heartbeats)
      }
    };
  }

  disconnect(): void {
    this.destroyed = true;
    this.cleanup();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private cleanup(): void {
    if (this.es) {
      this.es.onopen = null;
      this.es.onerror = null;
      this.es.onmessage = null;
      this.es.close();
      this.es = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, this.maxBackoff);
  }
}
