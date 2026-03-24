/**
 * LocalTransport — ChatTransport backed by a local PI agent session.
 *
 * Used for `al chat <agent>` without --env (local mode).
 */

import type { ChatTransport } from "./transport.js";
import type { ChatInbound, ChatOutbound } from "./types.js";
import { mapAgentEvent } from "./event-mapper.js";

export interface LocalTransportOptions {
  /** PI agent session (from createAgentSession). */
  session: {
    prompt(text: string): Promise<any>;
    dispose(): void;
    subscribe(handler: (event: any) => void): void;
  };
}

export class LocalTransport implements ChatTransport {
  private session: LocalTransportOptions["session"];
  private handlers: Set<(msg: ChatOutbound) => void> = new Set();
  private _connected = true;
  private agentBusy = false;

  constructor(opts: LocalTransportOptions) {
    this.session = opts.session;

    // Subscribe to session events and map to ChatOutbound
    this.session.subscribe((event: any) => {
      const outbound = mapAgentEvent(event);
      for (const msg of outbound) {
        if (msg.type === "assistant_message" && msg.done) {
          this.agentBusy = false;
        }
        this.emit(msg);
      }
    });
  }

  get connected(): boolean {
    return this._connected;
  }

  send(msg: ChatInbound): void {
    switch (msg.type) {
      case "user_message":
        if (this.agentBusy) {
          this.emit({ type: "error", message: "Agent is busy processing. Please wait." });
          return;
        }
        this.agentBusy = true;
        this.session.prompt(msg.text).catch((err: any) => {
          this.emit({ type: "error", message: err.message });
          this.agentBusy = false;
        });
        break;

      case "cancel":
        if (this.agentBusy) {
          this.session.dispose();
          this.agentBusy = false;
        }
        break;

      case "shutdown":
        this.session.dispose();
        this._connected = false;
        break;
    }
  }

  onMessage(handler: (msg: ChatOutbound) => void): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  async close(): Promise<void> {
    this._connected = false;
    this.session.dispose();
    this.handlers.clear();
  }

  private emit(msg: ChatOutbound): void {
    for (const handler of this.handlers) {
      handler(msg);
    }
  }
}
