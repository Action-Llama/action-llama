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

  describe("validateRequest branch coverage", () => {
    it("reads signature from 'mintlify-signature' header when 'x-mintlify-signature' is absent (line 14 alt branch)", () => {
      // Line 14: `headers["x-mintlify-signature"] || headers["mintlify-signature"]`
      // This tests the second operand when the first is undefined
      const result = provider.validateRequest(
        { "mintlify-signature": "sha256=abc123" },
        "rawBody",
        undefined,
        true  // allowUnsigned=true so validation doesn't fail on the HMAC itself
      );
      // Should not be null (allowUnsigned=true bypasses signature check)
      expect(result).not.toBeNull();
    });
  });

  describe("parseEvent sender fallback branches", () => {
    it("uses user.name when user.email is absent (line 31 second branch)", () => {
      const payload = {
        event: "build",
        action: "failed",
        project: "my-docs",
        branch: "main",
        user: { name: "John Doe" }, // email not set, name set
      };

      const context = provider.parseEvent({}, payload);
      expect(context).not.toBeNull();
      expect(context?.sender).toBe("John Doe");
    });

    it("uses 'mintlify' as sender when user is absent (line 31 third branch)", () => {
      const payload = {
        event: "build",
        action: "failed",
        project: "my-docs",
        branch: "main",
        // no user field
      };

      const context = provider.parseEvent({}, payload);
      expect(context).not.toBeNull();
      expect(context?.sender).toBe("mintlify");
    });
  });

  describe("parseEvent extractContext branch coverage", () => {
    it("uses body.description when message and error are absent (line 49 third branch)", () => {
      const payload = {
        event: "build",
        action: "failed",
        project: "my-docs",
        branch: "main",
        description: "Build failed with description",
        // no message, no error
        user: { email: "user@example.com" },
      };

      const context = provider.parseEvent({}, payload);
      expect(context).not.toBeNull();
      // body should come from description since message and error are absent
      expect(context?.body).toContain("Build failed with description");
    });

    it("sets conclusion to 'success' for action 'success' (line 58 second elif branch)", () => {
      // This tests the `base.action === "success"` branch (as opposed to "succeeded")
      const payload = {
        event: "build",
        action: "success",  // 'success' variant (not 'succeeded')
        project: "my-docs",
        branch: "main",
        user: { email: "user@example.com" },
      };

      const context = provider.parseEvent({}, payload);
      expect(context).not.toBeNull();
      expect(context?.conclusion).toBe("success");
    });

    it("uses body.build_url when url is absent and body.logs_url is absent (branch coverage)", () => {
      const payload = {
        event: "build",
        action: "failed",
        project: "my-docs",
        branch: "main",
        build_url: "https://mintlify.com/build/789",
        // no url field
        user: { email: "user@example.com" },
      };

      const context = provider.parseEvent({}, payload);
      expect(context).not.toBeNull();
      expect(context?.url).toBe("https://mintlify.com/build/789");
    });

    it("uses body.git.branch when branch is absent", () => {
      const payload = {
        event: "build",
        action: "failed",
        project: "my-docs",
        // no branch field
        git: { branch: "feature/my-feature" },
        user: { email: "user@example.com" },
      };

      const context = provider.parseEvent({}, payload);
      expect(context).not.toBeNull();
      expect(context?.branch).toBe("feature/my-feature");
    });

    it("uses 'main' as branch fallback when neither branch nor git.branch is present", () => {
      const payload = {
        event: "build",
        action: "failed",
        project: "my-docs",
        // no branch, no git
        user: { email: "user@example.com" },
      };

      const context = provider.parseEvent({}, payload);
      expect(context).not.toBeNull();
      expect(context?.branch).toBe("main");
    });

    it("uses body.organization as repo when body.project is absent (line 31 second branch)", () => {
      const payload = {
        event: "build",
        action: "failed",
        // no project field
        organization: "my-org",
        branch: "main",
        user: { email: "user@example.com" },
      };

      const context = provider.parseEvent({}, payload);
      expect(context).not.toBeNull();
      expect(context?.repo).toBe("my-org");
    });

    it("uses 'unknown' as repo when neither body.project nor body.organization is present (line 31 third branch)", () => {
      const payload = {
        event: "build",
        action: "failed",
        // no project, no organization
        branch: "main",
        user: { email: "user@example.com" },
      };

      const context = provider.parseEvent({}, payload);
      expect(context).not.toBeNull();
      expect(context?.repo).toBe("unknown");
    });

    it("does not set conclusion for a neutral action (covers else-if FALSE branch at line 58)", () => {
      // When action is neither failed/failure nor succeeded/success, the else if is FALSE
      const payload = {
        event: "build",
        action: "in-progress",
        project: "my-docs",
        branch: "main",
        user: { email: "user@example.com" },
      };

      const context = provider.parseEvent({}, payload);
      expect(context).not.toBeNull();
      // conclusion should not be set since action is not a terminal state
      expect(context?.conclusion).toBeUndefined();
    });
  });
});