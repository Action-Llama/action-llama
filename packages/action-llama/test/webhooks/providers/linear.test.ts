import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { LinearWebhookProvider } from "../../../src/webhooks/providers/linear.js";
import type { LinearWebhookFilter, WebhookContext } from "../../../src/webhooks/types.js";

const provider = new LinearWebhookProvider();

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("LinearWebhookProvider", () => {
  describe("validateRequest", () => {
    const secret = "linear-secret-123";

    it("accepts valid HMAC signature and returns instance name", () => {
      const body = '{"action":"create","type":"Issue"}';
      const sig = sign(body, secret);
      expect(provider.validateRequest({ "linear-signature": sig }, body, { MyWorkspace: secret })).toBe("MyWorkspace");
    });

    it("rejects invalid HMAC signature", () => {
      const body = '{"action":"create","type":"Issue"}';
      const sig = sign("different body", secret);
      expect(provider.validateRequest({ "linear-signature": sig }, body, { MyWorkspace: secret })).toBeNull();
    });

    it("rejects missing signature when secret is configured", () => {
      expect(provider.validateRequest({}, '{"action":"create"}', { MyWorkspace: secret })).toBeNull();
    });

    it("accepts any request when no secret is configured and allowUnsigned is true", () => {
      expect(provider.validateRequest({}, '{"action":"create"}', undefined, true)).toBe("_unsigned");
      expect(provider.validateRequest({}, '{"action":"create"}', {}, true)).toBe("_unsigned");
    });

    it("rejects any request when no secret is configured and allowUnsigned is false", () => {
      expect(provider.validateRequest({}, '{"action":"create"}')).toBeNull();
      expect(provider.validateRequest({}, '{"action":"create"}', undefined)).toBeNull();
      expect(provider.validateRequest({}, '{"action":"create"}', {})).toBeNull();
      expect(provider.validateRequest({}, '{"action":"create"}', undefined, false)).toBeNull();
      expect(provider.validateRequest({}, '{"action":"create"}', {}, false)).toBeNull();
    });

    it("accepts when any of multiple secrets matches and returns correct instance", () => {
      const body = '{"action":"create","type":"Issue"}';
      const sig = sign(body, "second-secret");
      expect(provider.validateRequest({ "linear-signature": sig }, body, { WorkspaceA: "wrong-secret", WorkspaceB: "second-secret" })).toBe("WorkspaceB");
    });

    it("rejects when none of multiple secrets match", () => {
      const body = '{"action":"create","type":"Issue"}';
      const sig = sign(body, "actual-secret");
      expect(provider.validateRequest({ "linear-signature": sig }, body, { WorkspaceA: "wrong-secret", WorkspaceB: "also-wrong" })).toBeNull();
    });
  });

  describe("parseEvent", () => {
    it("parses issue create event", () => {
      const body = {
        action: "create",
        type: "Issue",
        organizationId: "org-123",
        data: {
          id: "issue-456",
          number: 123,
          title: "Bug in login",
          description: "Users cannot log in",
          url: "https://linear.app/org/issue/123",
          creator: { email: "user@example.com" },
          assignee: { email: "dev@example.com" },
          labels: [{ name: "bug" }, { name: "high-priority" }]
        },
        createdBy: { email: "user@example.com" }
      };

      const result = provider.parseEvent({}, body);
      expect(result).toEqual({
        source: "linear",
        event: "issues",
        action: "create",
        repo: "org-123",
        number: 123,
        title: "Bug in login",
        body: "Users cannot log in",
        url: "https://linear.app/org/issue/123",
        author: "user@example.com",
        assignee: "dev@example.com",
        labels: ["bug", "high-priority"],
        sender: "user@example.com",
        timestamp: expect.any(String)
      });
    });

    it("parses comment create event", () => {
      const body = {
        action: "create",
        type: "Comment",
        organizationId: "org-123",
        data: {
          id: "comment-789",
          body: "This might be related to the auth service",
          url: "https://linear.app/org/issue/123#comment-789",
          issue: {
            number: 123,
            title: "Bug in login",
            creator: { email: "user@example.com" },
            labels: [{ name: "bug" }]
          }
        },
        createdBy: { email: "commenter@example.com" }
      };

      const result = provider.parseEvent({}, body);
      expect(result).toEqual({
        source: "linear",
        event: "issue_comment",
        action: "create",
        repo: "org-123",
        number: 123,
        title: "Bug in login",
        url: "https://linear.app/org/issue/123#comment-789",
        author: "user@example.com",
        comment: "This might be related to the auth service",
        labels: ["bug"],
        sender: "commenter@example.com",
        timestamp: expect.any(String)
      });
    });

    it("returns null for unsupported event type without organizationId", () => {
      const body = {
        action: "create",
        type: "Issue"
        // missing organizationId
      };

      expect(provider.parseEvent({}, body)).toBeNull();
    });

    it("returns null when missing action or type", () => {
      expect(provider.parseEvent({}, { type: "Issue" })).toBeNull();
      expect(provider.parseEvent({}, { action: "create" })).toBeNull();
      expect(provider.parseEvent({}, {})).toBeNull();
    });

    it("handles truncation of long descriptions", () => {
      const longDescription = "x".repeat(5000); // Longer than MAX_TEXT_LENGTH
      const body = {
        action: "create",
        type: "Issue",
        organizationId: "org-123",
        data: {
          number: 123,
          title: "Long issue",
          description: longDescription,
          creator: { email: "user@example.com" }
        }
      };

      const result = provider.parseEvent({}, body);
      expect(result?.body).toMatch(/^x+\.\.\.$/);
      expect(result?.body?.length).toBeLessThan(longDescription.length);
    });

    it("handles unknown event types gracefully", () => {
      const body = {
        action: "create",
        type: "Project",
        organizationId: "org-123",
        data: {
          title: "New Project",
          url: "https://linear.app/org/project/123"
        }
      };

      const result = provider.parseEvent({}, body);
      expect(result).toEqual({
        source: "linear",
        event: "project",
        action: "create",
        repo: "org-123",
        title: "New Project",
        url: "https://linear.app/org/project/123",
        sender: "unknown",
        timestamp: expect.any(String)
      });
    });
  });

  describe("matchesFilter", () => {
    const context: WebhookContext = {
      source: "linear",
      event: "issues",
      action: "create",
      repo: "org-123",
      number: 123,
      title: "Bug report",
      author: "user@example.com",
      assignee: "dev@example.com",
      labels: ["bug", "frontend"],
      sender: "user@example.com",
      timestamp: "2024-01-01T12:00:00Z"
    };

    it("matches when no filters are specified", () => {
      const filter: LinearWebhookFilter = {};
      expect(provider.matchesFilter(context, filter)).toBe(true);
    });

    it("matches when event filter matches", () => {
      const filter: LinearWebhookFilter = { events: ["issues", "pull_requests"] };
      expect(provider.matchesFilter(context, filter)).toBe(true);
    });

    it("does not match when event filter does not match", () => {
      const filter: LinearWebhookFilter = { events: ["pull_requests"] };
      expect(provider.matchesFilter(context, filter)).toBe(false);
    });

    it("matches when action filter matches", () => {
      const filter: LinearWebhookFilter = { actions: ["create", "update"] };
      expect(provider.matchesFilter(context, filter)).toBe(true);
    });

    it("does not match when action filter does not match", () => {
      const filter: LinearWebhookFilter = { actions: ["delete"] };
      expect(provider.matchesFilter(context, filter)).toBe(false);
    });

    it("matches when organization filter matches", () => {
      const filter: LinearWebhookFilter = { organizations: ["org-123", "org-456"] };
      expect(provider.matchesFilter(context, filter)).toBe(true);
    });

    it("does not match when organization filter does not match", () => {
      const filter: LinearWebhookFilter = { organizations: ["org-456"] };
      expect(provider.matchesFilter(context, filter)).toBe(false);
    });

    it("matches when any label in filter is present", () => {
      const filter: LinearWebhookFilter = { labels: ["bug", "backend"] };
      expect(provider.matchesFilter(context, filter)).toBe(true);
    });

    it("does not match when no labels in filter are present", () => {
      const filter: LinearWebhookFilter = { labels: ["backend", "critical"] };
      expect(provider.matchesFilter(context, filter)).toBe(false);
    });

    it("matches when assignee filter matches", () => {
      const filter: LinearWebhookFilter = { assignee: "dev@example.com" };
      expect(provider.matchesFilter(context, filter)).toBe(true);
    });

    it("does not match when assignee filter does not match", () => {
      const filter: LinearWebhookFilter = { assignee: "other@example.com" };
      expect(provider.matchesFilter(context, filter)).toBe(false);
    });

    it("matches when author filter matches", () => {
      const filter: LinearWebhookFilter = { author: "user@example.com" };
      expect(provider.matchesFilter(context, filter)).toBe(true);
    });

    it("does not match when author filter does not match", () => {
      const filter: LinearWebhookFilter = { author: "other@example.com" };
      expect(provider.matchesFilter(context, filter)).toBe(false);
    });

    it("matches when all filters match", () => {
      const filter: LinearWebhookFilter = {
        events: ["issues"],
        actions: ["create"],
        organizations: ["org-123"],
        labels: ["bug"],
        assignee: "dev@example.com",
        author: "user@example.com"
      };
      expect(provider.matchesFilter(context, filter)).toBe(true);
    });

    it("does not match when any filter fails", () => {
      const filter: LinearWebhookFilter = {
        events: ["issues"],
        actions: ["create"],
        organizations: ["org-456"], // This one fails
        labels: ["bug"],
        assignee: "dev@example.com"
      };
      expect(provider.matchesFilter(context, filter)).toBe(false);
    });

    it("skips actions filter when context has no action", () => {
      const contextWithoutAction = { ...context };
      delete contextWithoutAction.action;
      const filter: LinearWebhookFilter = { actions: ["create"] };
      expect(provider.matchesFilter(contextWithoutAction, filter)).toBe(false);
    });

    it("handles context without labels", () => {
      const contextWithoutLabels = { ...context };
      delete contextWithoutLabels.labels;
      const filter: LinearWebhookFilter = { labels: ["bug"] };
      expect(provider.matchesFilter(contextWithoutLabels, filter)).toBe(false);
    });
  });
});