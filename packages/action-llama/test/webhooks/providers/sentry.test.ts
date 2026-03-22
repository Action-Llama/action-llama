import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { SentryWebhookProvider } from "../../../src/webhooks/providers/sentry.js";
import type { SentryWebhookFilter, WebhookContext } from "../../../src/webhooks/types.js";

const provider = new SentryWebhookProvider();

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("SentryWebhookProvider", () => {
  describe("validateRequest", () => {
    const secret = "test-secret-123";

    it("accepts valid HMAC signature and returns instance name", () => {
      const body = '{"action":"created"}';
      const sig = sign(body, secret);
      expect(provider.validateRequest({ "sentry-hook-signature": sig }, body, { MySentryOrg: secret })).toBe("MySentryOrg");
    });

    it("rejects invalid HMAC signature", () => {
      const body = '{"action":"created"}';
      const sig = sign("different body", secret);
      expect(provider.validateRequest({ "sentry-hook-signature": sig }, body, { MySentryOrg: secret })).toBeNull();
    });

    it("rejects missing signature when secret is configured", () => {
      expect(provider.validateRequest({}, '{"action":"created"}', { MySentryOrg: secret })).toBeNull();
    });

    it("accepts any request when no secret is configured and allowUnsigned is true", () => {
      expect(provider.validateRequest({}, '{"action":"created"}', undefined, true)).toBe("_unsigned");
      expect(provider.validateRequest({}, '{"action":"created"}', {}, true)).toBe("_unsigned");
    });

    it("rejects any request when no secret is configured and allowUnsigned is false", () => {
      expect(provider.validateRequest({}, '{"action":"created"}')).toBeNull();
      expect(provider.validateRequest({}, '{"action":"created"}', undefined)).toBeNull();
      expect(provider.validateRequest({}, '{"action":"created"}', {})).toBeNull();
      expect(provider.validateRequest({}, '{"action":"created"}', undefined, false)).toBeNull();
      expect(provider.validateRequest({}, '{"action":"created"}', {}, false)).toBeNull();
    });

    it("rejects wrong-length signature", () => {
      expect(provider.validateRequest({ "sentry-hook-signature": "abc" }, "{}", { MySentryOrg: secret })).toBeNull();
    });
  });

  describe("parseEvent", () => {
    it("returns null when no sentry-hook-resource header", () => {
      expect(provider.parseEvent({}, {})).toBeNull();
    });

    it("parses event_alert resource", () => {
      const ctx = provider.parseEvent(
        { "sentry-hook-resource": "event_alert" },
        {
          action: "triggered",
          data: {
            triggered_rule: "High error rate",
            event: {
              title: "TypeError: Cannot read property",
              web_url: "https://sentry.io/issues/123",
              message: "Something went wrong",
            },
          },
          actor: { name: "Sentry", type: "application" },
        }
      );
      expect(ctx).not.toBeNull();
      expect(ctx!.source).toBe("sentry");
      expect(ctx!.event).toBe("event_alert");
      expect(ctx!.action).toBe("triggered");
      expect(ctx!.repo).toBe("High error rate");
      expect(ctx!.title).toBe("TypeError: Cannot read property");
      expect(ctx!.url).toBe("https://sentry.io/issues/123");
      expect(ctx!.body).toBe("Something went wrong");
      expect(ctx!.sender).toBe("Sentry");
    });

    it("parses metric_alert resource", () => {
      const ctx = provider.parseEvent(
        { "sentry-hook-resource": "metric_alert" },
        {
          action: "resolved",
          data: {
            metric_alert: {
              title: "P95 latency > 1s",
              web_url: "https://sentry.io/alerts/456",
              organization: { slug: "my-org" },
            },
          },
          actor: { name: "Bot", type: "application" },
        }
      );
      expect(ctx!.event).toBe("metric_alert");
      expect(ctx!.title).toBe("P95 latency > 1s");
      expect(ctx!.repo).toBe("my-org");
      expect(ctx!.action).toBe("resolved");
    });

    it("parses issue resource", () => {
      const ctx = provider.parseEvent(
        { "sentry-hook-resource": "issue" },
        {
          action: "assigned",
          data: {
            issue: {
              title: "NullPointerException",
              web_url: "https://sentry.io/issues/789",
              project: { slug: "backend" },
              assignedTo: { name: "Alice" },
            },
          },
          actor: { name: "Alice", type: "user" },
        }
      );
      expect(ctx!.event).toBe("issue");
      expect(ctx!.title).toBe("NullPointerException");
      expect(ctx!.repo).toBe("backend");
      expect(ctx!.assignee).toBe("Alice");
      expect(ctx!.sender).toBe("Alice");
    });

    it("parses error resource", () => {
      const ctx = provider.parseEvent(
        { "sentry-hook-resource": "error" },
        {
          action: "created",
          data: {
            error: {
              title: "ReferenceError",
              web_url: "https://sentry.io/errors/111",
              message: "x is not defined",
              project: { slug: "frontend" },
            },
          },
          actor: { type: "application" },
        }
      );
      expect(ctx!.event).toBe("error");
      expect(ctx!.title).toBe("ReferenceError");
      expect(ctx!.body).toBe("x is not defined");
      expect(ctx!.repo).toBe("frontend");
    });

    it("parses comment resource", () => {
      const ctx = provider.parseEvent(
        { "sentry-hook-resource": "comment" },
        {
          action: "created",
          data: {
            comment: { text: "Looking into this" },
            issue: {
              title: "Server crash",
              web_url: "https://sentry.io/issues/222",
              project: { slug: "api" },
            },
          },
          actor: { name: "Bob", type: "user" },
        }
      );
      expect(ctx!.event).toBe("comment");
      expect(ctx!.comment).toBe("Looking into this");
      expect(ctx!.title).toBe("Server crash");
      expect(ctx!.repo).toBe("api");
    });

    it("handles unknown resource types with generic context", () => {
      const ctx = provider.parseEvent(
        { "sentry-hook-resource": "installation" },
        {
          action: "created",
          actor: { name: "Admin", type: "user" },
        }
      );
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("installation");
      expect(ctx!.title).toBe("created");
    });

    it("uses actor.type as fallback sender", () => {
      const ctx = provider.parseEvent(
        { "sentry-hook-resource": "issue" },
        {
          action: "created",
          data: { issue: { title: "Test", project: { slug: "p" } } },
          actor: { type: "application" },
        }
      );
      expect(ctx!.sender).toBe("application");
    });
  });

  describe("matchesFilter", () => {
    const baseContext: WebhookContext = {
      source: "sentry",
      event: "event_alert",
      action: "triggered",
      repo: "High error rate",
      title: "TypeError",
      sender: "Sentry",
      timestamp: new Date().toISOString(),
    };

    it("matches when filter has no resource constraint", () => {
      const filter: SentryWebhookFilter = {};
      expect(provider.matchesFilter(baseContext, filter)).toBe(true);
    });

    it("matches when event is in resources list", () => {
      const filter: SentryWebhookFilter = { resources: ["event_alert", "metric_alert"] };
      expect(provider.matchesFilter(baseContext, filter)).toBe(true);
    });

    it("does not match when event is not in resources list", () => {
      const filter: SentryWebhookFilter = { resources: ["issue", "comment"] };
      expect(provider.matchesFilter(baseContext, filter)).toBe(false);
    });

    it("matches metric_alert events", () => {
      const ctx = { ...baseContext, event: "metric_alert" };
      const filter: SentryWebhookFilter = { resources: ["metric_alert"] };
      expect(provider.matchesFilter(ctx, filter)).toBe(true);
    });
  });
});
