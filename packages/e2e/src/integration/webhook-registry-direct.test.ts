/**
 * Integration tests: webhooks/registry.ts WebhookRegistry direct tests — no Docker required.
 *
 * Previously untested methods on WebhookRegistry:
 *
 *   removeBindingsForAgent(agentName): removes all bindings for agent, returns count
 *   dryRunDispatch(source, headers, rawBody, secrets): dry-run check with detailed results
 *   dispatch() — form-encoded body path (content-type: x-www-form-urlencoded)
 *   dispatch() — form-encoded missing payload field → ok:false
 *   dispatch() — dispatch with binding trigger returning false → skipped count
 *   dispatch() — dispatch with receiptId attaches receiptId to context
 *
 * Uses TestWebhookProvider (source="test") which:
 *   - validateRequest always returns "_unsigned"
 *   - parseEvent returns context with event/action/repo from body
 *   - matchesFilter checks events/actions arrays
 *
 * Covers:
 *   - webhooks/registry.ts: WebhookRegistry.removeBindingsForAgent() — returns count, removes entries
 *   - webhooks/registry.ts: WebhookRegistry.removeBindingsForAgent() — 0 for unknown agent
 *   - webhooks/registry.ts: WebhookRegistry.dryRunDispatch() — unknown source returns ok:false
 *   - webhooks/registry.ts: WebhookRegistry.dryRunDispatch() — no bindings returns ok:true empty bindings
 *   - webhooks/registry.ts: WebhookRegistry.dryRunDispatch() — matching binding returns matched:true
 *   - webhooks/registry.ts: WebhookRegistry.dryRunDispatch() — filter mismatch returns matched:false
 *   - webhooks/registry.ts: WebhookRegistry.dryRunDispatch() — invalid JSON body parseError
 *   - webhooks/registry.ts: WebhookRegistry.dispatch() — form-urlencoded valid payload
 *   - webhooks/registry.ts: WebhookRegistry.dispatch() — form-urlencoded missing payload field
 *   - webhooks/registry.ts: WebhookRegistry.dispatch() — trigger callback returning false increments skipped
 *   - webhooks/registry.ts: WebhookRegistry.dispatch() — receiptId attached to context
 */

import { describe, it, expect, vi } from "vitest";
import type { WebhookProvider, WebhookContext, WebhookFilter } from "@action-llama/action-llama/internals/webhook-types";

const { WebhookRegistry } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/registry.js"
);

const { TestWebhookProvider } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/providers/test.js"
);

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };
}

function makeRegistry() {
  const logger = makeLogger();
  const registry = new WebhookRegistry(logger);
  registry.registerProvider(new TestWebhookProvider());
  return { registry, logger };
}

// A minimal valid webhook body for the test provider
const VALID_BODY = JSON.stringify({ event: "test.event", action: "created", repo: "my-repo", labels: [] });

// ── removeBindingsForAgent ────────────────────────────────────────────────────

describe("WebhookRegistry.removeBindingsForAgent()", { timeout: 10_000 }, () => {
  it("returns 0 when no bindings exist for the agent", () => {
    const { registry } = makeRegistry();
    const count = registry.removeBindingsForAgent("nonexistent-agent");
    expect(count).toBe(0);
  });

  it("returns the count of removed bindings", () => {
    const { registry } = makeRegistry();
    const trigger = vi.fn(() => true);
    registry.addBinding({ agentName: "my-agent", type: "test", trigger });
    registry.addBinding({ agentName: "my-agent", type: "test", trigger });
    registry.addBinding({ agentName: "other-agent", type: "test", trigger });

    const count = registry.removeBindingsForAgent("my-agent");
    expect(count).toBe(2);
  });

  it("only removes bindings for the specified agent", () => {
    const { registry } = makeRegistry();
    const trigger = vi.fn(() => true);
    registry.addBinding({ agentName: "agent-a", type: "test", trigger });
    registry.addBinding({ agentName: "agent-b", type: "test", trigger });

    registry.removeBindingsForAgent("agent-a");

    // agent-b binding still works
    const result = registry.dispatch("test", {}, VALID_BODY, {});
    expect(result.ok).toBe(true);
    expect(result.matched).toBe(1); // agent-b was triggered
  });

  it("removes all bindings for agent, none triggered after removal", () => {
    const { registry } = makeRegistry();
    const trigger = vi.fn(() => true);
    registry.addBinding({ agentName: "my-agent", type: "test", trigger });
    registry.removeBindingsForAgent("my-agent");

    const result = registry.dispatch("test", {}, VALID_BODY, {});
    expect(result.ok).toBe(true);
    expect(result.matched).toBe(0);
    expect(trigger).not.toHaveBeenCalled();
  });
});

// ── dryRunDispatch ─────────────────────────────────────────────────────────────

describe("WebhookRegistry.dryRunDispatch()", { timeout: 10_000 }, () => {
  it("returns ok:false for unknown source", () => {
    const { registry } = makeRegistry();
    const result = registry.dryRunDispatch("unknown-source", {}, VALID_BODY);
    expect(result.ok).toBe(false);
    expect(result.context).toBeNull();
    expect(result.parseError).toMatch(/unknown source/);
  });

  it("returns ok:true with empty bindings when no bindings registered", () => {
    const { registry } = makeRegistry();
    const result = registry.dryRunDispatch("test", {}, VALID_BODY);
    expect(result.ok).toBe(true);
    expect(result.context).not.toBeNull();
    expect(result.bindings).toEqual([]);
  });

  it("returns matching binding when filter matches", () => {
    const { registry } = makeRegistry();
    const trigger = vi.fn(() => true);
    registry.addBinding({
      agentName: "my-agent",
      type: "test",
      trigger,
      filter: { events: ["test.event"] },
    });

    const result = registry.dryRunDispatch("test", {}, VALID_BODY);
    expect(result.ok).toBe(true);
    expect(result.bindings).toHaveLength(1);
    expect(result.bindings[0].agentName).toBe("my-agent");
    expect(result.bindings[0].matched).toBe(true);
  });

  it("returns matched:false when filter doesn't match", () => {
    const { registry } = makeRegistry();
    const trigger = vi.fn(() => true);
    registry.addBinding({
      agentName: "my-agent",
      type: "test",
      trigger,
      filter: { events: ["different.event"] }, // won't match "test.event"
    });

    const result = registry.dryRunDispatch("test", {}, VALID_BODY);
    expect(result.ok).toBe(true);
    expect(result.bindings).toHaveLength(1);
    expect(result.bindings[0].matched).toBe(false);
  });

  it("returns ok:false with parseError for invalid JSON body", () => {
    const { registry } = makeRegistry();
    const result = registry.dryRunDispatch("test", {}, "not-valid-json");
    expect(result.ok).toBe(false);
    expect(result.parseError).toMatch(/invalid JSON/i);
  });

  it("returns binding type mismatch reason when binding is for different source", () => {
    const { registry } = makeRegistry();
    const trigger = vi.fn(() => true);
    // Add a binding for a different type
    registry.addBinding({ agentName: "agent", type: "github", trigger });

    const result = registry.dryRunDispatch("test", {}, VALID_BODY);
    expect(result.ok).toBe(true);
    expect(result.bindings[0].matched).toBe(false);
    expect(result.bindings[0].reasons[0]).toMatch(/type mismatch/i);
  });
});

// ── dispatch() form-urlencoded ─────────────────────────────────────────────

describe("WebhookRegistry.dispatch() form-urlencoded body", { timeout: 10_000 }, () => {
  it("decodes form-urlencoded body with valid payload field", () => {
    const { registry } = makeRegistry();
    const trigger = vi.fn(() => true);
    registry.addBinding({ agentName: "my-agent", type: "test", trigger });

    const formBody = `payload=${encodeURIComponent(VALID_BODY)}`;
    const result = registry.dispatch(
      "test",
      { "content-type": "application/x-www-form-urlencoded" },
      formBody,
      {},
    );
    expect(result.ok).toBe(true);
    expect(result.matched).toBe(1);
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it("returns ok:false for form-urlencoded with missing payload field", () => {
    const { registry } = makeRegistry();
    const trigger = vi.fn(() => true);
    registry.addBinding({ agentName: "my-agent", type: "test", trigger });

    const formBody = "other_field=value"; // no 'payload' field
    const result = registry.dispatch(
      "test",
      { "content-type": "application/x-www-form-urlencoded" },
      formBody,
      {},
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("missing payload in form body");
    expect(trigger).not.toHaveBeenCalled();
  });
});

// ── dispatch() skipped count ──────────────────────────────────────────────

describe("WebhookRegistry.dispatch() skipped count", { timeout: 10_000 }, () => {
  it("increments skipped when trigger callback returns false", () => {
    const { registry } = makeRegistry();
    const trigger = vi.fn(() => false); // returns false → skipped
    registry.addBinding({ agentName: "my-agent", type: "test", trigger });

    const result = registry.dispatch("test", {}, VALID_BODY, {});
    expect(result.ok).toBe(true);
    expect(result.matched).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("matched + skipped together when multiple bindings with different results", () => {
    const { registry } = makeRegistry();
    registry.addBinding({ agentName: "agent-a", type: "test", trigger: vi.fn(() => true) });
    registry.addBinding({ agentName: "agent-b", type: "test", trigger: vi.fn(() => false) });
    registry.addBinding({ agentName: "agent-c", type: "test", trigger: vi.fn(() => true) });

    const result = registry.dispatch("test", {}, VALID_BODY, {});
    expect(result.ok).toBe(true);
    expect(result.matched).toBe(2);
    expect(result.skipped).toBe(1);
  });
});

// ── dispatch() receiptId ──────────────────────────────────────────────────

describe("WebhookRegistry.dispatch() receiptId attachment", { timeout: 10_000 }, () => {
  it("attaches receiptId to context when provided", () => {
    const { registry } = makeRegistry();
    let capturedContext: any = null;
    registry.addBinding({
      agentName: "my-agent",
      type: "test",
      trigger: (ctx) => { capturedContext = ctx; return true; },
    });

    registry.dispatch("test", {}, VALID_BODY, {}, "test-receipt-id-123");
    expect(capturedContext).not.toBeNull();
    expect(capturedContext.receiptId).toBe("test-receipt-id-123");
  });

  it("context.receiptId is undefined when no receiptId provided", () => {
    const { registry } = makeRegistry();
    let capturedContext: any = null;
    registry.addBinding({
      agentName: "my-agent",
      type: "test",
      trigger: (ctx) => { capturedContext = ctx; return true; },
    });

    registry.dispatch("test", {}, VALID_BODY, {});
    expect(capturedContext).not.toBeNull();
    expect(capturedContext.receiptId).toBeUndefined();
  });
});
