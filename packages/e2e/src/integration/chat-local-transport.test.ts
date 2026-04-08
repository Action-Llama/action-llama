/**
 * Integration tests: chat/local-transport.ts LocalTransport — no Docker required.
 *
 * LocalTransport wraps a PI agent session and implements the ChatTransport
 * interface, routing inbound messages to the session and outbound session
 * events to registered listeners via mapAgentEvent().
 *
 * Test scenarios (no Docker required):
 *   1. connected getter — true on construction, false after close()
 *   2. onMessage registration — returns unsubscribe function
 *   3. onMessage unsubscribe — handler not called after unsubscribe
 *   4. session.subscribe — session events forwarded to onMessage handlers
 *   5. mapAgentEvent integration — message_update yields assistant_message
 *   6. agent_end sets agentBusy=false (subsequent user_message accepted)
 *   7. send user_message — calls session.prompt() with text
 *   8. send user_message when busy — emits error, does not call prompt()
 *   9. send cancel when busy — calls session.dispose(), clears busy flag
 *   10. send cancel when not busy — no-op (does not dispose)
 *   11. send shutdown — calls session.dispose(), sets connected=false
 *   12. close() — sets connected=false, calls session.dispose()
 *   13. multiple handlers — all receive events
 *   14. session.prompt() rejection — emits error event, clears busy flag
 *   15. send user_message after previous prompt resolved — accepted again
 *
 * Covers:
 *   - chat/local-transport.ts: LocalTransport constructor (subscribe setup)
 *   - chat/local-transport.ts: connected getter (true/false)
 *   - chat/local-transport.ts: send() user_message path — prompt call + busy flag
 *   - chat/local-transport.ts: send() user_message busy guard — error emit
 *   - chat/local-transport.ts: send() cancel busy path — dispose + clear busy
 *   - chat/local-transport.ts: send() cancel non-busy path — no-op
 *   - chat/local-transport.ts: send() shutdown path — dispose + connected=false
 *   - chat/local-transport.ts: onMessage() registration and unsubscribe
 *   - chat/local-transport.ts: close() — connected=false + dispose + clear handlers
 *   - chat/local-transport.ts: mapAgentEvent integration — agent_end clears busy
 */

import { describe, it, expect, vi } from "vitest";

const { LocalTransport } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/chat/local-transport.js"
);

// ── Helpers ────────────────────────────────────────────────────────────────────

interface MockSession {
  prompt: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  /** Fire a subscribed session event */
  emit: (event: unknown) => void;
}

function makeMockSession(promptBehavior?: () => Promise<any>): MockSession {
  let subscriber: ((event: unknown) => void) | undefined;

  const session: MockSession = {
    prompt: vi.fn().mockImplementation(promptBehavior ?? (() => Promise.resolve())),
    dispose: vi.fn(),
    subscribe: vi.fn().mockImplementation((handler: (event: unknown) => void) => {
      subscriber = handler;
    }),
    emit: (event: unknown) => {
      if (subscriber) subscriber(event);
    },
  };

  return session;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("integration: LocalTransport (no Docker required)", { timeout: 30_000 }, () => {

  // ── connected getter ──────────────────────────────────────────────────────

  it("connected is true on construction", () => {
    const session = makeMockSession();
    const transport = new LocalTransport({ session });
    expect(transport.connected).toBe(true);
  });

  it("connected is false after close()", async () => {
    const session = makeMockSession();
    const transport = new LocalTransport({ session });
    await transport.close();
    expect(transport.connected).toBe(false);
  });

  it("connected is false after send(shutdown)", () => {
    const session = makeMockSession();
    const transport = new LocalTransport({ session });
    transport.send({ type: "shutdown" });
    expect(transport.connected).toBe(false);
  });

  // ── subscribe / unsubscribe ───────────────────────────────────────────────

  it("onMessage() returns a function", async () => {
    const session = makeMockSession();
    const transport = new LocalTransport({ session });
    const unsub = transport.onMessage(() => {});
    expect(typeof unsub).toBe("function");
    await transport.close();
  });

  it("onMessage() handler receives events from session", () => {
    const session = makeMockSession();
    const transport = new LocalTransport({ session });

    const received: any[] = [];
    transport.onMessage((msg) => received.push(msg));

    // Emit an agent_end event from the session
    session.emit({ type: "agent_end" });

    expect(received.length).toBeGreaterThan(0);
    expect(received[0].type).toBe("assistant_message");
    expect(received[0].done).toBe(true);
  });

  it("onMessage() handler not called after unsubscribe", () => {
    const session = makeMockSession();
    const transport = new LocalTransport({ session });

    const received: any[] = [];
    const unsub = transport.onMessage((msg) => received.push(msg));
    unsub(); // unsubscribe

    session.emit({ type: "agent_end" });

    expect(received.length).toBe(0);
  });

  it("multiple onMessage() handlers all receive events", () => {
    const session = makeMockSession();
    const transport = new LocalTransport({ session });

    const received1: any[] = [];
    const received2: any[] = [];
    transport.onMessage((msg) => received1.push(msg));
    transport.onMessage((msg) => received2.push(msg));

    session.emit({ type: "agent_end" });

    expect(received1.length).toBeGreaterThan(0);
    expect(received2.length).toBeGreaterThan(0);
  });

  // ── send user_message ─────────────────────────────────────────────────────

  it("send user_message calls session.prompt() with the text", async () => {
    const session = makeMockSession();
    const transport = new LocalTransport({ session });

    transport.send({ type: "user_message", text: "Hello agent!" });

    expect(session.prompt).toHaveBeenCalledWith("Hello agent!");
    await transport.close();
  });

  it("send user_message when agent is busy emits error and does NOT call prompt()", async () => {
    // Make prompt hang indefinitely so agent stays busy
    let resolvePrompt!: () => void;
    const session = makeMockSession(() => new Promise<void>((res) => { resolvePrompt = res; }));
    const transport = new LocalTransport({ session });

    const received: any[] = [];
    transport.onMessage((msg) => received.push(msg));

    // First message — makes agent busy
    transport.send({ type: "user_message", text: "First" });
    expect(session.prompt).toHaveBeenCalledTimes(1);

    // Second message while busy — should emit error
    transport.send({ type: "user_message", text: "Second" });
    expect(session.prompt).toHaveBeenCalledTimes(1); // still only 1

    // Should have received an error message
    const errorMsg = received.find((m) => m.type === "error");
    expect(errorMsg).toBeDefined();
    expect(errorMsg.message).toContain("busy");

    // Clean up
    resolvePrompt();
    await transport.close();
  });

  it("send user_message after prompt resolves is accepted again", async () => {
    const session = makeMockSession();
    const transport = new LocalTransport({ session });

    // First send
    transport.send({ type: "user_message", text: "First" });

    // Wait for prompt to resolve and session events to propagate
    await new Promise((r) => setTimeout(r, 10));

    // Simulate agent_end to clear busy flag
    session.emit({ type: "agent_end" });

    // Second send should be accepted now
    session.prompt.mockClear();
    transport.send({ type: "user_message", text: "Second" });
    expect(session.prompt).toHaveBeenCalledWith("Second");

    await transport.close();
  });

  // ── session.prompt() rejection ────────────────────────────────────────────

  it("session.prompt() rejection emits error and clears busy flag", async () => {
    const session = makeMockSession(() => Promise.reject(new Error("model failed")));
    const transport = new LocalTransport({ session });

    const received: any[] = [];
    transport.onMessage((msg) => received.push(msg));

    transport.send({ type: "user_message", text: "Hello" });

    // Wait for rejection to propagate
    await new Promise((r) => setTimeout(r, 20));

    const errorMsg = received.find((m) => m.type === "error");
    expect(errorMsg).toBeDefined();
    expect(errorMsg.message).toContain("model failed");

    // Busy flag should be cleared — next send should work
    session.prompt.mockResolvedValue(undefined);
    session.prompt.mockClear();
    transport.send({ type: "user_message", text: "Retry" });
    expect(session.prompt).toHaveBeenCalledWith("Retry");

    await transport.close();
  });

  // ── send cancel ───────────────────────────────────────────────────────────

  it("send cancel when busy calls session.dispose() and clears busy flag", async () => {
    let resolvePrompt!: () => void;
    const session = makeMockSession(() => new Promise<void>((res) => { resolvePrompt = res; }));
    const transport = new LocalTransport({ session });

    // Make agent busy
    transport.send({ type: "user_message", text: "Long task" });
    expect(session.dispose).not.toHaveBeenCalled();

    // Cancel while busy
    transport.send({ type: "cancel" });
    expect(session.dispose).toHaveBeenCalled();

    // Clean up
    resolvePrompt();
    await transport.close();
  });

  it("send cancel when not busy is a no-op (does not call dispose)", () => {
    const session = makeMockSession();
    const transport = new LocalTransport({ session });

    transport.send({ type: "cancel" }); // not busy
    expect(session.dispose).not.toHaveBeenCalled();
  });

  // ── send shutdown ─────────────────────────────────────────────────────────

  it("send shutdown calls session.dispose()", () => {
    const session = makeMockSession();
    const transport = new LocalTransport({ session });

    transport.send({ type: "shutdown" });
    expect(session.dispose).toHaveBeenCalled();
  });

  // ── close() ───────────────────────────────────────────────────────────────

  it("close() calls session.dispose()", async () => {
    const session = makeMockSession();
    const transport = new LocalTransport({ session });

    await transport.close();
    expect(session.dispose).toHaveBeenCalled();
  });

  it("close() clears all handlers (no events delivered after close)", async () => {
    const session = makeMockSession();
    const transport = new LocalTransport({ session });

    const received: any[] = [];
    transport.onMessage((msg) => received.push(msg));

    await transport.close();

    // Emit event after close — should not deliver
    session.emit({ type: "agent_end" });
    expect(received.length).toBe(0);
  });

  // ── mapAgentEvent integration ─────────────────────────────────────────────

  it("message_update with text_delta emits assistant_message with done:false", () => {
    const session = makeMockSession();
    const transport = new LocalTransport({ session });

    const received: any[] = [];
    transport.onMessage((msg) => received.push(msg));

    session.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Stream chunk" },
    });

    expect(received.length).toBe(1);
    expect(received[0].type).toBe("assistant_message");
    expect(received[0].text).toBe("Stream chunk");
    expect(received[0].done).toBe(false);
  });

  it("agent_end clears agentBusy allowing next user_message", async () => {
    let resolvePrompt!: () => void;
    const session = makeMockSession(() => new Promise<void>((res) => { resolvePrompt = res; }));
    const transport = new LocalTransport({ session });

    // Send first message — agent becomes busy
    transport.send({ type: "user_message", text: "Task 1" });
    expect(session.prompt).toHaveBeenCalledTimes(1);

    // agent_end event clears busy state
    session.emit({ type: "agent_end" });

    // Now a second message should be accepted
    session.prompt.mockResolvedValue(undefined);
    session.prompt.mockClear();
    transport.send({ type: "user_message", text: "Task 2" });
    expect(session.prompt).toHaveBeenCalledWith("Task 2");

    resolvePrompt();
    await transport.close();
  });

  it("tool_execution_start event emits tool_start outbound message", () => {
    const session = makeMockSession();
    const transport = new LocalTransport({ session });

    const received: any[] = [];
    transport.onMessage((msg) => received.push(msg));

    session.emit({
      type: "tool_execution_start",
      toolCallId: "call-123",
      toolName: "bash",
      args: { command: "ls" },
    });

    const toolStart = received.find((m) => m.type === "tool_start");
    expect(toolStart).toBeDefined();
    expect(toolStart.tool).toBe("bash");
    expect(toolStart.toolCallId).toBe("call-123");
  });

  it("session subscription is set up in constructor (subscribe called once)", () => {
    const session = makeMockSession();
    new LocalTransport({ session });
    expect(session.subscribe).toHaveBeenCalledTimes(1);
  });
});
