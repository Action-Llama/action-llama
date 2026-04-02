/**
 * Integration tests: shared/usage.ts TokenUsage functions — no Docker required.
 *
 * The sessionStatsToUsage() function converts pi-ai SDK SessionStats (or various
 * legacy formats) to the canonical TokenUsage object. It has many fallback paths
 * for different input formats. These tests exercise each format variant.
 *
 * Functions tested:
 *   - zeroTokenUsage() — returns all-zero TokenUsage
 *   - addTokenUsage(a, b) — accumulates two TokenUsage objects
 *   - sessionStatsToUsage(stats) — converts various SDK stat formats:
 *     1. null/undefined → zeroTokenUsage
 *     2. pi-coding-agent SessionStats format (stats.tokens.*)
 *     3. Legacy format (stats.usage.*)
 *     4. Direct property format (stats.inputTokens etc.)
 *     5. Metrics object format (stats.metrics.*)
 *     6. Anthropic provider-specific format (stats.anthropic.usage.*)
 *     7. Cost from stats.usage.cost.total path
 *     8. turnCount extraction
 *
 * Covers:
 *   - shared/usage.ts: zeroTokenUsage()
 *   - shared/usage.ts: addTokenUsage()
 *   - shared/usage.ts: sessionStatsToUsage() — all fallback paths
 */

import { describe, it, expect } from "vitest";

const {
  sessionStatsToUsage,
  addTokenUsage,
  zeroTokenUsage,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/usage.js"
);

describe("integration: shared/usage.ts (no Docker required)", () => {

  describe("zeroTokenUsage", () => {
    it("returns all-zero TokenUsage", () => {
      const z = zeroTokenUsage();
      expect(z.inputTokens).toBe(0);
      expect(z.outputTokens).toBe(0);
      expect(z.cacheReadTokens).toBe(0);
      expect(z.cacheWriteTokens).toBe(0);
      expect(z.totalTokens).toBe(0);
      expect(z.cost).toBe(0);
      expect(z.turnCount).toBe(0);
    });
  });

  describe("addTokenUsage", () => {
    it("adds two TokenUsage objects together", () => {
      const a = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5, totalTokens: 150, cost: 0.01, turnCount: 2 };
      const b = { inputTokens: 200, outputTokens: 75, cacheReadTokens: 20, cacheWriteTokens: 15, totalTokens: 275, cost: 0.02, turnCount: 3 };
      const result = addTokenUsage(a, b);
      expect(result.inputTokens).toBe(300);
      expect(result.outputTokens).toBe(125);
      expect(result.cacheReadTokens).toBe(30);
      expect(result.cacheWriteTokens).toBe(20);
      expect(result.totalTokens).toBe(425);
      expect(result.cost).toBeCloseTo(0.03);
      expect(result.turnCount).toBe(5);
    });

    it("adding zero gives back the same values", () => {
      const a = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 150, cost: 0.01, turnCount: 1 };
      const z = zeroTokenUsage();
      const result = addTokenUsage(a, z);
      expect(result.inputTokens).toBe(100);
      expect(result.outputTokens).toBe(50);
      expect(result.cost).toBeCloseTo(0.01);
    });
  });

  describe("sessionStatsToUsage", () => {
    it("returns zeroTokenUsage for null input", () => {
      const result = sessionStatsToUsage(null);
      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
      expect(result.totalTokens).toBe(0);
    });

    it("returns zeroTokenUsage for undefined input", () => {
      const result = sessionStatsToUsage(undefined);
      expect(result.inputTokens).toBe(0);
    });

    it("reads pi-coding-agent SessionStats format (stats.tokens.*)", () => {
      const stats = {
        tokens: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, total: 150 },
        turnCount: 3,
      };
      const result = sessionStatsToUsage(stats);
      expect(result.inputTokens).toBe(100);
      expect(result.outputTokens).toBe(50);
      expect(result.cacheReadTokens).toBe(10);
      expect(result.cacheWriteTokens).toBe(5);
      expect(result.totalTokens).toBe(150);
      expect(result.turnCount).toBe(3);
    });

    it("reads legacy format (stats.usage.*)", () => {
      const stats = {
        usage: { input: 200, output: 75, cacheRead: 20, cacheWrite: 15, totalTokens: 275, cost: { total: 0.05 } },
        turnCount: 2,
      };
      const result = sessionStatsToUsage(stats);
      expect(result.inputTokens).toBe(200);
      expect(result.outputTokens).toBe(75);
      expect(result.cacheReadTokens).toBe(20);
      expect(result.cacheWriteTokens).toBe(15);
      expect(result.totalTokens).toBe(275);
      expect(result.cost).toBeCloseTo(0.05);
    });

    it("reads direct property format (stats.inputTokens etc.)", () => {
      const stats = {
        inputTokens: 300,
        outputTokens: 100,
        cacheReadTokens: 30,
        cacheWriteTokens: 25,
        totalTokens: 400,
        cost: 0.07,
        turnCount: 4,
      };
      const result = sessionStatsToUsage(stats);
      expect(result.inputTokens).toBe(300);
      expect(result.outputTokens).toBe(100);
      expect(result.cacheReadTokens).toBe(30);
      expect(result.cacheWriteTokens).toBe(25);
      expect(result.totalTokens).toBe(400);
      expect(result.cost).toBeCloseTo(0.07);
      expect(result.turnCount).toBe(4);
    });

    it("reads metrics object format (stats.metrics.*)", () => {
      const stats = {
        metrics: {
          input_tokens: 400,
          output_tokens: 150,
          cache_read_tokens: 40,
          cache_write_tokens: 35,
          total_tokens: 550,
          cost: 0.09,
        },
      };
      const result = sessionStatsToUsage(stats);
      expect(result.inputTokens).toBe(400);
      expect(result.outputTokens).toBe(150);
      expect(result.cacheReadTokens).toBe(40);
      expect(result.cacheWriteTokens).toBe(35);
      expect(result.totalTokens).toBe(550);
      expect(result.cost).toBeCloseTo(0.09);
    });

    it("reads Anthropic provider-specific format (stats.anthropic.usage.*)", () => {
      const stats = {
        anthropic: {
          usage: {
            input_tokens: 500,
            output_tokens: 200,
            cache_read_input_tokens: 50,
            cache_creation_input_tokens: 45,
          },
        },
      };
      const result = sessionStatsToUsage(stats);
      expect(result.inputTokens).toBe(500);
      expect(result.outputTokens).toBe(200);
      expect(result.cacheReadTokens).toBe(50);
      expect(result.cacheWriteTokens).toBe(45);
      // totalTokens falls back to inputTokens + outputTokens when not provided
      expect(result.totalTokens).toBe(700);
    });

    it("falls back to inputTokens+outputTokens when totalTokens not provided", () => {
      const stats = {
        inputTokens: 100,
        outputTokens: 50,
      };
      const result = sessionStatsToUsage(stats);
      // No total provided — falls back to input + output
      expect(result.totalTokens).toBe(150);
    });

    it("returns 0 turnCount when not provided", () => {
      const stats = { inputTokens: 100, outputTokens: 50 };
      const result = sessionStatsToUsage(stats);
      expect(result.turnCount).toBe(0);
    });
  });
});
