/**
 * Integration tests: agents/model-fallback.ts — no Docker required.
 *
 * The model-fallback module provides circuit breaker and fallback logic for
 * LLM model selection when rate limits or failures occur. It has ZERO existing
 * test coverage.
 *
 * Exported items:
 *   - ModelCircuitBreaker class: tracks per-model failures with TTL-based recovery
 *   - circuitBreaker: shared singleton instance (not tested directly)
 *   - selectAvailableModels(models, breaker): filters to non-tripped models
 *   - isRateLimitError(msg): checks if an error message indicates rate limiting
 *
 * Test scenarios (no Docker required):
 *   1. ModelCircuitBreaker.isAvailable(): true for unknown model
 *   2. ModelCircuitBreaker.recordFailure(): marks model as unavailable
 *   3. ModelCircuitBreaker.isAvailable(): false after recordFailure
 *   4. ModelCircuitBreaker.recordSuccess(): clears the failure
 *   5. ModelCircuitBreaker: auto-recovery after cooldown expires
 *   6. ModelCircuitBreaker: different provider:model keys are independent
 *   7. selectAvailableModels(): returns all models when none are tripped
 *   8. selectAvailableModels(): filters out tripped models
 *   9. selectAvailableModels(): falls back to full list when all models tripped
 *  10. isRateLimitError(): true for 'rate_limit' substring
 *  11. isRateLimitError(): true for '429' substring
 *  12. isRateLimitError(): true for '529' substring
 *  13. isRateLimitError(): true for 'overloaded' substring
 *  14. isRateLimitError(): false for unrelated error messages
 *
 * Covers:
 *   - agents/model-fallback.ts: ModelCircuitBreaker all methods
 *   - agents/model-fallback.ts: selectAvailableModels() all branches
 *   - agents/model-fallback.ts: isRateLimitError() all cases
 */

import { describe, it, expect } from "vitest";

const { ModelCircuitBreaker, selectAvailableModels, isRateLimitError } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/agents/model-fallback.js"
);

function makeModel(provider: string, model: string) {
  return { provider, model, authType: "api_key" as const };
}

describe("integration: ModelCircuitBreaker (no Docker required)", () => {

  it("isAvailable() returns true for unknown model (not tripped)", () => {
    const breaker = new ModelCircuitBreaker(60_000);
    expect(breaker.isAvailable("anthropic", "claude-3")).toBe(true);
  });

  it("recordFailure() marks model as unavailable", () => {
    const breaker = new ModelCircuitBreaker(60_000);
    breaker.recordFailure("openai", "gpt-4");
    expect(breaker.isAvailable("openai", "gpt-4")).toBe(false);
  });

  it("recordSuccess() clears a failure", () => {
    const breaker = new ModelCircuitBreaker(60_000);
    breaker.recordFailure("openai", "gpt-4");
    expect(breaker.isAvailable("openai", "gpt-4")).toBe(false);
    breaker.recordSuccess("openai", "gpt-4");
    expect(breaker.isAvailable("openai", "gpt-4")).toBe(true);
  });

  it("auto-recovers after cooldown expires", async () => {
    // Use 10ms cooldown for testing
    const breaker = new ModelCircuitBreaker(10);
    breaker.recordFailure("groq", "llama-3");
    expect(breaker.isAvailable("groq", "llama-3")).toBe(false);
    // Wait for cooldown
    await new Promise<void>(r => setTimeout(r, 20));
    expect(breaker.isAvailable("groq", "llama-3")).toBe(true);
  }, 5000);

  it("different provider:model keys are independent", () => {
    const breaker = new ModelCircuitBreaker(60_000);
    breaker.recordFailure("openai", "gpt-4");
    // Different provider is not affected
    expect(breaker.isAvailable("anthropic", "gpt-4")).toBe(true);
    // Different model is not affected
    expect(breaker.isAvailable("openai", "gpt-3.5")).toBe(true);
  });

  it("recordSuccess() for unknown model does not throw", () => {
    const breaker = new ModelCircuitBreaker(60_000);
    expect(() => breaker.recordSuccess("unknown", "model")).not.toThrow();
  });
});

describe("integration: selectAvailableModels (no Docker required)", () => {

  it("returns all models when none are tripped", () => {
    const breaker = new ModelCircuitBreaker(60_000);
    const models = [
      makeModel("anthropic", "claude-3"),
      makeModel("openai", "gpt-4"),
    ];
    const result = selectAvailableModels(models, breaker);
    expect(result.length).toBe(2);
  });

  it("filters out tripped models", () => {
    const breaker = new ModelCircuitBreaker(60_000);
    breaker.recordFailure("openai", "gpt-4");
    const models = [
      makeModel("anthropic", "claude-3"),
      makeModel("openai", "gpt-4"),
    ];
    const result = selectAvailableModels(models, breaker);
    expect(result.length).toBe(1);
    expect(result[0].provider).toBe("anthropic");
  });

  it("falls back to full list when all models are tripped", () => {
    const breaker = new ModelCircuitBreaker(60_000);
    const models = [
      makeModel("openai", "gpt-4"),
      makeModel("groq", "llama-3"),
    ];
    breaker.recordFailure("openai", "gpt-4");
    breaker.recordFailure("groq", "llama-3");
    // When all tripped, returns full list (so at least one can be tried)
    const result = selectAvailableModels(models, breaker);
    expect(result.length).toBe(2);
  });

  it("returns empty array for empty models list", () => {
    const breaker = new ModelCircuitBreaker(60_000);
    const result = selectAvailableModels([], breaker);
    expect(result).toEqual([]);
  });

  it("returns single model list unchanged when not tripped", () => {
    const breaker = new ModelCircuitBreaker(60_000);
    const models = [makeModel("anthropic", "claude-sonnet-4")];
    const result = selectAvailableModels(models, breaker);
    expect(result.length).toBe(1);
    expect(result[0].model).toBe("claude-sonnet-4");
  });
});

describe("integration: isRateLimitError (no Docker required)", () => {

  it("returns true when message contains 'rate_limit'", () => {
    expect(isRateLimitError("Error: rate_limit exceeded")).toBe(true);
  });

  it("returns true when message contains '429'", () => {
    expect(isRateLimitError("HTTP 429 Too Many Requests")).toBe(true);
  });

  it("returns true when message contains '529'", () => {
    expect(isRateLimitError("Server error: 529 overloaded")).toBe(true);
  });

  it("returns true when message contains 'overloaded'", () => {
    expect(isRateLimitError("Model is overloaded, please retry")).toBe(true);
  });

  it("returns false for unrelated error messages", () => {
    expect(isRateLimitError("Connection refused")).toBe(false);
    expect(isRateLimitError("Invalid API key")).toBe(false);
    expect(isRateLimitError("Internal server error")).toBe(false);
    expect(isRateLimitError("")).toBe(false);
  });

  it("case-sensitive check (rate_limit is lowercase)", () => {
    // The function checks lowercase patterns exactly
    expect(isRateLimitError("RATE_LIMIT exceeded")).toBe(false); // uppercase doesn't match
    expect(isRateLimitError("rate_limit exceeded")).toBe(true); // lowercase matches
  });
});
