/**
 * Integration tests: webhooks/providers/linear.ts and webhooks/providers/sentry.ts
 * — no Docker required.
 *
 * Both LinearWebhookProvider and SentryWebhookProvider have pure functions that
 * can be tested without Docker infrastructure. The existing Docker-based tests
 * (linear-webhook.test.ts, sentry-webhook.test.ts) cover the full end-to-end
 * flow but skip without Docker. This test covers the pure methods directly.
 *
 * Covers:
 *   - webhooks/providers/linear.ts: validateRequest() allowUnsigned→'_unsigned' / no secrets→null
 *   - webhooks/providers/linear.ts: parseEvent() missing action/type → null
 *   - webhooks/providers/linear.ts: parseEvent() missing organization → null
 *   - webhooks/providers/linear.ts: parseEvent() Issue event → WebhookContext event:issues
 *   - webhooks/providers/linear.ts: parseEvent() Comment event → event:issue_comment
 *   - webhooks/providers/linear.ts: parseEvent() unknown type → generic event
 *   - webhooks/providers/linear.ts: parseEvent() missing data → null
 *   - webhooks/providers/linear.ts: matchesFilter() events filter
 *   - webhooks/providers/linear.ts: matchesFilter() actions filter
 *   - webhooks/providers/linear.ts: matchesFilter() organizations filter
 *   - webhooks/providers/linear.ts: matchesFilter() labels filter
 *   - webhooks/providers/linear.ts: matchesFilter() assignee filter
 *   - webhooks/providers/linear.ts: matchesFilter() author filter
 *   - webhooks/providers/sentry.ts: validateRequest() allowUnsigned→'_unsigned'
 *   - webhooks/providers/sentry.ts: parseEvent() missing sentry-hook-resource → null
 *   - webhooks/providers/sentry.ts: parseEvent() event_alert resource
 *   - webhooks/providers/sentry.ts: parseEvent() metric_alert resource
 *   - webhooks/providers/sentry.ts: parseEvent() issue resource
 *   - webhooks/providers/sentry.ts: parseEvent() error resource
 *   - webhooks/providers/sentry.ts: parseEvent() install resource (default branch)
 *   - webhooks/providers/sentry.ts: matchesFilter() events filter
 *   - webhooks/providers/sentry.ts: matchesFilter() actions filter
 */

import { describe, it, expect } from "vitest";

const { LinearWebhookProvider } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/providers/linear.js"
);

const { SentryWebhookProvider } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/providers/sentry.js"
);

// ── LinearWebhookProvider ─────────────────────────────────────────────────────

describe("integration: LinearWebhookProvider pure methods (no Docker required)", { timeout: 10_000 }, () => {
  const provider = new LinearWebhookProvider();

  // ── validateRequest() ──────────────────────────────────────────────────────

  describe("validateRequest()", () => {
    it("returns '_unsigned' when no secrets and allowUnsigned=true", () => {
      expect(provider.validateRequest({}, "body", {}, true)).toBe("_unsigned");
    });

    it("returns null when no secrets and allowUnsigned=false", () => {
      expect(provider.validateRequest({}, "body", {}, false)).toBeNull();
    });

    it("returns null when linear-signature header is missing", () => {
      expect(provider.validateRequest({}, "body", { default: "secret" })).toBeNull();
    });
  });

  // ── parseEvent() ────────────────────────────────────────────────────────────

  describe("parseEvent()", () => {
    it("returns null when action is missing", () => {
      const result = provider.parseEvent({}, { type: "Issue", organizationId: "org1" });
      expect(result).toBeNull();
    });

    it("returns null when type is missing", () => {
      const result = provider.parseEvent({}, { action: "create", organizationId: "org1" });
      expect(result).toBeNull();
    });

    it("returns null when organization is missing", () => {
      const result = provider.parseEvent({}, {
        action: "create",
        type: "Issue",
        // no organizationId, no data.team.organization.id
      });
      expect(result).toBeNull();
    });

    it("returns null when data field is missing for Issue type", () => {
      const result = provider.parseEvent({}, {
        action: "create",
        type: "Issue",
        organizationId: "org1",
        // no data field
      });
      expect(result).toBeNull();
    });

    it("parses Issue event → event:issues", () => {
      const body = {
        action: "create",
        type: "Issue",
        organizationId: "org-123",
        createdBy: { email: "user@example.com" },
        data: {
          number: 42,
          title: "Fix the bug",
          description: "Details here",
          url: "https://linear.app/issue/42",
          creator: { email: "creator@example.com" },
          assignee: { email: "dev@example.com" },
          labels: [{ name: "bug" }, { name: "urgent" }],
        },
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("issues");
      expect(ctx!.action).toBe("create");
      expect(ctx!.repo).toBe("org-123");
      expect(ctx!.sender).toBe("user@example.com");
      expect(ctx!.number).toBe(42);
      expect(ctx!.title).toBe("Fix the bug");
      expect(ctx!.labels).toContain("bug");
      expect(ctx!.assignee).toBe("dev@example.com");
    });

    it("parses Comment event → event:issue_comment", () => {
      const body = {
        action: "create",
        type: "Comment",
        organizationId: "org-456",
        data: {
          body: "This is a comment",
          url: "https://linear.app/comment/1",
          issue: {
            number: 7,
            title: "Parent issue",
            url: "https://linear.app/issue/7",
            creator: { email: "iss@example.com" },
            labels: [{ name: "review" }],
          },
        },
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("issue_comment");
      expect(ctx!.number).toBe(7);
      expect(ctx!.comment).toContain("This is a comment");
      expect(ctx!.labels).toContain("review");
    });

    it("parses unknown type → lowercased event", () => {
      const body = {
        action: "update",
        type: "Project",
        organizationId: "org-789",
        data: { title: "My Project", url: "https://linear.app/project/1" },
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("project");
    });
  });

  // ── matchesFilter() ────────────────────────────────────────────────────────

  describe("matchesFilter()", () => {
    const ctx: any = {
      source: "linear",
      event: "issues",
      action: "create",
      repo: "org-123",
      sender: "user@example.com",
      timestamp: new Date().toISOString(),
      labels: ["bug", "urgent"],
      assignee: "dev@example.com",
      author: "creator@example.com",
    };

    it("matches when no filter specified", () => {
      expect(provider.matchesFilter(ctx, {})).toBe(true);
    });

    it("matches when events filter includes the event", () => {
      expect(provider.matchesFilter(ctx, { events: ["issues"] })).toBe(true);
    });

    it("does not match when events filter excludes the event", () => {
      expect(provider.matchesFilter(ctx, { events: ["issue_comment"] })).toBe(false);
    });

    it("matches when actions filter includes the action", () => {
      expect(provider.matchesFilter(ctx, { actions: ["create"] })).toBe(true);
    });

    it("does not match when actions filter excludes the action", () => {
      expect(provider.matchesFilter(ctx, { actions: ["delete"] })).toBe(false);
    });

    it("does not match actions filter when context has no action", () => {
      const ctxNoAction = { ...ctx, action: undefined };
      expect(provider.matchesFilter(ctxNoAction, { actions: ["create"] })).toBe(false);
    });

    it("matches when organizations filter includes the org", () => {
      expect(provider.matchesFilter(ctx, { organizations: ["org-123"] } as any)).toBe(true);
    });

    it("does not match when organizations filter excludes the org", () => {
      expect(provider.matchesFilter(ctx, { organizations: ["other-org"] } as any)).toBe(false);
    });

    it("matches when labels filter has a matching label", () => {
      expect(provider.matchesFilter(ctx, { labels: ["bug"] })).toBe(true);
    });

    it("does not match when labels filter has no matching labels", () => {
      expect(provider.matchesFilter(ctx, { labels: ["feature"] })).toBe(false);
    });

    it("matches when assignee filter matches", () => {
      expect(provider.matchesFilter(ctx, { assignee: "dev@example.com" } as any)).toBe(true);
    });

    it("does not match when assignee filter mismatches", () => {
      expect(provider.matchesFilter(ctx, { assignee: "other@example.com" } as any)).toBe(false);
    });

    it("matches when author filter matches", () => {
      expect(provider.matchesFilter(ctx, { author: "creator@example.com" } as any)).toBe(true);
    });

    it("does not match when author filter mismatches", () => {
      expect(provider.matchesFilter(ctx, { author: "other@example.com" } as any)).toBe(false);
    });
  });
});

// ── SentryWebhookProvider ──────────────────────────────────────────────────────

describe("integration: SentryWebhookProvider pure methods (no Docker required)", { timeout: 10_000 }, () => {
  const provider = new SentryWebhookProvider();

  // ── validateRequest() ──────────────────────────────────────────────────────

  describe("validateRequest()", () => {
    it("returns '_unsigned' when no secrets and allowUnsigned=true", () => {
      expect(provider.validateRequest({}, "body", {}, true)).toBe("_unsigned");
    });

    it("returns null when no secrets and allowUnsigned=false", () => {
      expect(provider.validateRequest({}, "body", {}, false)).toBeNull();
    });

    it("returns null when sentry-hook-signature header is missing", () => {
      expect(provider.validateRequest({}, "body", { default: "secret" })).toBeNull();
    });
  });

  // ── parseEvent() ────────────────────────────────────────────────────────────

  describe("parseEvent()", () => {
    it("returns null when sentry-hook-resource header is missing", () => {
      const result = provider.parseEvent({}, { action: "triggered" });
      expect(result).toBeNull();
    });

    it("parses event_alert resource", () => {
      const headers = { "sentry-hook-resource": "event_alert" };
      const body = {
        action: "triggered",
        actor: { name: "sentry-bot" },
        data: {
          triggered_rule: "High Error Rate",
          event: { title: "Connection failed", web_url: "https://sentry.io/event/1", message: "DB error" },
        },
      };
      const ctx = provider.parseEvent(headers, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("event_alert");
      expect(ctx!.action).toBe("triggered");
      expect(ctx!.title).toContain("Connection failed");
    });

    it("parses metric_alert resource", () => {
      const headers = { "sentry-hook-resource": "metric_alert" };
      const body = {
        action: "critical",
        actor: { type: "system" },
        data: {
          metric_alert: {
            title: "High P99 Latency",
            web_url: "https://sentry.io/alert/1",
            organization: { slug: "my-org" },
          },
        },
      };
      const ctx = provider.parseEvent(headers, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("metric_alert");
      expect(ctx!.repo).toBe("my-org");
      expect(ctx!.title).toContain("High P99 Latency");
    });

    it("parses issue resource", () => {
      const headers = { "sentry-hook-resource": "issue" };
      const body = {
        action: "created",
        actor: { name: "dev" },
        data: {
          issue: {
            title: "TypeError: null is not an object",
            web_url: "https://sentry.io/issues/1",
            project: { slug: "my-project" },
            assignedTo: { name: "alice" },
          },
        },
      };
      const ctx = provider.parseEvent(headers, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("issue");
      expect(ctx!.repo).toBe("my-project");
      expect(ctx!.assignee).toBe("alice");
    });

    it("parses error resource", () => {
      const headers = { "sentry-hook-resource": "error" };
      const body = {
        action: "created",
        actor: { name: "sentry" },
        data: {
          error: {
            title: "SyntaxError",
            web_url: "https://sentry.io/errors/1",
            project: { slug: "api-service" },
            message: "unexpected token",
          },
        },
      };
      const ctx = provider.parseEvent(headers, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("error");
      expect(ctx!.repo).toBe("api-service");
    });

    it("parses install resource with default branch", () => {
      const headers = { "sentry-hook-resource": "installation" };
      const body = {
        action: "created",
        actor: { name: "user" },
        data: { installation: { uuid: "123" } },
      };
      const ctx = provider.parseEvent(headers, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("installation");
    });
  });

  // ── matchesFilter() ────────────────────────────────────────────────────────
  // Note: SentryWebhookFilter only has a 'resources' field (not events/actions)

  describe("matchesFilter()", () => {
    const ctx: any = {
      source: "sentry",
      event: "issue",
      action: "created",
      repo: "my-project",
      sender: "sentry",
      timestamp: new Date().toISOString(),
    };

    it("matches when no filter (empty object)", () => {
      expect(provider.matchesFilter(ctx, {})).toBe(true);
    });

    it("matches when resources filter includes the event", () => {
      expect(provider.matchesFilter(ctx, { resources: ["issue"] } as any)).toBe(true);
    });

    it("does not match when resources filter excludes the event", () => {
      expect(provider.matchesFilter(ctx, { resources: ["event_alert"] } as any)).toBe(false);
    });

    it("matches when resources filter is empty (no filter applied)", () => {
      expect(provider.matchesFilter(ctx, { resources: [] } as any)).toBe(true);
    });

    it("matches when resources filter includes multiple and one matches", () => {
      expect(provider.matchesFilter(ctx, { resources: ["issue", "error"] } as any)).toBe(true);
    });
  });
});
