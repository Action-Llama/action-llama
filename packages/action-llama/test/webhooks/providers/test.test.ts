import { describe, it, expect } from "vitest";
import { TestWebhookProvider } from "../../../src/webhooks/providers/test.js";

describe("TestWebhookProvider", () => {
  const provider = new TestWebhookProvider();

  describe("source", () => {
    it("is 'test'", () => {
      expect(provider.source).toBe("test");
    });
  });

  describe("validateRequest", () => {
    it("always returns 'test' (no HMAC validation)", () => {
      expect(provider.validateRequest({}, "{}")).toBe("test");
      expect(provider.validateRequest({}, "", {})).toBe("test");
      expect(provider.validateRequest({}, "invalid")).toBe("test");
    });
  });

  describe("parseEvent", () => {
    it("reads body directly as WebhookContext", () => {
      const body = {
        source: "test",
        event: "deploy",
        action: "created",
        repo: "acme/app",
        sender: "bot",
        title: "Deploy v1.2",
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.source).toBe("test");
      expect(ctx!.event).toBe("deploy");
      expect(ctx!.action).toBe("created");
      expect(ctx!.repo).toBe("acme/app");
      expect(ctx!.sender).toBe("bot");
      expect(ctx!.title).toBe("Deploy v1.2");
    });

    it("provides defaults for missing fields", () => {
      const ctx = provider.parseEvent({}, {});
      expect(ctx).not.toBeNull();
      expect(ctx!.source).toBe("test");
      expect(ctx!.event).toBe("test");
      expect(ctx!.repo).toBe("");
      expect(ctx!.sender).toBe("test");
      expect(ctx!.timestamp).toBeTruthy();
    });

    it("returns null for non-object body", () => {
      expect(provider.parseEvent({}, null)).toBeNull();
      expect(provider.parseEvent({}, "string")).toBeNull();
    });
  });

  describe("matchesFilter", () => {
    const baseContext = {
      source: "test",
      event: "deploy",
      action: "created",
      repo: "acme/app",
      sender: "bot",
      timestamp: new Date().toISOString(),
    };

    it("matches with empty filter", () => {
      expect(provider.matchesFilter(baseContext, {})).toBe(true);
    });

    it("filters by events", () => {
      expect(provider.matchesFilter(baseContext, { events: ["deploy"] })).toBe(true);
      expect(provider.matchesFilter(baseContext, { events: ["push"] })).toBe(false);
    });

    it("filters by actions", () => {
      expect(provider.matchesFilter(baseContext, { actions: ["created"] })).toBe(true);
      expect(provider.matchesFilter(baseContext, { actions: ["deleted"] })).toBe(false);
    });

    it("rejects events with no action when action filter is set", () => {
      const noAction = { ...baseContext, action: undefined };
      expect(provider.matchesFilter(noAction, { actions: ["created"] })).toBe(false);
    });

    it("filters by repos", () => {
      expect(provider.matchesFilter(baseContext, { repos: ["acme/app"] })).toBe(true);
      expect(provider.matchesFilter(baseContext, { repos: ["other/repo"] })).toBe(false);
    });

    it("combines multiple filters", () => {
      expect(provider.matchesFilter(baseContext, { events: ["deploy"], repos: ["acme/app"] })).toBe(true);
      expect(provider.matchesFilter(baseContext, { events: ["deploy"], repos: ["other/repo"] })).toBe(false);
    });
  });
});
