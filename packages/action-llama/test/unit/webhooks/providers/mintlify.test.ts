import { describe, it, expect } from "vitest";
import { MintlifyWebhookProvider } from "../../../../src/webhooks/providers/mintlify.js";
import type { MintlifyWebhookFilter } from "../../../../src/webhooks/types.js";

describe("MintlifyWebhookProvider", () => {
  const provider = new MintlifyWebhookProvider();

  describe("parseEvent", () => {
    it("parses build failed event", () => {
      const payload = {
        event: "build",
        action: "failed",
        project: "my-docs",
        branch: "main",
        message: "Build failed due to syntax error",
        url: "https://mintlify.com/build/123",
        user: { email: "user@example.com" }
      };

      const context = provider.parseEvent({}, payload);
      expect(context).toEqual({
        source: "mintlify",
        event: "build",
        action: "failed",
        repo: "my-docs",
        sender: "user@example.com",
        timestamp: expect.any(String),
        title: "Build failed",
        body: "Build failed due to syntax error",
        url: "https://mintlify.com/build/123",
        branch: "main",
        conclusion: "failure"
      });
    });

    it("parses build succeeded event", () => {
      const payload = {
        event: "build",
        action: "succeeded",
        project: "my-docs",
        branch: "main"
      };

      const context = provider.parseEvent({}, payload);
      expect(context?.action).toBe("succeeded");
      expect(context?.conclusion).toBe("success");
    });

    it("returns null for invalid payload", () => {
      expect(provider.parseEvent({}, null)).toBeNull();
      expect(provider.parseEvent({}, {})).toBeNull();
      expect(provider.parseEvent({}, { event: "build" })).toBeNull(); // no action
    });
  });

  describe("matchesFilter", () => {
    const context = {
      source: "mintlify",
      event: "build",
      action: "failed",
      repo: "my-docs",
      branch: "main",
      sender: "user@example.com",
      timestamp: "2023-01-01T00:00:00Z",
      title: "Build failed",
      body: "Error message",
      url: "https://mintlify.com/build/123"
    };

    it("matches when no filter provided", () => {
      expect(provider.matchesFilter(context, {})).toBe(true);
    });

    it("matches events filter", () => {
      const filter: MintlifyWebhookFilter = { events: ["build"] };
      expect(provider.matchesFilter(context, filter)).toBe(true);

      filter.events = ["deploy"];
      expect(provider.matchesFilter(context, filter)).toBe(false);
    });

    it("matches actions filter", () => {
      const filter: MintlifyWebhookFilter = { actions: ["failed"] };
      expect(provider.matchesFilter(context, filter)).toBe(true);

      filter.actions = ["succeeded"];
      expect(provider.matchesFilter(context, filter)).toBe(false);
    });

    it("matches projects filter", () => {
      const filter: MintlifyWebhookFilter = { projects: ["my-docs"] };
      expect(provider.matchesFilter(context, filter)).toBe(true);

      filter.projects = ["other-docs"];
      expect(provider.matchesFilter(context, filter)).toBe(false);
    });

    it("matches branches filter", () => {
      const filter: MintlifyWebhookFilter = { branches: ["main"] };
      expect(provider.matchesFilter(context, filter)).toBe(true);

      filter.branches = ["develop"];
      expect(provider.matchesFilter(context, filter)).toBe(false);
    });

    it("requires all filters to match", () => {
      const filter: MintlifyWebhookFilter = {
        events: ["build"],
        actions: ["failed"],
        projects: ["my-docs"],
        branches: ["main"]
      };
      expect(provider.matchesFilter(context, filter)).toBe(true);

      // Change one filter to not match
      filter.branches = ["develop"];
      expect(provider.matchesFilter(context, filter)).toBe(false);
    });

    it("returns false when filter specifies actions but context has no action", () => {
      const noActionContext = {
        source: "mintlify",
        event: "build",
        // no action field
        repo: "my-docs",
        branch: "main",
        sender: "user@example.com",
        timestamp: "2023-01-01T00:00:00Z",
        title: "Build",
        body: "Some message",
      } as any;

      const filter: MintlifyWebhookFilter = { actions: ["failed"] };
      expect(provider.matchesFilter(noActionContext, filter)).toBe(false);
    });
  });

  describe("parseEvent with body.error field", () => {
    it("sets context.body to 'Build failed: <error>' when body.error is present on a failed build", () => {
      const payload = {
        event: "build",
        action: "failed",
        project: "my-docs",
        branch: "main",
        error: "Compilation failed: unexpected token",
        url: "https://mintlify.com/build/456",
        user: { email: "dev@example.com" },
      };

      const context = provider.parseEvent({}, payload);
      expect(context).not.toBeNull();
      expect(context?.body).toBe("Build failed: Compilation failed: unexpected token");
      expect(context?.conclusion).toBe("failure");
    });
  });
});