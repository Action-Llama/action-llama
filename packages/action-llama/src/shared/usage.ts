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
  // Handle null/undefined stats
  if (!stats) {
    return zeroTokenUsage();
  }

  // Try multiple possible paths for input tokens
  const inputTokens =
    stats.tokens?.input ??             // pi-coding-agent SessionStats format
    stats.usage?.input ??              // Legacy format
    stats.inputTokens ??              // Direct property
    stats.metrics?.input_tokens ??    // Metrics object
    stats.usageMetrics?.inputTokens ?? // Usage metrics object
    stats.anthropic?.usage?.input_tokens ?? // Provider-specific format
    0;

  // Try multiple possible paths for output tokens
  const outputTokens =
    stats.tokens?.output ??            // pi-coding-agent SessionStats format
    stats.usage?.output ??             // Legacy format
    stats.outputTokens ??             // Direct property
    stats.metrics?.output_tokens ??   // Metrics object
    stats.usageMetrics?.outputTokens ?? // Usage metrics object
    stats.anthropic?.usage?.output_tokens ?? // Provider-specific format
    0;

  // Try multiple possible paths for cache read tokens
  const cacheReadTokens =
    stats.tokens?.cacheRead ??         // pi-coding-agent SessionStats format
    stats.usage?.cacheRead ??          // Legacy format
    stats.cacheReadTokens ??          // Direct property
    stats.metrics?.cache_read_tokens ?? // Metrics object
    stats.usageMetrics?.cacheReadTokens ?? // Usage metrics object
    stats.anthropic?.usage?.cache_read_input_tokens ?? // Anthropic cache format
    0;

  // Try multiple possible paths for cache write tokens
  const cacheWriteTokens =
    stats.tokens?.cacheWrite ??        // pi-coding-agent SessionStats format
    stats.usage?.cacheWrite ??         // Legacy format
    stats.cacheWriteTokens ??         // Direct property
    stats.metrics?.cache_write_tokens ?? // Metrics object
    stats.usageMetrics?.cacheWriteTokens ?? // Usage metrics object
    stats.anthropic?.usage?.cache_creation_input_tokens ?? // Anthropic cache format
    0;

  // Calculate total tokens if not provided
  const totalTokens =
    stats.tokens?.total ??             // pi-coding-agent SessionStats format
    stats.usage?.totalTokens ??       // Legacy format
    stats.totalTokens ??             // Direct property
    stats.metrics?.total_tokens ??   // Metrics object
    inputTokens + outputTokens;      // Fallback calculation

  // Try multiple possible paths for cost
  const cost = 
    stats.usage?.cost?.total ??        // Current working format  
    stats.cost ??                     // Direct property
    stats.metrics?.cost ??            // Metrics object
    stats.usageMetrics?.cost ??       // Usage metrics object
    0;

  // Turn count should be consistent across providers
  const turnCount = stats.turnCount ?? 0;

  return {
    inputTokens,
    outputTokens, 
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    cost,
    turnCount,
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
