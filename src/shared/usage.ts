export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;       // total cost in USD
  turnCount: number;  // number of assistant messages (LLM turns)
}

/**
 * Convert pi-ai SDK SessionStats to our TokenUsage format
 */
export function sessionStatsToUsage(stats: any): TokenUsage {
  return {
    inputTokens: stats.usage?.input ?? 0,
    outputTokens: stats.usage?.output ?? 0,
    cacheReadTokens: stats.usage?.cacheRead ?? 0,
    cacheWriteTokens: stats.usage?.cacheWrite ?? 0,
    totalTokens: stats.usage?.totalTokens ?? 0,
    cost: stats.usage?.cost?.total ?? 0,
    turnCount: stats.turnCount ?? 0,
  };
}

/**
 * Add two TokenUsage objects together
 */
export function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    cost: a.cost + b.cost,
    turnCount: a.turnCount + b.turnCount,
  };
}

/**
 * Create a zero TokenUsage object
 */
export function zeroTokenUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    cost: 0,
    turnCount: 0,
  };
}