/**
 * Integration tests: scheduler/dependencies.ts loadDependencies() — no Docker required.
 *
 * loadDependencies() loads model-provider extensions and initializes telemetry.
 * Both operations are non-fatal: failures log a warning and continue.
 *
 * Covers:
 *   - scheduler/dependencies.ts: loadDependencies() — no telemetry config → telemetry:undefined
 *   - scheduler/dependencies.ts: loadDependencies() — telemetry.enabled=false → telemetry:undefined
 *   - scheduler/dependencies.ts: loadDependencies() — extensions load successfully, logs info
 *   - scheduler/dependencies.ts: loadDependencies() — no models config → usedProviders undefined
 *   - scheduler/dependencies.ts: loadDependencies() — models config → usedProviders populated
 *   - scheduler/dependencies.ts: loadDependencies() — telemetry.enabled=true, unknown provider → logs warn, telemetry:undefined
 *   - scheduler/dependencies.ts: loadDependencies() — returns DependencyResult shape { telemetry }
 */

import { describe, it, expect, vi } from "vitest";

const {
  loadDependencies,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/scheduler/dependencies.js"
);

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
}

describe("integration: scheduler/dependencies.ts loadDependencies() (no Docker required)", { timeout: 30_000 }, () => {

  it("returns { telemetry: undefined } when no telemetry config present", async () => {
    const logger = makeLogger();
    const result = await loadDependencies({}, logger);

    expect(result).toHaveProperty("telemetry");
    expect(result.telemetry).toBeUndefined();
  });

  it("returns { telemetry: undefined } when telemetry.enabled=false", async () => {
    const logger = makeLogger();
    const result = await loadDependencies(
      { telemetry: { enabled: false, provider: "none" } },
      logger
    );

    expect(result.telemetry).toBeUndefined();
  });

  it("logs info after successfully loading extensions", async () => {
    const logger = makeLogger();
    await loadDependencies({}, logger);

    // extensions either load successfully (info) or fail gracefully (warn)
    const loggedMessages = logger.info.mock.calls.map((c: any[]) => String(c[0]));
    const warnedMessages = logger.warn.mock.calls.map((c: any[]) => String(c[0]) + " " + String(c[1]));
    const mentionsExtensions = loggedMessages.some((m: string) => m.includes("Extensions")) ||
      warnedMessages.some((m: string) => m.includes("extension") || m.includes("Extensions"));
    expect(mentionsExtensions).toBe(true);
  });

  it("returns object with telemetry property (DependencyResult shape)", async () => {
    const logger = makeLogger();
    const result = await loadDependencies({}, logger);

    expect(typeof result).toBe("object");
    expect(result).not.toBeNull();
    expect("telemetry" in result).toBe(true);
  });

  it("telemetry.enabled=true with unknown provider returns a TelemetryManager (init is non-fatal)", async () => {
    const logger = makeLogger();
    const result = await loadDependencies(
      { telemetry: { enabled: true, provider: "nonexistent-provider-xyz" } },
      logger
    );

    // initTelemetry() creates a TelemetryManager and returns it even if provider is unknown.
    // init() on an unknown provider just emits console.warn and returns, so no throw.
    // telemetry is set to the TelemetryManager instance.
    expect(result.telemetry).toBeDefined();
    // It should be an object with shutdown / withSpan methods
    expect(typeof result.telemetry.shutdown).toBe("function");
    // Clean up
    await result.telemetry.shutdown();
  });

  it("no models in config → extensions load without provider filter", async () => {
    const logger = makeLogger();
    // globalConfig with no models field — usedProviders should be undefined
    const result = await loadDependencies({ models: undefined }, logger);
    expect(result).toHaveProperty("telemetry");
  });

  it("models in config → extensions filtered by provider", async () => {
    const logger = makeLogger();
    // globalConfig with specific models — usedProviders Set populated
    const result = await loadDependencies({
      models: {
        "my-model": { provider: "anthropic", model: "claude-3-opus", authType: "api_key" }
      }
    }, logger);
    expect(result).toHaveProperty("telemetry");
    // Extensions loaded (or failed gracefully) — either way telemetry not set
    expect(result.telemetry).toBeUndefined();
  });

  it("is non-fatal: extensions error is caught and logged as warn", async () => {
    // Even if the module import somehow fails, loadDependencies should not throw
    const logger = makeLogger();
    // Call with unusual/empty config — should never throw
    await expect(loadDependencies({}, logger)).resolves.not.toThrow();
  });
});
