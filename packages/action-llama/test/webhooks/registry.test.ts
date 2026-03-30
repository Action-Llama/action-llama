import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebhookRegistry } from "../../src/webhooks/registry.js";
import type { WebhookProvider, WebhookContext, WebhookFilter, GitHubWebhookFilter } from "../../src/webhooks/types.js";

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function makeProvider(opts?: Partial<WebhookProvider>): WebhookProvider {
  return {
    source: "github",
    validateRequest: () => "MyOrg",
    parseEvent: () => ({
      source: "github",
      event: "issues",
      action: "labeled",
      repo: "acme/app",
      sender: "user1",
      timestamp: new Date().toISOString(),
      number: 1,
      title: "Test",
      labels: ["agent"],
    }),
    matchesFilter: () => true,
    ...opts,
  };
}

describe("WebhookRegistry", () => {
  let registry: WebhookRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new WebhookRegistry(mockLogger as any);
  });

  it("registers a provider", () => {
    registry.registerProvider(makeProvider());
    expect(registry.getProvider("github")).toBeDefined();
    expect(registry.getProvider("unknown")).toBeUndefined();
  });

  it("rejects dispatch for unknown source", () => {
    const result = registry.dispatch("unknown", {}, "{}", {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("unknown source: unknown");
  });

  it("rejects dispatch when signature validation fails", () => {
    registry.registerProvider(makeProvider({ validateRequest: () => null }));
    const result = registry.dispatch("github", {}, "{}", { secrets: { MyOrg: "secret" } });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("signature validation failed");
  });

  it("rejects dispatch with invalid JSON body", () => {
    registry.registerProvider(makeProvider());
    const result = registry.dispatch("github", {}, "not-json", {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("invalid JSON body");
  });

  it("returns 0 matched when event cannot be parsed", () => {
    registry.registerProvider(makeProvider({ parseEvent: () => null }));
    const result = registry.dispatch("github", {}, "{}", {});
    expect(result.ok).toBe(true);
    expect(result.matched).toBe(0);
  });

  it("dispatches to matching binding by type and source", () => {
    registry.registerProvider(makeProvider());
    const trigger = vi.fn().mockReturnValue(true);
    registry.addBinding({
      agentName: "dev",
      type: "github",
      source: "MyOrg",
      filter: { events: ["issues"] } as GitHubWebhookFilter,
      trigger,
    });

    const result = registry.dispatch("github", {}, '{"action":"labeled"}', {});
    expect(result.ok).toBe(true);
    expect(result.matched).toBe(1);
    expect(result.matchedSource).toBe("MyOrg");
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger.mock.calls[0][0].event).toBe("issues");
  });

  it("dispatches to multiple matching bindings", () => {
    registry.registerProvider(makeProvider());
    const trigger1 = vi.fn().mockReturnValue(true);
    const trigger2 = vi.fn().mockReturnValue(true);
    registry.addBinding({
      agentName: "dev",
      type: "github",
      source: "MyOrg",
      trigger: trigger1,
    });
    registry.addBinding({
      agentName: "reviewer",
      type: "github",
      source: "MyOrg",
      trigger: trigger2,
    });

    const result = registry.dispatch("github", {}, '{}', {});
    expect(result.matched).toBe(2);
    expect(trigger1).toHaveBeenCalledTimes(1);
    expect(trigger2).toHaveBeenCalledTimes(1);
  });

  it("skips bindings with non-matching source", () => {
    registry.registerProvider(makeProvider());
    const trigger = vi.fn();
    registry.addBinding({
      agentName: "dev",
      type: "github",
      source: "OtherOrg",
      trigger,
    });

    const result = registry.dispatch("github", {}, '{}', {});
    expect(result.matched).toBe(0);
    expect(trigger).not.toHaveBeenCalled();
  });

  it("matches binding with no source (triggers on any org)", () => {
    registry.registerProvider(makeProvider());
    const trigger = vi.fn().mockReturnValue(true);
    registry.addBinding({
      agentName: "dev",
      type: "github",
      // no source — matches any validated request
      trigger,
    });

    const result = registry.dispatch("github", {}, '{}', {});
    expect(result.matched).toBe(1);
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it("skips bindings that don't match filter", () => {
    registry.registerProvider(makeProvider({ matchesFilter: () => false }));
    const trigger = vi.fn();
    registry.addBinding({
      agentName: "dev",
      type: "github",
      source: "MyOrg",
      filter: { events: ["pull_request"] } as GitHubWebhookFilter,
      trigger,
    });

    const result = registry.dispatch("github", {}, '{}', {});
    expect(result.matched).toBe(0);
    expect(trigger).not.toHaveBeenCalled();
  });

  it("matches binding with no filter (triggers on everything)", () => {
    registry.registerProvider(makeProvider());
    const trigger = vi.fn().mockReturnValue(true);
    registry.addBinding({
      agentName: "dev",
      type: "github",
      source: "MyOrg",
      trigger,
    });

    const result = registry.dispatch("github", {}, '{}', {});
    expect(result.matched).toBe(1);
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it("skips bindings with non-matching type", () => {
    registry.registerProvider(makeProvider());
    const trigger = vi.fn();
    registry.addBinding({
      agentName: "dev",
      type: "sentry",
      trigger,
    });

    const result = registry.dispatch("github", {}, '{}', {});
    expect(result.matched).toBe(0);
    expect(trigger).not.toHaveBeenCalled();
  });

  it("counts trigger returning false as skipped (agent disabled)", () => {
    registry.registerProvider(makeProvider());
    const trigger = vi.fn().mockReturnValue(false);
    registry.addBinding({
      agentName: "dev",
      type: "github",
      source: "MyOrg",
      trigger,
    });

    const result = registry.dispatch("github", {}, '{}', {});
    expect(result.ok).toBe(true);
    expect(result.matched).toBe(0);
    expect(result.skipped).toBe(1);
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it("counts trigger errors as skipped", () => {
    registry.registerProvider(makeProvider());
    registry.addBinding({
      agentName: "dev",
      type: "github",
      source: "MyOrg",
      trigger: () => { throw new Error("boom"); },
    });

    const result = registry.dispatch("github", {}, '{}', {});
    expect(result.ok).toBe(true);
    expect(result.matched).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("attaches receiptId to context when provided", () => {
    registry.registerProvider(makeProvider());
    let capturedContext: WebhookContext | undefined;
    registry.addBinding({
      agentName: "dev",
      type: "github",
      source: "MyOrg",
      trigger: (ctx) => { capturedContext = ctx; return true; },
    });

    registry.dispatch("github", {}, '{}', {}, "receipt-abc-123");
    expect(capturedContext?.receiptId).toBe("receipt-abc-123");
  });

  it("parses form-encoded body when content-type is application/x-www-form-urlencoded", () => {
    registry.registerProvider(makeProvider());
    const trigger = vi.fn().mockReturnValue(true);
    registry.addBinding({ agentName: "dev", type: "github", source: "MyOrg", trigger });

    const payloadJson = JSON.stringify({ action: "labeled" });
    const rawBody = `payload=${encodeURIComponent(payloadJson)}`;
    const headers = { "content-type": "application/x-www-form-urlencoded" };

    const result = registry.dispatch("github", headers, rawBody, {});
    expect(result.ok).toBe(true);
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it("rejects form-encoded body missing payload field", () => {
    registry.registerProvider(makeProvider());
    const headers = { "content-type": "application/x-www-form-urlencoded" };
    const rawBody = "other=value";

    const result = registry.dispatch("github", headers, rawBody, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("missing payload in form body");
  });

  describe("removeBindingsForAgent", () => {
    it("removes all bindings for a given agent", () => {
      registry.registerProvider(makeProvider());
      registry.addBinding({ agentName: "dev", type: "github", source: "MyOrg", trigger: vi.fn().mockReturnValue(true) });
      registry.addBinding({ agentName: "dev", type: "github", source: "MyOrg", trigger: vi.fn().mockReturnValue(true) });
      registry.addBinding({ agentName: "other", type: "github", source: "MyOrg", trigger: vi.fn().mockReturnValue(true) });

      const removed = registry.removeBindingsForAgent("dev");
      expect(removed).toBe(2);

      // Only "other" binding remains
      const result = registry.dispatch("github", {}, '{}', {});
      expect(result.matched).toBe(1);
    });

    it("returns 0 when agent has no bindings", () => {
      const removed = registry.removeBindingsForAgent("nonexistent");
      expect(removed).toBe(0);
    });
  });

  describe("dryRunDispatch", () => {
    it("returns ok:false for unknown source", () => {
      const result = registry.dryRunDispatch("unknown", {}, '{}');
      expect(result.ok).toBe(false);
      expect(result.parseError).toContain("unknown source: unknown");
      expect(result.bindings).toEqual([]);
    });

    it("returns ok:false when signature validation fails", () => {
      registry.registerProvider(makeProvider({ validateRequest: () => null }));
      const result = registry.dryRunDispatch("github", {}, '{}');
      expect(result.ok).toBe(false);
      expect(result.validationResult).toBe("signature validation failed");
      expect(result.bindings).toEqual([]);
    });

    it("returns ok:false when JSON body is invalid", () => {
      registry.registerProvider(makeProvider());
      const result = registry.dryRunDispatch("github", {}, "not-json");
      expect(result.ok).toBe(false);
      expect(result.parseError).toMatch(/invalid JSON body/);
    });

    it("returns ok:true with parseError when event cannot be parsed", () => {
      registry.registerProvider(makeProvider({ parseEvent: () => null }));
      const result = registry.dryRunDispatch("github", {}, '{}');
      expect(result.ok).toBe(true);
      expect(result.context).toBeNull();
      expect(result.parseError).toMatch(/could not be parsed/);
    });

    it("returns full context and matched bindings on success", () => {
      registry.registerProvider(makeProvider());
      registry.addBinding({
        agentName: "dev",
        type: "github",
        source: "MyOrg",
        trigger: vi.fn().mockReturnValue(true),
      });

      const result = registry.dryRunDispatch("github", {}, '{}');
      expect(result.ok).toBe(true);
      expect(result.context).not.toBeNull();
      expect(result.context?.event).toBe("issues");
      expect(result.bindings).toHaveLength(1);
      expect(result.bindings[0].agentName).toBe("dev");
      expect(result.bindings[0].matched).toBe(true);
    });

    it("marks binding as unmatched when type differs", () => {
      registry.registerProvider(makeProvider());
      registry.addBinding({
        agentName: "other-agent",
        type: "sentry",
        trigger: vi.fn(),
      });

      const result = registry.dryRunDispatch("github", {}, '{}');
      expect(result.bindings).toHaveLength(1);
      expect(result.bindings[0].matched).toBe(false);
      expect(result.bindings[0].reasons[0]).toMatch(/Type mismatch/);
    });

    it("marks binding as unmatched when source differs", () => {
      registry.registerProvider(makeProvider());
      registry.addBinding({
        agentName: "dev",
        type: "github",
        source: "OtherOrg",
        trigger: vi.fn(),
      });

      const result = registry.dryRunDispatch("github", {}, '{}');
      expect(result.bindings[0].matched).toBe(false);
      expect(result.bindings[0].reasons[0]).toMatch(/Source mismatch/);
    });

    it("marks binding as unmatched when filter does not match", () => {
      registry.registerProvider(makeProvider({ matchesFilter: () => false }));
      registry.addBinding({
        agentName: "dev",
        type: "github",
        source: "MyOrg",
        filter: { events: ["pull_request"] } as GitHubWebhookFilter,
        trigger: vi.fn(),
      });

      const result = registry.dryRunDispatch("github", {}, '{}');
      expect(result.bindings[0].matched).toBe(false);
      expect(result.bindings[0].reasons[0]).toMatch(/Filter conditions not met/);
      expect(result.bindings[0].filterDetails).toBeDefined();
    });

    it("parses form-encoded body in dry run mode", () => {
      registry.registerProvider(makeProvider());
      const payloadJson = JSON.stringify({ action: "created" });
      const rawBody = `payload=${encodeURIComponent(payloadJson)}`;
      const headers = { "content-type": "application/x-www-form-urlencoded" };

      const result = registry.dryRunDispatch("github", headers, rawBody);
      expect(result.ok).toBe(true);
      expect(result.context).not.toBeNull();
    });

    it("returns ok:false when form-encoded body is missing payload field", () => {
      registry.registerProvider(makeProvider());
      const headers = { "content-type": "application/x-www-form-urlencoded" };
      const result = registry.dryRunDispatch("github", headers, "other=val");
      expect(result.ok).toBe(false);
      expect(result.parseError).toMatch(/missing payload/);
    });
  });

  // ── getFilterDetails — individual filter properties ──────────────────────

  describe("getFilterDetails — filter property coverage", () => {
    function makeProviderWithContext(ctx: Record<string, unknown>): WebhookProvider {
      return makeProvider({
        parseEvent: () => ({
          source: "github",
          event: "issues",
          action: "labeled",
          repo: "acme/app",
          sender: "user1",
          timestamp: new Date().toISOString(),
          ...ctx,
        } as any),
        matchesFilter: () => false, // Force unmatched so filterDetails is populated
      });
    }

    it("populates filterDetails.action when filter has 'actions'", () => {
      registry.registerProvider(makeProviderWithContext({ action: "labeled" }));
      registry.addBinding({
        agentName: "dev",
        type: "github",
        source: "MyOrg",
        filter: { actions: ["labeled"] } as any,
        trigger: vi.fn(),
      });
      const result = registry.dryRunDispatch("github", {}, "{}");
      expect(result.bindings[0].filterDetails?.action).toBe(true);
    });

    it("sets filterDetails.action to false when context has no action", () => {
      registry.registerProvider(makeProviderWithContext({ action: undefined }));
      registry.addBinding({
        agentName: "dev",
        type: "github",
        source: "MyOrg",
        filter: { actions: ["labeled"] } as any,
        trigger: vi.fn(),
      });
      const result = registry.dryRunDispatch("github", {}, "{}");
      expect(result.bindings[0].filterDetails?.action).toBe(false);
    });

    it("populates filterDetails.repo when filter has 'repos'", () => {
      registry.registerProvider(makeProviderWithContext({ repo: "acme/app" }));
      registry.addBinding({
        agentName: "dev",
        type: "github",
        source: "MyOrg",
        filter: { repos: ["acme/app"] } as any,
        trigger: vi.fn(),
      });
      const result = registry.dryRunDispatch("github", {}, "{}");
      expect(result.bindings[0].filterDetails?.repo).toBe(true);
    });

    it("populates filterDetails.org when filter has 'org'", () => {
      registry.registerProvider(makeProviderWithContext({ repo: "acme/app" }));
      registry.addBinding({
        agentName: "dev",
        type: "github",
        source: "MyOrg",
        filter: { org: "acme" } as any,
        trigger: vi.fn(),
      });
      const result = registry.dryRunDispatch("github", {}, "{}");
      expect(result.bindings[0].filterDetails?.org).toBe(true);
    });

    it("populates filterDetails.org when filter has 'orgs' array", () => {
      registry.registerProvider(makeProviderWithContext({ repo: "acme/app" }));
      registry.addBinding({
        agentName: "dev",
        type: "github",
        source: "MyOrg",
        filter: { orgs: ["acme", "other"] } as any,
        trigger: vi.fn(),
      });
      const result = registry.dryRunDispatch("github", {}, "{}");
      expect(result.bindings[0].filterDetails?.org).toBe(true);
    });

    it("populates filterDetails.org when filter has 'organizations' array", () => {
      registry.registerProvider(makeProviderWithContext({ repo: "acme/app" }));
      registry.addBinding({
        agentName: "dev",
        type: "github",
        source: "MyOrg",
        filter: { organizations: ["acme"] } as any,
        trigger: vi.fn(),
      });
      const result = registry.dryRunDispatch("github", {}, "{}");
      expect(result.bindings[0].filterDetails?.org).toBe(true);
    });

    it("populates filterDetails.label when filter has 'labels' and context has labels", () => {
      registry.registerProvider(makeProviderWithContext({ labels: ["bug", "enhancement"] }));
      registry.addBinding({
        agentName: "dev",
        type: "github",
        source: "MyOrg",
        filter: { labels: ["bug"] } as any,
        trigger: vi.fn(),
      });
      const result = registry.dryRunDispatch("github", {}, "{}");
      expect(result.bindings[0].filterDetails?.label).toBe(true);
    });

    it("populates filterDetails.assignee when filter has 'assignee'", () => {
      registry.registerProvider(makeProviderWithContext({ assignee: "alice" }));
      registry.addBinding({
        agentName: "dev",
        type: "github",
        source: "MyOrg",
        filter: { assignee: "alice" } as any,
        trigger: vi.fn(),
      });
      const result = registry.dryRunDispatch("github", {}, "{}");
      expect(result.bindings[0].filterDetails?.assignee).toBe(true);
    });

    it("populates filterDetails.author when filter has 'author'", () => {
      registry.registerProvider(makeProviderWithContext({ author: "bob" }));
      registry.addBinding({
        agentName: "dev",
        type: "github",
        source: "MyOrg",
        filter: { author: "bob" } as any,
        trigger: vi.fn(),
      });
      const result = registry.dryRunDispatch("github", {}, "{}");
      expect(result.bindings[0].filterDetails?.author).toBe(true);
    });

    it("populates filterDetails.branch when filter has 'branches'", () => {
      registry.registerProvider(makeProviderWithContext({ branch: "main" }));
      registry.addBinding({
        agentName: "dev",
        type: "github",
        source: "MyOrg",
        filter: { branches: ["main"] } as any,
        trigger: vi.fn(),
      });
      const result = registry.dryRunDispatch("github", {}, "{}");
      expect(result.bindings[0].filterDetails?.branch).toBe(true);
    });

    it("sets filterDetails.branch to false when context has no branch", () => {
      registry.registerProvider(makeProviderWithContext({ branch: undefined }));
      registry.addBinding({
        agentName: "dev",
        type: "github",
        source: "MyOrg",
        filter: { branches: ["main"] } as any,
        trigger: vi.fn(),
      });
      const result = registry.dryRunDispatch("github", {}, "{}");
      expect(result.bindings[0].filterDetails?.branch).toBe(false);
    });

    it("populates filterDetails.conclusion when filter has 'conclusions'", () => {
      registry.registerProvider(makeProviderWithContext({ conclusion: "success" }));
      registry.addBinding({
        agentName: "dev",
        type: "github",
        source: "MyOrg",
        filter: { conclusions: ["success"] } as any,
        trigger: vi.fn(),
      });
      const result = registry.dryRunDispatch("github", {}, "{}");
      expect(result.bindings[0].filterDetails?.conclusion).toBe(true);
    });

    it("sets filterDetails.conclusion to false when context has no conclusion", () => {
      registry.registerProvider(makeProviderWithContext({ conclusion: undefined }));
      registry.addBinding({
        agentName: "dev",
        type: "github",
        source: "MyOrg",
        filter: { conclusions: ["success"] } as any,
        trigger: vi.fn(),
      });
      const result = registry.dryRunDispatch("github", {}, "{}");
      expect(result.bindings[0].filterDetails?.conclusion).toBe(false);
    });

    it("populates filterDetails.resource when filter has 'resources'", () => {
      registry.registerProvider(makeProviderWithContext({ event: "issue_alert" }));
      registry.addBinding({
        agentName: "dev",
        type: "github",
        source: "MyOrg",
        filter: { resources: ["issue_alert"] } as any,
        trigger: vi.fn(),
      });
      const result = registry.dryRunDispatch("github", {}, "{}");
      expect(result.bindings[0].filterDetails?.resource).toBe(true);
    });
  });
});
