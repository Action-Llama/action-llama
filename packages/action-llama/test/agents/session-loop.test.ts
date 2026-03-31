import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
const mockSubscribe = vi.fn();
const mockPrompt = vi.fn();
const mockDispose = vi.fn();
const mockGetSessionStats = vi.fn();

vi.mock("@mariozechner/pi-coding-agent", () => ({
  AuthStorage: {
    create: () => ({
      setRuntimeApiKey: vi.fn(),
    }),
  },
  createAgentSession: vi.fn(async () => ({
    session: {
      subscribe: mockSubscribe,
      prompt: mockPrompt,
      dispose: mockDispose,
      getSessionStats: mockGetSessionStats,
    },
  })),
  SessionManager: { inMemory: () => ({}) },
  createCodingTools: vi.fn(() => []),
}));

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn(() => ({ provider: "anthropic", model: "claude-sonnet" })),
}));

vi.mock("../../src/agents/model-fallback.js", async () => {
  const actual = await vi.importActual<any>("../../src/agents/model-fallback.js");
  return {
    ModelCircuitBreaker: actual.ModelCircuitBreaker,
    circuitBreaker: new actual.ModelCircuitBreaker(),
    selectAvailableModels: (models: any[], _breaker: any) => models,
    isRateLimitError: (msg: string) =>
      msg.includes("rate_limit") || msg.includes("429"),
  };
});

vi.mock("../../src/agents/bash-prefix.js", () => ({
  BASH_COMMAND_PREFIX: "",
}));

import { runSessionLoop } from "../../src/agents/session-loop.js";
import { ModelCircuitBreaker } from "../../src/agents/model-fallback.js";
import type { ModelConfig } from "../../src/shared/config.js";

function makeModels(overrides: Partial<ModelConfig> = {}): ModelConfig[] {
  return [
    {
      provider: "anthropic",
      model: "claude-sonnet",
      authType: "api_key",
      ...overrides,
    },
  ];
}

function makeBreaker() {
  return new ModelCircuitBreaker();
}

function makeOpts(overrides: Partial<Parameters<typeof runSessionLoop>[1]> = {}) {
  return {
    models: makeModels(),
    circuitBreaker: makeBreaker(),
    cwd: "/tmp",
    resourceLoader: { reload: vi.fn() },
    settingsManager: {},
    log: vi.fn(),
    ...overrides,
  };
}

describe("runSessionLoop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessionStats.mockReturnValue({
      tokens: { input: 100, output: 200, cacheRead: 50, cacheWrite: 25, total: 375 },
      cost: 0.00375,
      turnCount: 3,
    });
  });

  it("calls session.prompt with the given prompt and returns output", async () => {
    mockPrompt.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation((callback: Function) => {
      callback({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Hello world" },
      });
    });

    const result = await runSessionLoop("Test prompt", makeOpts());

    expect(mockPrompt).toHaveBeenCalledWith("Test prompt");
    expect(mockDispose).toHaveBeenCalled();
    expect(result.outputText).toBe("Hello world");
    expect(result.aborted).toBe(false);
    expect(result.unrecoverableErrors).toBe(0);
  });

  it("returns token usage from session stats", async () => {
    mockPrompt.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation(() => {});

    const result = await runSessionLoop("Test", makeOpts());

    expect(result.usage).toMatchObject({
      inputTokens: 100,
      outputTokens: 200,
      cacheReadTokens: 50,
      cacheWriteTokens: 25,
      totalTokens: 375,
      cost: 0.00375,
      turnCount: 3,
    });
  });

  it("falls back to second model when first is rate-limited", async () => {
    const models: ModelConfig[] = [
      { provider: "anthropic", model: "claude-sonnet", authType: "api_key" },
      { provider: "openai", model: "gpt-4", authType: "api_key" },
    ];

    let callCount = 0;
    mockPrompt.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error("rate_limit: Too Many Requests");
    });
    mockSubscribe.mockImplementation(() => {});

    const opts = makeOpts({ models });
    const result = await runSessionLoop("Test", opts);

    expect(mockPrompt).toHaveBeenCalledTimes(2);
    expect(result.aborted).toBe(false);
  });

  it("backs off and retries when all models are exhausted", async () => {
    vi.useFakeTimers();

    const logFn = vi.fn();
    mockPrompt.mockRejectedValue(new Error("rate_limit: Too Many Requests"));
    mockSubscribe.mockImplementation(() => {});

    const runPromise = runSessionLoop("Test", makeOpts({ log: logFn }));
    await vi.runAllTimersAsync();
    await runPromise;

    expect(logFn).toHaveBeenCalledWith(
      "warn",
      "all models exhausted, backing off",
      expect.objectContaining({ pass: 1 }),
    );

    vi.useRealTimers();
  });

  it("calls onUnrecoverableAbort and sets aborted when threshold exceeded", async () => {
    const onUnrecoverableAbort = vi.fn();
    mockPrompt.mockResolvedValue(undefined);

    // Fire UNRECOVERABLE_THRESHOLD (3) auth failure tool errors
    mockSubscribe.mockImplementation((callback: Function) => {
      for (let i = 0; i < 3; i++) {
        callback({
          type: "tool_execution_end",
          toolName: "bash",
          toolCallId: `call-${i}`,
          result: "permission denied: cannot access repository",
          isError: true,
        });
      }
    });

    const result = await runSessionLoop("Test", makeOpts({ onUnrecoverableAbort }));

    expect(onUnrecoverableAbort).toHaveBeenCalledTimes(1);
    expect(result.aborted).toBe(true);
    expect(result.unrecoverableErrors).toBe(3);
  });

  it("emits bash command logs for tool_execution_start events", async () => {
    const logFn = vi.fn();
    mockPrompt.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation((callback: Function) => {
      callback({
        type: "tool_execution_start",
        toolName: "bash",
        toolCallId: "call-1",
        args: { command: "gh issue list" },
      });
      callback({
        type: "tool_execution_end",
        toolName: "bash",
        toolCallId: "call-1",
        result: "[]",
        isError: false,
      });
    });

    await runSessionLoop("Test", makeOpts({ log: logFn }));

    expect(logFn).toHaveBeenCalledWith("info", "bash", { cmd: "gh issue list" });
  });

  it("passes providerKeys correctly without error", async () => {
    mockPrompt.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation(() => {});

    const providerKeys = new Map([["anthropic", "test-key-123"]]);
    const result = await runSessionLoop("Test", makeOpts({ providerKeys }));

    // Session loop completed successfully with providerKeys set
    expect(result.aborted).toBe(false);
    expect(mockPrompt).toHaveBeenCalledWith("Test");
  });

  it("records circuit breaker success on successful prompt", async () => {
    mockPrompt.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation(() => {});

    const breaker = makeBreaker();
    const recordSuccess = vi.spyOn(breaker, "recordSuccess");

    await runSessionLoop("Test", makeOpts({ circuitBreaker: breaker }));

    expect(recordSuccess).toHaveBeenCalledWith("anthropic", "claude-sonnet");
  });

  it("records circuit breaker failure on rate limit", async () => {
    vi.useFakeTimers();
    const breaker = makeBreaker();
    const recordFailure = vi.spyOn(breaker, "recordFailure");

    mockPrompt.mockRejectedValue(new Error("429 Too Many Requests"));
    mockSubscribe.mockImplementation(() => {});

    const runPromise = runSessionLoop("Test", makeOpts({ circuitBreaker: breaker }));
    await vi.runAllTimersAsync();
    await runPromise;

    expect(recordFailure).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("logs token-usage after successful session", async () => {
    const logFn = vi.fn();
    mockPrompt.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation(() => {});

    await runSessionLoop("Test", makeOpts({ log: logFn }));

    expect(logFn).toHaveBeenCalledWith(
      "info",
      "token-usage",
      expect.objectContaining({
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 375,
      }),
    );
  });

  it("accumulates text across multiple text_delta events", async () => {
    mockPrompt.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation((callback: Function) => {
      callback({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Hello " },
      });
      callback({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "world" },
      });
    });

    const result = await runSessionLoop("Test", makeOpts());

    expect(result.outputText).toBe("Hello world");
  });

  it("throws non-rate-limit errors from prompt", async () => {
    mockPrompt.mockRejectedValue(new Error("Internal server error"));
    mockSubscribe.mockImplementation(() => {});

    await expect(runSessionLoop("Test", makeOpts())).rejects.toThrow("Internal server error");
  });

  it("logs message_start and message_end events with role/content/stopReason", async () => {
    const log = vi.fn();
    mockPrompt.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation((callback: Function) => {
      // Emit message_start event
      callback({
        type: "message_start",
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
        stopReason: null,
      });
      // Emit message_end event
      callback({
        type: "message_end",
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
        stopReason: "end_turn",
      });
      // Emit turn_end event
      callback({
        type: "turn_end",
        result: "success",
        turnCount: 1,
      });
      // Emit error type event
      callback({
        type: "error",
        error: "Something went wrong",
      });
      // Emit message_update (text_delta) to accumulate text
      callback({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "hello world" },
      });
    });

    await runSessionLoop("Test prompt", makeOpts({ log }));

    // message_start should have been logged as debug

    expect(log).toHaveBeenCalledWith(
      "debug", "event",
      expect.objectContaining({ type: "message_start", role: "assistant" })
    );
    // message_end should have been logged as debug
    expect(log).toHaveBeenCalledWith(
      "debug", "event",
      expect.objectContaining({ type: "message_end", stopReason: "end_turn" })
    );
    // turn_end should have been logged as debug
    expect(log).toHaveBeenCalledWith(
      "debug", "event",
      expect.objectContaining({ type: "turn_end", turnResult: expect.any(String) })
    );
    // error event should have been logged
    expect(log).toHaveBeenCalledWith(
      "error", "session error",
      expect.objectContaining({ error: expect.stringContaining("Something went wrong") })
    );
  });

  it("logs accumulated assistant text when message_end fires after text_delta", async () => {
    const log = vi.fn();
    mockPrompt.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation((callback: Function) => {
      // Accumulate text via text_delta BEFORE message_end
      callback({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Hello from assistant" },
      });
      callback({
        type: "message_end",
        role: "assistant",
        content: [],
        stopReason: "end_turn",
      });
    });

    await runSessionLoop("Test prompt", makeOpts({ log }));

    // Should log "assistant" info with the accumulated text
    expect(log).toHaveBeenCalledWith("info", "assistant", { text: "Hello from assistant" });
  });

  it("logs non-bash tool start as debug tool start", async () => {
    const log = vi.fn();
    mockPrompt.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation((callback: Function) => {
      callback({
        type: "tool_execution_start",
        toolName: "web_search",
        toolCallId: "call-search",
        args: { query: "latest news" },
      });
      callback({
        type: "tool_execution_end",
        toolName: "web_search",
        toolCallId: "call-search",
        result: "some results",
        isError: false,
      });
    });

    await runSessionLoop("Test", makeOpts({ log }));

    // Should log as debug "tool start" (not "bash")
    expect(log).toHaveBeenCalledWith("debug", "tool start", { tool: "web_search" });
  });
});
