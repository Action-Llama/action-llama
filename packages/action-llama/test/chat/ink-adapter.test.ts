/**
 * Tests for chat/ink-adapter.ts
 *
 * Covers runChatTUI and the ChatApp component by intercepting the ink render
 * call from runChatTUI, then rendering the captured element with ink-testing-library.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render as renderTL } from "ink-testing-library";

// ─── Capture the element passed to ink's render by runChatTUI ─────────────────
// We distinguish calls from runChatTUI (no options) vs ink-testing-library
// (options.debug === true) so ink-testing-library can still work normally.

const { capturedRef, resolverRef } = vi.hoisted(() => ({
  capturedRef: { element: null as React.ReactElement | null },
  resolverRef: { resolve: null as (() => void) | null },
}));

vi.mock("ink", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ink")>();
  return {
    ...actual,
    render: (element: React.ReactElement, options?: any) => {
      if (options && options.debug === true) {
        // Called from ink-testing-library — use the real render
        return actual.render(element, options);
      }
      // Called from runChatTUI — capture the element and resolve immediately
      capturedRef.element = element;
      return {
        waitUntilExit: () =>
          new Promise<void>((resolve) => {
            resolverRef.resolve = resolve;
          }),
        unmount: () => {
          resolverRef.resolve?.();
        },
        clear: () => {},
        rerender: () => {},
        cleanup: () => {},
      };
    },
  };
});

import { runChatTUI } from "../../src/chat/ink-adapter.js";
import type { ChatTransport } from "../../src/chat/transport.js";
import type { ChatOutbound } from "../../src/chat/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMockTransport(): ChatTransport & {
  _triggerMessage: (msg: ChatOutbound) => void;
} {
  let handler: ((msg: ChatOutbound) => void) | null = null;

  const transport: ChatTransport & { _triggerMessage: (msg: ChatOutbound) => void } = {
    send: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    connected: true,
    onMessage(h: (msg: ChatOutbound) => void) {
      handler = h;
      return () => { handler = null; };
    },
    _triggerMessage(msg: ChatOutbound) {
      handler?.(msg);
    },
  };

  return transport;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("runChatTUI", () => {
  afterEach(() => {
    capturedRef.element = null;
    resolverRef.resolve = null;
  });

  it("calls ink render and awaits exit", async () => {
    const transport = makeMockTransport();

    // Start runChatTUI (it will block on waitUntilExit)
    const runPromise = runChatTUI(transport, "test-agent");

    // The render was called and element was captured
    expect(capturedRef.element).not.toBeNull();

    // Resolve the waitUntilExit promise to let runChatTUI finish
    resolverRef.resolve?.();
    await runPromise;
  });

  it("renders the ChatApp component with agent name", async () => {
    const transport = makeMockTransport();

    const runPromise = runChatTUI(transport, "my-agent");
    expect(capturedRef.element).not.toBeNull();

    // Render the captured element with ink-testing-library for full component coverage
    const instance = renderTL(capturedRef.element!);
    const output = instance.lastFrame() ?? "";

    expect(output).toContain("my-agent");

    instance.unmount();
    resolverRef.resolve?.();
    await runPromise;
  });

  it("displays assistant messages when received", async () => {
    const transport = makeMockTransport();
    const runPromise = runChatTUI(transport, "msg-agent");

    const instance = renderTL(capturedRef.element!);

    // Send a streaming assistant message
    transport._triggerMessage({ type: "assistant_message", text: "Hello from agent", done: false });

    await new Promise((r) => setTimeout(r, 50));
    const output = instance.lastFrame() ?? "";
    expect(output).toContain("Hello from agent");

    // Send done signal
    transport._triggerMessage({ type: "assistant_message", text: "", done: true });
    await new Promise((r) => setTimeout(r, 50));

    instance.unmount();
    resolverRef.resolve?.();
    await runPromise;
  });

  it("displays tool_start messages", async () => {
    const transport = makeMockTransport();
    const runPromise = runChatTUI(transport, "tool-agent");

    const instance = renderTL(capturedRef.element!);

    transport._triggerMessage({
      type: "tool_start",
      toolCallId: "tc1",
      tool: "bash",
      input: "echo hello",
    });
    await new Promise((r) => setTimeout(r, 50));

    const output = instance.lastFrame() ?? "";
    expect(output).toContain("bash");

    instance.unmount();
    resolverRef.resolve?.();
    await runPromise;
  });

  it("displays tool_result messages", async () => {
    const transport = makeMockTransport();
    const runPromise = runChatTUI(transport, "tool-res-agent");

    const instance = renderTL(capturedRef.element!);

    transport._triggerMessage({
      type: "tool_result",
      toolCallId: "tc2",
      tool: "bash",
      output: "hello world",
    });
    await new Promise((r) => setTimeout(r, 50));

    const output = instance.lastFrame() ?? "";
    expect(output).toContain("bash");

    instance.unmount();
    resolverRef.resolve?.();
    await runPromise;
  });

  it("displays error messages", async () => {
    const transport = makeMockTransport();
    const runPromise = runChatTUI(transport, "err-agent");

    const instance = renderTL(capturedRef.element!);

    transport._triggerMessage({
      type: "error",
      message: "Something went wrong",
    });
    await new Promise((r) => setTimeout(r, 50));

    const output = instance.lastFrame() ?? "";
    expect(output).toContain("Something went wrong");

    instance.unmount();
    resolverRef.resolve?.();
    await runPromise;
  });

  it("ignores heartbeat messages", async () => {
    const transport = makeMockTransport();
    const runPromise = runChatTUI(transport, "hb-agent");

    const instance = renderTL(capturedRef.element!);
    const framesBefore = instance.frames.length;

    transport._triggerMessage({ type: "heartbeat" });
    await new Promise((r) => setTimeout(r, 50));

    // Heartbeat shouldn't add any new messages to the UI
    // (frames may still change due to the cursor blink, but no "heartbeat" text)
    const output = instance.frames.join("\n");
    expect(output).not.toContain("heartbeat");

    instance.unmount();
    resolverRef.resolve?.();
    await runPromise;
  });

  it("handles tool_result with error flag", async () => {
    const transport = makeMockTransport();
    const runPromise = runChatTUI(transport, "tool-err-agent");

    const instance = renderTL(capturedRef.element!);

    transport._triggerMessage({
      type: "tool_result",
      toolCallId: "tc3",
      tool: "bash",
      output: "command failed",
      error: true,
    });
    await new Promise((r) => setTimeout(r, 50));

    const output = instance.lastFrame() ?? "";
    expect(output).toContain("ERROR");

    instance.unmount();
    resolverRef.resolve?.();
    await runPromise;
  });
});
