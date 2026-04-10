import type WebSocket from "ws";
import type { StatusTracker } from "../../tui/status-tracker.js";
import type { AttachCommand } from "./types.js";

/**
 * Manages WebSocket clients attached to running Pi sessions.
 *
 * - Clients are created lazily on first attach (not eagerly per session).
 * - Multiple clients per session are supported (fan-out).
 * - An independent Pi event subscriber is added on first client connect
 *   and removed when the last client disconnects.
 * - Sessions are closed when they reach a terminal state (notifyTerminal).
 */
export class SessionAttachManager {
  /** sessionId → connected WebSocket clients */
  private clients = new Map<string, Set<WebSocket>>();
  /** sessionId → Pi session unsubscribe function */
  private piSubscriptions = new Map<string, () => void>();

  constructor(private statusTracker: StatusTracker) {}

  /**
   * Attach a WebSocket client to a running session.
   * Sends the current session state immediately, then streams live events.
   */
  attach(sessionId: string, ws: WebSocket): void {
    // Locate the runner via StatusTracker
    const agentSession = this.statusTracker.getSessions().find(s => s.id === sessionId);
    if (!agentSession || (agentSession.status !== "running" && agentSession.status !== "waiting")) {
      ws.send(JSON.stringify({ type: "error", message: "Session not found or not attachable" }) + "\n");
      ws.close();
      return;
    }

    // Add client to fan-out set
    let clientSet = this.clients.get(sessionId);
    if (!clientSet) {
      clientSet = new Set();
      this.clients.set(sessionId, clientSet);
    }
    clientSet.add(ws);

    // Subscribe to Pi session events on first client
    if (clientSet.size === 1) {
      const runner = agentSession.runner as any;
      const piSession = runner?.piSession;
      if (piSession) {
        this.subscribeToSession(sessionId, piSession);
        // Send initial state snapshot
        try {
          const state = piSession.state;
          ws.send(JSON.stringify({ type: "state_snapshot", state }) + "\n");
        } catch {
          // state not available yet — client will receive live events
        }
      }
    } else {
      // Send state snapshot to newly joining client
      const runner = agentSession.runner as any;
      const piSession = runner?.piSession;
      if (piSession) {
        try {
          const state = piSession.state;
          ws.send(JSON.stringify({ type: "state_snapshot", state }) + "\n");
        } catch {}
      }
    }

    // Handle commands from client
    ws.on("message", (raw: Buffer | string) => {
      let cmd: AttachCommand;
      try {
        cmd = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
      } catch {
        return;
      }
      this.handleCommand(sessionId, ws, cmd);
    });

    ws.on("close", () => {
      this.detach(sessionId, ws);
    });

    ws.on("error", () => {
      this.detach(sessionId, ws);
    });
  }

  private handleCommand(sessionId: string, ws: WebSocket, cmd: AttachCommand): void {
    const agentSession = this.statusTracker.getSessions().find(s => s.id === sessionId);
    if (!agentSession) return;
    const runner = agentSession.runner as any;

    if (cmd.type === "get_state") {
      const piSession = runner?.piSession;
      if (piSession) {
        try {
          ws.send(JSON.stringify({ type: "state_snapshot", state: piSession.state }) + "\n");
        } catch {}
      }
    } else if (cmd.type === "steer" && cmd.message) {
      const piSession = runner?.piSession;
      if (piSession && typeof piSession.steer === "function") {
        try { piSession.steer(cmd.message); } catch {}
      }
    } else if (cmd.type === "abort") {
      if (runner && typeof runner.abort === "function") {
        try { runner.abort(); } catch {}
      }
    }
  }

  private detach(sessionId: string, ws: WebSocket): void {
    const clientSet = this.clients.get(sessionId);
    if (!clientSet) return;
    clientSet.delete(ws);
    if (clientSet.size === 0) {
      this.clients.delete(sessionId);
      this.unsubscribeFromSession(sessionId);
    }
  }

  private subscribeToSession(sessionId: string, piSession: any): void {
    const unsubscribe = piSession.subscribe((event: any) => {
      this.broadcast(sessionId, event);
    });
    this.piSubscriptions.set(sessionId, unsubscribe);
  }

  private unsubscribeFromSession(sessionId: string): void {
    const unsubscribe = this.piSubscriptions.get(sessionId);
    if (unsubscribe) {
      try { unsubscribe(); } catch {}
      this.piSubscriptions.delete(sessionId);
    }
  }

  private broadcast(sessionId: string, event: object): void {
    const clientSet = this.clients.get(sessionId);
    if (!clientSet || clientSet.size === 0) return;
    const payload = JSON.stringify(event) + "\n";
    for (const ws of clientSet) {
      if (ws.readyState === 1 /* OPEN */) {
        try { ws.send(payload); } catch {}
      } else {
        clientSet.delete(ws);
      }
    }
  }

  /**
   * Called when a session reaches a terminal state.
   * Sends a final agent_end event and closes all attached clients.
   */
  notifyTerminal(sessionId: string): void {
    const clientSet = this.clients.get(sessionId);
    if (!clientSet) return;

    const payload = JSON.stringify({ type: "agent_end", sessionId }) + "\n";
    for (const ws of clientSet) {
      if (ws.readyState === 1 /* OPEN */) {
        try {
          ws.send(payload);
          ws.close();
        } catch {}
      }
    }
    this.clients.delete(sessionId);
    this.unsubscribeFromSession(sessionId);
  }
}
