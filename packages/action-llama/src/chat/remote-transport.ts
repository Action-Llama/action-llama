/**
 * RemoteTransport — ChatTransport backed by a gateway WebSocket connection.
 *
 * Used for `al chat <agent> --env <name>` (remote mode) and the web UI.
 */

import WebSocket from "ws";
import type { ChatTransport } from "./transport.js";
import type { ChatInbound, ChatOutbound } from "./types.js";

export interface RemoteTransportOptions {
  gatewayUrl: string;
  agentName: string;
  apiKey: string;
}

export class RemoteTransport implements ChatTransport {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private handlers: Set<(msg: ChatOutbound) => void> = new Set();
  private _connected = false;
  private opts: RemoteTransportOptions;

  constructor(opts: RemoteTransportOptions) {
    this.opts = opts;
  }

  get connected(): boolean {
    return this._connected;
  }

  /**
   * Create a chat session and connect via WebSocket.
   */
  async connect(): Promise<void> {
    const { gatewayUrl, agentName, apiKey } = this.opts;

    // Create session via REST API
    const res = await fetch(`${gatewayUrl}/api/chat/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ agentName }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create chat session: ${text}`);
    }

    const { sessionId } = await res.json() as { sessionId: string };
    this.sessionId = sessionId;

    // Connect WebSocket
    const wsUrl = `${gatewayUrl.replace(/^http/, "ws")}/chat/ws/${sessionId}`;
    this.ws = new WebSocket(wsUrl, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
      },
    });

    return new Promise<void>((resolve, reject) => {
      const ws = this.ws!;

      ws.on("open", () => {
        this._connected = true;
        resolve();
      });

      ws.on("message", (data) => {
        const raw = data.toString();
        try {
          const msg: ChatOutbound = JSON.parse(raw);
          this.emit(msg);
        } catch {
          // Ignore malformed messages
        }
      });

      ws.on("close", () => {
        this._connected = false;
      });

      ws.on("error", (err) => {
        if (!this._connected) {
          reject(err);
        }
        this._connected = false;
      });
    });
  }

  send(msg: ChatInbound): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected");
    }
    this.ws.send(JSON.stringify(msg));
  }

  onMessage(handler: (msg: ChatOutbound) => void): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  async close(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Send shutdown before closing
      this.ws.send(JSON.stringify({ type: "shutdown" }));
      this.ws.close();
    }
    this._connected = false;
    this.handlers.clear();

    // Clean up session
    if (this.sessionId) {
      try {
        await fetch(`${this.opts.gatewayUrl}/api/chat/sessions/${this.sessionId}`, {
          method: "DELETE",
          headers: { "Authorization": `Bearer ${this.opts.apiKey}` },
        });
      } catch {
        // Best effort
      }
    }
  }

  private emit(msg: ChatOutbound): void {
    for (const handler of this.handlers) {
      handler(msg);
    }
  }
}
