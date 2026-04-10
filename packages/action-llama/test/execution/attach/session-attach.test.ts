import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionAttachManager } from "../../../src/execution/attach/session-attach.js";
import type { StatusTracker } from "../../../src/tui/status-tracker.js";

// Minimal WebSocket mock
function makeMockWs() {
  const listeners: Record<string, Function[]> = {};
  return {
    readyState: 1, // OPEN
    send: vi.fn(),
    close: vi.fn(),
    on(event: string, cb: Function) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    },
    emit(event: string, ...args: any[]) {
      for (const cb of listeners[event] ?? []) cb(...args);
    },
  };
}

function makeMockStatusTracker(sessions: any[] = []) {
  return {
    getSessions: vi.fn(() => sessions),
  } as unknown as StatusTracker;
}

describe("SessionAttachManager", () => {
  let attachManager: SessionAttachManager;

  describe("attach to unknown session", () => {
    it("sends error and closes if session not found", () => {
      const tracker = makeMockStatusTracker([]);
      attachManager = new SessionAttachManager(tracker);
      const ws = makeMockWs();
      attachManager.attach("unknown-id", ws as any);
      expect(ws.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"error"')
      );
      expect(ws.close).toHaveBeenCalled();
    });
  });

  describe("attach to running session", () => {
    let piSession: any;
    let unsubscribeFn: ReturnType<typeof vi.fn>;
    let runner: any;
    let tracker: StatusTracker;

    beforeEach(() => {
      unsubscribeFn = vi.fn();
      piSession = {
        state: { messages: [], status: "running" },
        subscribe: vi.fn((cb: Function) => {
          piSession._cb = cb;
          return unsubscribeFn;
        }),
        steer: vi.fn(),
      };
      runner = { piSession, abort: vi.fn() };
      tracker = makeMockStatusTracker([
        { id: "sess-1", status: "running", runner },
      ]);
      attachManager = new SessionAttachManager(tracker);
    });

    it("sends state_snapshot on attach", () => {
      const ws = makeMockWs();
      attachManager.attach("sess-1", ws as any);
      expect(ws.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"state_snapshot"')
      );
    });

    it("subscribes to Pi session on first client", () => {
      const ws = makeMockWs();
      attachManager.attach("sess-1", ws as any);
      expect(piSession.subscribe).toHaveBeenCalledTimes(1);
    });

    it("does not subscribe again for second client", () => {
      const ws1 = makeMockWs();
      const ws2 = makeMockWs();
      attachManager.attach("sess-1", ws1 as any);
      attachManager.attach("sess-1", ws2 as any);
      expect(piSession.subscribe).toHaveBeenCalledTimes(1);
    });

    it("broadcasts Pi events to all connected clients", () => {
      const ws1 = makeMockWs();
      const ws2 = makeMockWs();
      attachManager.attach("sess-1", ws1 as any);
      attachManager.attach("sess-1", ws2 as any);
      // Clear send calls from initial state_snapshot
      ws1.send.mockClear();
      ws2.send.mockClear();

      piSession._cb({ type: "turn_end" });

      expect(ws1.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"turn_end"')
      );
      expect(ws2.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"turn_end"')
      );
    });

    it("unsubscribes from Pi session when last client disconnects", () => {
      const ws = makeMockWs();
      attachManager.attach("sess-1", ws as any);
      ws.emit("close");
      expect(unsubscribeFn).toHaveBeenCalled();
    });

    it("does not unsubscribe until all clients disconnect", () => {
      const ws1 = makeMockWs();
      const ws2 = makeMockWs();
      attachManager.attach("sess-1", ws1 as any);
      attachManager.attach("sess-1", ws2 as any);

      ws1.emit("close");
      expect(unsubscribeFn).not.toHaveBeenCalled();

      ws2.emit("close");
      expect(unsubscribeFn).toHaveBeenCalled();
    });

    it("handles get_state command", () => {
      const ws = makeMockWs();
      attachManager.attach("sess-1", ws as any);
      ws.send.mockClear();

      ws.emit("message", Buffer.from(JSON.stringify({ type: "get_state" })));
      expect(ws.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"state_snapshot"')
      );
    });

    it("handles steer command", () => {
      const ws = makeMockWs();
      attachManager.attach("sess-1", ws as any);
      ws.emit("message", Buffer.from(JSON.stringify({ type: "steer", message: "hello" })));
      expect(piSession.steer).toHaveBeenCalledWith("hello");
    });

    it("handles abort command", () => {
      const ws = makeMockWs();
      attachManager.attach("sess-1", ws as any);
      ws.emit("message", Buffer.from(JSON.stringify({ type: "abort" })));
      expect(runner.abort).toHaveBeenCalled();
    });
  });

  describe("notifyTerminal", () => {
    it("sends agent_end and closes all clients", () => {
      const unsubscribeFn = vi.fn();
      const piSession = {
        state: {},
        subscribe: vi.fn(() => unsubscribeFn),
        _cb: null as Function | null,
      };
      piSession.subscribe.mockImplementation((cb: Function) => {
        piSession._cb = cb;
        return unsubscribeFn;
      });
      const runner = { piSession, abort: vi.fn() };
      const tracker = makeMockStatusTracker([
        { id: "sess-term", status: "running", runner },
      ]);
      attachManager = new SessionAttachManager(tracker);

      const ws = makeMockWs();
      attachManager.attach("sess-term", ws as any);
      ws.send.mockClear();

      attachManager.notifyTerminal("sess-term");

      expect(ws.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"agent_end"')
      );
      expect(ws.close).toHaveBeenCalled();
      expect(unsubscribeFn).toHaveBeenCalled();
    });

    it("is a no-op for sessions with no clients", () => {
      const tracker = makeMockStatusTracker([]);
      attachManager = new SessionAttachManager(tracker);
      // Should not throw
      expect(() => attachManager.notifyTerminal("no-clients")).not.toThrow();
    });
  });
});
