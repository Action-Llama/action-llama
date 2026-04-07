/**
 * Integration tests: webhooks/registry.ts WebhookRegistry — uncovered dispatch() branches.
 *
 * The existing webhook-registry-direct.test.ts covers most dispatch() paths but
 * misses two important error/edge branches in the dispatch() method:
 *
 *   1. parseEvent() returns null → dispatch returns { ok: true, matched: 0, skipped: 0 }
 *      (event is well-formed JSON and passes validation but the provider decides it
 *      is not a recognizable event — e.g. a ping or unhandled type).
 *
 *   2. trigger callback throws an exception → the exception is caught, skipped++,
 *      and an error is logged (the other bindings continue to run).
 *
 * Both branches were confirmed absent from existing tests by grepping for
 * "parseEvent", "trigger.*throw", and "callback.*fail" in the existing test file.
 *
 * Covers:
 *   - webhooks/registry.ts: WebhookRegistry.dispatch() — parseEvent returns null → ok:true matched:0
 *   - webhooks/registry.ts: WebhookRegistry.dispatch() — parseEvent null: matchedSource preserved in return
 *   - webhooks/registry.ts: WebhookRegistry.dispatch() — trigger throws → skipped incremented
 *   - webhooks/registry.ts: WebhookRegistry.dispatch() — trigger throws → error logged
 *   - webhooks/registry.ts: WebhookRegistry.dispatch() — trigger throws → other bindings still run
 */

import { describe, it, expect, vi } from "vitest";
import type { WebhookProvider, WebhookContext, WebhookFilter } from "@action-llama/action-llama/internals/webhook-types";

const { WebhookRegistry } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/registry.js"
);

// ── Helpers ────────────────────────────────────────────────────────────────

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };
}

/**
 * A custom provider where parseEvent returns null for bodies containing
 * `"event": "ping"` — simulating an event type the provider does not handle.
 */
function makeNullParseProvider(): WebhookProvider {
  return {
    source: "null-parse",
    validateRequest: (_headers: any, _body: any, _secrets: any) => "_unsigned",
    parseEvent: (_headers: any, body: any) => {
      if (body?.event === "ping") return null; // unrecognized event
      return { event: body.event, action: body.action, sender: "test-sender" } as WebhookContext;
    },
    matchesFilter: (_ctx: any, _filter: any) => true,
  };
}

/**
 * A custom provider whose parseEvent always succeeds (used for trigger-throws tests).
 */
function makeSimpleProvider(): WebhookProvider {
  return {
    source: "simple",
    validateRequest: (_headers: any, _body: any, _secrets: any) => "_unsigned",
    parseEvent: (_headers: any, body: any) => {
      return { event: body.event, action: body.action, sender: "sender" } as WebhookContext;
    },
    matchesFilter: (_ctx: any, _filter: any) => true,
  };
}

function makeRegistry() {
  const logger = makeLogger();
  const registry = new WebhookRegistry(logger);
  return { registry, logger };
}

// ── parseEvent() returns null ─────────────────────────────────────────────

describe("WebhookRegistry.dispatch() — parseEvent returns null", { timeout: 10_000 }, () => {
  it("returns ok:true with matched:0 and skipped:0 when parseEvent returns null", () => {
    const { registry } = makeRegistry();
    registry.registerProvider(makeNullParseProvider());
    const trigger = vi.fn(() => true);
    registry.addBinding({ agentName: "my-agent", type: "null-parse", trigger });

    // Send a "ping" body — the provider's parseEvent returns null for pings
    const pingBody = JSON.stringify({ event: "ping", action: "created" });
    const result = registry.dispatch("null-parse", {}, pingBody, {});

    expect(result.ok).toBe(true);
    expect(result.matched).toBe(0);
    expect(result.skipped).toBe(0);
    // trigger should NOT have been called
    expect(trigger).not.toHaveBeenCalled();
  });

  it("preserves matchedSource in return value when parseEvent returns null", () => {
    const { registry } = makeRegistry();
    registry.registerProvider(makeNullParseProvider());

    const pingBody = JSON.stringify({ event: "ping" });
    const result = registry.dispatch("null-parse", {}, pingBody, {});

    // matchedSource from validateRequest should still be in the result
    expect(result.matchedSource).toBe("_unsigned");
  });

  it("logs a warning when parseEvent returns null", () => {
    const { registry, logger } = makeRegistry();
    registry.registerProvider(makeNullParseProvider());

    const pingBody = JSON.stringify({ event: "ping" });
    registry.dispatch("null-parse", {}, pingBody, {});

    // The registry should log a warning about the unrecognized event
    expect(logger.warn).toHaveBeenCalled();
    const warnCall = logger.warn.mock.calls.find(
      (args: any[]) => String(args[args.length - 1]).includes("parsed") || String(args[args.length - 1]).includes("null"),
    );
    expect(warnCall).toBeDefined();
  });

  it("non-ping event IS dispatched (confirming only null events are dropped)", () => {
    const { registry } = makeRegistry();
    registry.registerProvider(makeNullParseProvider());
    const trigger = vi.fn(() => true);
    registry.addBinding({ agentName: "my-agent", type: "null-parse", trigger });

    const normalBody = JSON.stringify({ event: "push", action: "created" });
    const result = registry.dispatch("null-parse", {}, normalBody, {});

    expect(result.ok).toBe(true);
    expect(result.matched).toBe(1);
    expect(trigger).toHaveBeenCalledTimes(1);
  });
});

// ── trigger callback throws ────────────────────────────────────────────────

describe("WebhookRegistry.dispatch() — trigger callback throws", { timeout: 10_000 }, () => {
  it("increments skipped when trigger callback throws", () => {
    const { registry } = makeRegistry();
    registry.registerProvider(makeSimpleProvider());
    const throwingTrigger = vi.fn(() => {
      throw new Error("trigger failure");
    });
    registry.addBinding({ agentName: "bad-agent", type: "simple", trigger: throwingTrigger });

    const body = JSON.stringify({ event: "push", action: "created" });
    const result = registry.dispatch("simple", {}, body, {});

    expect(result.ok).toBe(true);
    expect(result.matched).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("logs an error when trigger callback throws", () => {
    const { registry, logger } = makeRegistry();
    registry.registerProvider(makeSimpleProvider());
    const throwingTrigger = vi.fn(() => {
      throw new Error("trigger failure");
    });
    registry.addBinding({ agentName: "bad-agent", type: "simple", trigger: throwingTrigger });

    const body = JSON.stringify({ event: "push", action: "created" });
    registry.dispatch("simple", {}, body, {});

    // Should log an error
    expect(logger.error).toHaveBeenCalled();
    const errorCall = logger.error.mock.calls[0];
    expect(JSON.stringify(errorCall)).toContain("bad-agent");
  });

  it("continues running other bindings when one trigger throws", () => {
    const { registry } = makeRegistry();
    registry.registerProvider(makeSimpleProvider());

    const throwingTrigger = vi.fn(() => {
      throw new Error("first agent failed");
    });
    const goodTrigger = vi.fn(() => true);

    registry.addBinding({ agentName: "bad-agent", type: "simple", trigger: throwingTrigger });
    registry.addBinding({ agentName: "good-agent", type: "simple", trigger: goodTrigger });

    const body = JSON.stringify({ event: "push", action: "created" });
    const result = registry.dispatch("simple", {}, body, {});

    // bad-agent threw → skipped; good-agent succeeded → matched
    expect(result.ok).toBe(true);
    expect(result.matched).toBe(1);
    expect(result.skipped).toBe(1);
    expect(goodTrigger).toHaveBeenCalledTimes(1);
  });

  it("matched+skipped+throw combined: all three outcomes in one dispatch", () => {
    const { registry } = makeRegistry();
    registry.registerProvider(makeSimpleProvider());

    const body = JSON.stringify({ event: "push", action: "created" });

    registry.addBinding({
      agentName: "success-agent",
      type: "simple",
      trigger: vi.fn(() => true),    // matched
    });
    registry.addBinding({
      agentName: "false-agent",
      type: "simple",
      trigger: vi.fn(() => false),   // skipped (returns false)
    });
    registry.addBinding({
      agentName: "throw-agent",
      type: "simple",
      trigger: vi.fn(() => { throw new Error("oops"); }), // skipped (throws)
    });

    const result = registry.dispatch("simple", {}, body, {});

    expect(result.matched).toBe(1);
    expect(result.skipped).toBe(2); // false-agent + throw-agent both increment skipped
    expect(result.ok).toBe(true);
  });
});
