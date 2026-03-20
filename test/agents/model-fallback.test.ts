import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ModelCircuitBreaker, selectAvailableModels, isRateLimitError } from "../../src/agents/model-fallback.js";
import type { ModelConfig } from "../../src/shared/config.js";

describe("ModelCircuitBreaker", () => {
  let breaker: ModelCircuitBreaker;

  beforeEach(() => {
    breaker = new ModelCircuitBreaker(1000); // 1s cooldown for tests
  });

  it("reports all models available initially", () => {
    expect(breaker.isAvailable("anthropic", "claude-sonnet-4")).toBe(true);
    expect(breaker.isAvailable("openai", "gpt-4o")).toBe(true);
  });

  it("marks a model unavailable after failure", () => {
    breaker.recordFailure("anthropic", "claude-sonnet-4");
    expect(breaker.isAvailable("anthropic", "claude-sonnet-4")).toBe(false);
    // Other models unaffected
    expect(breaker.isAvailable("openai", "gpt-4o")).toBe(true);
  });

  it("clears failure on success", () => {
    breaker.recordFailure("anthropic", "claude-sonnet-4");
    expect(breaker.isAvailable("anthropic", "claude-sonnet-4")).toBe(false);

    breaker.recordSuccess("anthropic", "claude-sonnet-4");
    expect(breaker.isAvailable("anthropic", "claude-sonnet-4")).toBe(true);
  });

  it("recovers after cooldown expires", () => {
    vi.useFakeTimers();
    try {
      breaker.recordFailure("anthropic", "claude-sonnet-4");
      expect(breaker.isAvailable("anthropic", "claude-sonnet-4")).toBe(false);

      vi.advanceTimersByTime(1001);
      expect(breaker.isAvailable("anthropic", "claude-sonnet-4")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays unavailable before cooldown expires", () => {
    vi.useFakeTimers();
    try {
      breaker.recordFailure("anthropic", "claude-sonnet-4");
      vi.advanceTimersByTime(500);
      expect(breaker.isAvailable("anthropic", "claude-sonnet-4")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("selectAvailableModels", () => {
  const sonnet: ModelConfig = { provider: "anthropic", model: "claude-sonnet-4", authType: "api_key" };
  const haiku: ModelConfig = { provider: "anthropic", model: "claude-haiku-4", authType: "api_key" };
  const gpt: ModelConfig = { provider: "openai", model: "gpt-4o", authType: "api_key" };

  it("returns all models when none tripped", () => {
    const breaker = new ModelCircuitBreaker();
    const result = selectAvailableModels([sonnet, haiku, gpt], breaker);
    expect(result).toEqual([sonnet, haiku, gpt]);
  });

  it("filters out tripped models", () => {
    const breaker = new ModelCircuitBreaker();
    breaker.recordFailure("anthropic", "claude-sonnet-4");
    const result = selectAvailableModels([sonnet, haiku, gpt], breaker);
    expect(result).toEqual([haiku, gpt]);
  });

  it("returns full list when all models are tripped", () => {
    const breaker = new ModelCircuitBreaker();
    breaker.recordFailure("anthropic", "claude-sonnet-4");
    breaker.recordFailure("anthropic", "claude-haiku-4");
    breaker.recordFailure("openai", "gpt-4o");
    const result = selectAvailableModels([sonnet, haiku, gpt], breaker);
    expect(result).toEqual([sonnet, haiku, gpt]);
  });
});

describe("isRateLimitError", () => {
  it("detects rate_limit", () => {
    expect(isRateLimitError("rate_limit exceeded")).toBe(true);
  });

  it("detects 429", () => {
    expect(isRateLimitError("HTTP 429 Too Many Requests")).toBe(true);
  });

  it("detects 529", () => {
    expect(isRateLimitError("HTTP 529")).toBe(true);
  });

  it("detects overloaded", () => {
    expect(isRateLimitError("API overloaded")).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isRateLimitError("invalid_api_key")).toBe(false);
    expect(isRateLimitError("network timeout")).toBe(false);
  });
});
