import { describe, it, expect } from "vitest";
import { sessionStatsToUsage, zeroTokenUsage, addTokenUsage } from "../../src/shared/usage.js";

describe("sessionStatsToUsage", () => {
  it("handles null/undefined stats", () => {
    expect(sessionStatsToUsage(null)).toEqual(zeroTokenUsage());
    expect(sessionStatsToUsage(undefined)).toEqual(zeroTokenUsage());
  });

  it("handles empty stats object", () => {
    expect(sessionStatsToUsage({})).toEqual(zeroTokenUsage());
  });

  it("converts pi-coding-agent SessionStats format (tokens + cost)", () => {
    const stats = {
      tokens: {
        input: 100,
        output: 50,
        cacheRead: 25,
        cacheWrite: 10,
        total: 185,
      },
      cost: 0.002,
      turnCount: 3,
    };

    expect(sessionStatsToUsage(stats)).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 25,
      cacheWriteTokens: 10,
      totalTokens: 185,
      cost: 0.002,
      turnCount: 3,
    });
  });

  it("converts legacy usage format", () => {
    const stats = {
      usage: {
        input: 100,
        output: 50,
        cacheRead: 25,
        cacheWrite: 10,
        totalTokens: 150,
        cost: { total: 0.002 }
      },
      turnCount: 3
    };

    expect(sessionStatsToUsage(stats)).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 25,
      cacheWriteTokens: 10,
      totalTokens: 150,
      cost: 0.002,
      turnCount: 3
    });
  });

  it("converts Anthropic direct properties format", () => {
    const stats = {
      inputTokens: 200,
      outputTokens: 75,
      cacheReadTokens: 30,
      cacheWriteTokens: 15,
      totalTokens: 275,
      cost: 0.005,
      turnCount: 2
    };

    expect(sessionStatsToUsage(stats)).toEqual({
      inputTokens: 200,
      outputTokens: 75,
      cacheReadTokens: 30,
      cacheWriteTokens: 15,
      totalTokens: 275,
      cost: 0.005,
      turnCount: 2
    });
  });

  it("converts Anthropic metrics object format", () => {
    const stats = {
      metrics: {
        input_tokens: 150,
        output_tokens: 60,
        cache_read_tokens: 20,
        cache_write_tokens: 5,
        total_tokens: 210,
        cost: 0.003
      },
      turnCount: 4
    };

    expect(sessionStatsToUsage(stats)).toEqual({
      inputTokens: 150,
      outputTokens: 60,
      cacheReadTokens: 20,
      cacheWriteTokens: 5,
      totalTokens: 210,
      cost: 0.003,
      turnCount: 4
    });
  });

  it("converts Anthropic usage metrics format", () => {
    const stats = {
      usageMetrics: {
        inputTokens: 120,
        outputTokens: 45,
        cacheReadTokens: 15,
        cacheWriteTokens: 8,
        cost: 0.0025
      },
      turnCount: 1
    };

    expect(sessionStatsToUsage(stats)).toEqual({
      inputTokens: 120,
      outputTokens: 45,
      cacheReadTokens: 15,
      cacheWriteTokens: 8,
      totalTokens: 165, // calculated fallback
      cost: 0.0025,
      turnCount: 1
    });
  });

  it("converts Anthropic provider-specific format", () => {
    const stats = {
      anthropic: {
        usage: {
          input_tokens: 180,
          output_tokens: 70,
          cache_read_input_tokens: 35,
          cache_creation_input_tokens: 12
        }
      },
      turnCount: 2
    };

    expect(sessionStatsToUsage(stats)).toEqual({
      inputTokens: 180,
      outputTokens: 70,
      cacheReadTokens: 35,
      cacheWriteTokens: 12,
      totalTokens: 250, // calculated fallback
      cost: 0, // no cost provided
      turnCount: 2
    });
  });

  it("handles mixed format with fallback calculation for total tokens", () => {
    const stats = {
      inputTokens: 90,
      outputTokens: 40,
      // No totalTokens provided
      turnCount: 1
    };

    expect(sessionStatsToUsage(stats)).toEqual({
      inputTokens: 90,
      outputTokens: 40,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 130, // calculated: 90 + 40
      cost: 0,
      turnCount: 1
    });
  });

  it("handles missing properties gracefully", () => {
    const stats = {
      usage: {
        input: 50
        // missing output, cache properties
      },
      // missing turnCount
    };

    expect(sessionStatsToUsage(stats)).toEqual({
      inputTokens: 50,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 50, // calculated fallback
      cost: 0,
      turnCount: 0
    });
  });

  it("prioritizes first available format (fallback order)", () => {
    const stats = {
      // Multiple formats present - should use the first available in order
      tokens: { input: 50, output: 25 }, // Highest priority
      usage: { input: 100, output: 50 }, // Second priority
      inputTokens: 200, // Third priority
      metrics: { input_tokens: 300, output_tokens: 150 }, // Fourth priority
      turnCount: 3
    };

    expect(sessionStatsToUsage(stats)).toEqual({
      inputTokens: 50, // From tokens.input (first priority)
      outputTokens: 25, // From tokens.output (first priority)
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 75, // calculated fallback
      cost: 0,
      turnCount: 3
    });
  });

  it("handles zero values vs missing values correctly", () => {
    const stats = {
      inputTokens: 0, // Explicit zero should be preserved
      outputTokens: 100,
      cost: 0, // Explicit zero cost should be preserved
      turnCount: 1
    };

    expect(sessionStatsToUsage(stats)).toEqual({
      inputTokens: 0, // Should preserve explicit zero
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 100,
      cost: 0, // Should preserve explicit zero
      turnCount: 1
    });
  });
});

describe("addTokenUsage", () => {
  it("adds two TokenUsage objects correctly", () => {
    const usage1 = {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 25,
      cacheWriteTokens: 10,
      totalTokens: 150,
      cost: 0.002,
      turnCount: 3
    };

    const usage2 = {
      inputTokens: 200,
      outputTokens: 75,
      cacheReadTokens: 30,
      cacheWriteTokens: 15,
      totalTokens: 275,
      cost: 0.005,
      turnCount: 2
    };

    expect(addTokenUsage(usage1, usage2)).toEqual({
      inputTokens: 300,
      outputTokens: 125,
      cacheReadTokens: 55,
      cacheWriteTokens: 25,
      totalTokens: 425,
      cost: 0.007,
      turnCount: 5
    });
  });
});

describe("zeroTokenUsage", () => {
  it("returns a zero TokenUsage object", () => {
    expect(zeroTokenUsage()).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      cost: 0,
      turnCount: 0
    });
  });
});