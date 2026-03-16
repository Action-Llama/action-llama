import type { PreflightStep, PreflightContext } from "./schema.js";
import { resolvePreflightProvider } from "./registry.js";

/**
 * Run all preflight steps sequentially. If a required step fails, throws.
 * Optional steps log a warning and continue.
 */
export async function runPreflight(
  steps: PreflightStep[],
  ctx: PreflightContext,
): Promise<void> {
  ctx.logger("info", "preflight starting", { stepCount: steps.length });

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const required = step.required !== false; // default true
    const label = `[${i + 1}/${steps.length}] ${step.provider}`;

    try {
      const provider = resolvePreflightProvider(step.provider);
      await provider.run(step.params, ctx);
      ctx.logger("info", `preflight step ${label} done`);
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (required) {
        ctx.logger("error", `preflight step ${label} failed (required)`, { error: msg });
        throw new Error(`Required preflight step "${step.provider}" failed: ${msg}`);
      }
      ctx.logger("warn", `preflight step ${label} failed (optional, continuing)`, { error: msg });
    }
  }

  ctx.logger("info", "preflight complete");
}
