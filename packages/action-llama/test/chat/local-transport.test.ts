import { describe, it, expect, vi, beforeEach } from "vitest";
import { LocalTransport } from "../../src/chat/local-transport.js";

function createMockSession() {
  const handlers: ((event: any) => void)[] = [];
  return {
    prompt: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    subscribe: vi.fn((handler: (event: any) => void) => {
      handlers.push(handler);
    }),
    // Test helper to emit events
    _emit(event: any) {
      for (const h of handlers) h(event);
    },
  };
}

describe("LocalTransport", () => {
  let session: ReturnType<typeof createMockSession>;
  let transport: LocalTransport;

  beforeEach(() => {
    vi.clearAllMocks();
    session = createMockSession();
    transport = new LocalTransport({ session });
  });

  describe("connection state", () => {
    it("starts connected", () => {
      expect(transport.connected).toBe(true);
    });

    it("disconnects on close", async () => {
      await transport.close();
      expect(transport.connected).toBe(false);
      expect(session.dispose).toHaveBeenCalled();
    });
  });

  describe("send user_message", () => {
    it("calls session.prompt with text", () => {
      transport.send({ type: "user_message", text: "hello" });
      expect(session.prompt).toHaveBeenCalledWith("hello");
    });

    it("emits error when agent is busy", () => {
      const handler = vi.fn();
      transport.onMessage(handler);

      // Block the agent
      session.prompt.mockReturnValue(new Promise(() => {})); // never resolves
      transport.send({ type: "user_message", text: "first" });

      // Second message while busy
      transport.send({ type: "user_message", text: "second" });
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error", message: expect.stringContaining("busy") }),
      );
    });

    it("emits error when prompt rejects", async () => {
      const handler = vi.fn();
      transport.onMessage(handler);

      session.prompt.mockRejectedValueOnce(new Error("model failure"));
      transport.send({ type: "user_message", text: "test" });

      // Wait for the rejection to be handled
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error", message: "model failure" }),
      );
    });
  });

  describe("send cancel", () => {
    it("calls dispose when agent is busy", () => {
      session.prompt.mockReturnValue(new Promise(() => {}));
      transport.send({ type: "user_message", text: "test" });
      transport.send({ type: "cancel" });
      expect(session.dispose).toHaveBeenCalled();
    });

    it("does nothing when agent is idle", () => {
      transport.send({ type: "cancel" });
      expect(session.dispose).not.toHaveBeenCalled();
    });
  });

  describe("send shutdown", () => {
    it("disposes session and disconnects", () => {
      transport.send({ type: "shutdown" });
      expect(session.dispose).toHaveBeenCalled();
      expect(transport.connected).toBe(false);
    });
  });

  describe("onMessage", () => {
    it("forwards text_delta events as assistant_message", () => {
      const handler = vi.fn();
      transport.onMessage(handler);

      session._emit({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Hello" },
      });

      expect(handler).toHaveBeenCalledWith({
        type: "assistant_message",
        text: "Hello",
        done: false,
      });
    });

    it("forwards turn_end as done=true", () => {
      const handler = vi.fn();
      transport.onMessage(handler);

      session._emit({ type: "turn_end" });

      expect(handler).toHaveBeenCalledWith({
        type: "assistant_message",
        text: "",
        done: true,
      });
    });

    it("forwards tool events", () => {
      const handler = vi.fn();
      transport.onMessage(handler);

      session._emit({
        type: "tool_execution_start",
        toolCallId: "tc-1",
        toolName: "bash",
        args: { command: "ls" },
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: "tool_start", tool: "bash" }),
      );
    });

    it("returns unsubscribe function", () => {
      const handler = vi.fn();
      const unsub = transport.onMessage(handler);

      session._emit({ type: "turn_end" });
      expect(handler).toHaveBeenCalledTimes(1);

      unsub();
      session._emit({ type: "turn_end" });
      expect(handler).toHaveBeenCalledTimes(1); // no additional call
    });
  });

  describe("busy state management", () => {
    it("becomes idle after done=true message", async () => {
      const handler = vi.fn();
      transport.onMessage(handler);

      transport.send({ type: "user_message", text: "test" });
      // Agent is now busy

      // Simulate turn completion
      session._emit({ type: "turn_end" });
      await session.prompt.mock.results[0]?.value;

      // Should be able to send another message
      transport.send({ type: "user_message", text: "another" });
      expect(session.prompt).toHaveBeenCalledTimes(2);
    });
  });
});
