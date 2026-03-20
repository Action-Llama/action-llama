import type { ModelConfig } from "../shared/config.js";

export class ModelCircuitBreaker {
  private circuits = new Map<string, { lastFailure: number }>();
  constructor(private cooldownMs = 60_000) {}

  isAvailable(provider: string, model: string): boolean {
    const state = this.circuits.get(`${provider}:${model}`);
    if (!state) return true;
    if (Date.now() - state.lastFailure > this.cooldownMs) {
      this.circuits.delete(`${provider}:${model}`);
      return true;
    }
    return false;
  }

  recordFailure(provider: string, model: string): void {
    this.circuits.set(`${provider}:${model}`, { lastFailure: Date.now() });
  }

  recordSuccess(provider: string, model: string): void {
    this.circuits.delete(`${provider}:${model}`);
  }
}

/** Shared circuit breaker instance for the scheduler process. */
export const circuitBreaker = new ModelCircuitBreaker();

/**
 * Filter models to those not currently tripped. Falls back to the full list
 * if every model is tripped (circuits may have expired by the time we try).
 */
export function selectAvailableModels(
  models: ModelConfig[],
  breaker: ModelCircuitBreaker,
): ModelConfig[] {
  const available = models.filter((m) => breaker.isAvailable(m.provider, m.model));
  return available.length > 0 ? available : models;
}

export function isRateLimitError(msg: string): boolean {
  return (
    msg.includes("rate_limit") ||
    msg.includes("429") ||
    msg.includes("529") ||
    msg.includes("overloaded")
  );
}
