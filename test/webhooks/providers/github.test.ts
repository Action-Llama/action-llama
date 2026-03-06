import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { GitHubWebhookProvider } from "../../../src/webhooks/providers/github.js";
import type { GitHubWebhookFilter, WebhookContext } from "../../../src/webhooks/types.js";

const provider = new GitHubWebhookProvider();

function sign(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

describe("GitHubWebhookProvider", () => {
  describe("validateRequest", () => {
    const secret = "test-secret-123";

    it("accepts valid HMAC signature", () => {
      const body = '{"action":"opened"}';
      const sig = sign(body, secret);
      expect(provider.validateRequest({ "x-hub-signature-256": sig }, body, [secret])).toBe(true);
    });

    it("rejects invalid HMAC signature", () => {
      const body = '{"action":"opened"}';
      const sig = sign("different body", secret);
      expect(provider.validateRequest({ "x-hub-signature-256": sig }, body, [secret])).toBe(false);
    });

    it("rejects missing signature when secret is configured", () => {
      expect(provider.validateRequest({}, '{"action":"opened"}', [secret])).toBe(false);
    });

    it("accepts any request when no secret is configured", () => {
      expect(provider.validateRequest({}, '{"action":"opened"}')).toBe(true);
      expect(provider.validateRequest({}, '{"action":"opened"}', undefined)).toBe(true);
      expect(provider.validateRequest({}, '{"action":"opened"}', [])).toBe(true);
    });

    it("rejects wrong-length signature", () => {
      expect(provider.validateRequest({ "x-hub-signature-256": "sha256=abc" }, "{}", [secret])).toBe(false);
    });

    it("accepts when any of multiple secrets matches", () => {
      const body = '{"action":"opened"}';
      const sig = sign(body, "second-secret");
      expect(provider.validateRequest({ "x-hub-signature-256": sig }, body, ["wrong-secret", "second-secret"])).toBe(true);
    });

    it("rejects when none of multiple secrets match", () => {
      const body = '{"action":"opened"}';
      const sig = sign(body, "actual-secret");
      expect(provider.validateRequest({ "x-hub-signature-256": sig }, body, ["wrong1", "wrong2"])).toBe(false);
    });
  });

  describe("parseEvent", () => {
    it("returns null for ping events", () => {
      const result = provider.parseEvent(
        { "x-github-event": "ping" },
        { zen: "test", repository: { full_name: "acme/app" } }
      );
      expect(result).toBeNull();
    });

    it("returns null when no x-github-event header", () => {
      expect(provider.parseEvent({}, {})).toBeNull();
    });

    it("returns null when no repository", () => {
      expect(provider.parseEvent({ "x-github-event": "issues" }, {})).toBeNull();
    });

    it("parses issues event", () => {
      const ctx = provider.parseEvent(
        { "x-github-event": "issues" },
        {
          action: "labeled",
          repository: { full_name: "acme/app" },
          sender: { login: "user1" },
          issue: {
            number: 42,
            title: "Fix the bug",
            body: "Description here",
            html_url: "https://github.com/acme/app/issues/42",
            user: { login: "author1" },
            assignee: { login: "dev-bot" },
            labels: [{ name: "agent" }, { name: "bug" }],
          },
        }
      );
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("issues");
      expect(ctx!.action).toBe("labeled");
      expect(ctx!.repo).toBe("acme/app");
      expect(ctx!.number).toBe(42);
      expect(ctx!.title).toBe("Fix the bug");
      expect(ctx!.author).toBe("author1");
      expect(ctx!.assignee).toBe("dev-bot");
      expect(ctx!.labels).toEqual(["agent", "bug"]);
      expect(ctx!.sender).toBe("user1");
    });

    it("parses pull_request event", () => {
      const ctx = provider.parseEvent(
        { "x-github-event": "pull_request" },
        {
          action: "opened",
          repository: { full_name: "acme/app" },
          sender: { login: "user1" },
          pull_request: {
            number: 10,
            title: "Add feature",
            body: "PR body",
            html_url: "https://github.com/acme/app/pull/10",
            user: { login: "author2" },
            assignee: null,
            labels: [{ name: "enhancement" }],
            head: { ref: "feature-branch" },
          },
        }
      );
      expect(ctx!.event).toBe("pull_request");
      expect(ctx!.number).toBe(10);
      expect(ctx!.branch).toBe("feature-branch");
      expect(ctx!.labels).toEqual(["enhancement"]);
    });

    it("parses issue_comment event", () => {
      const ctx = provider.parseEvent(
        { "x-github-event": "issue_comment" },
        {
          action: "created",
          repository: { full_name: "acme/app" },
          sender: { login: "user1" },
          issue: {
            number: 5,
            title: "Help needed",
            user: { login: "author3" },
            labels: [],
          },
          comment: {
            body: "Here is my comment",
            html_url: "https://github.com/acme/app/issues/5#comment-1",
          },
        }
      );
      expect(ctx!.event).toBe("issue_comment");
      expect(ctx!.comment).toBe("Here is my comment");
      expect(ctx!.number).toBe(5);
    });

    it("parses push event", () => {
      const ctx = provider.parseEvent(
        { "x-github-event": "push" },
        {
          ref: "refs/heads/main",
          repository: { full_name: "acme/app" },
          sender: { login: "user1" },
          compare: "https://github.com/acme/app/compare/abc...def",
          head_commit: {
            message: "fix: something",
            author: { username: "pusher1" },
          },
          pusher: { name: "pusher1" },
        }
      );
      expect(ctx!.event).toBe("push");
      expect(ctx!.branch).toBe("main");
      expect(ctx!.title).toBe("fix: something");
    });

    it("parses workflow_run event", () => {
      const ctx = provider.parseEvent(
        { "x-github-event": "workflow_run" },
        {
          action: "completed",
          repository: { full_name: "acme/app" },
          sender: { login: "user1" },
          workflow_run: {
            name: "CI",
            html_url: "https://github.com/acme/app/actions/runs/123",
            head_branch: "main",
            actor: { login: "actor1" },
          },
        }
      );
      expect(ctx!.event).toBe("workflow_run");
      expect(ctx!.title).toBe("CI");
      expect(ctx!.branch).toBe("main");
    });

    it("parses pull_request_review event", () => {
      const ctx = provider.parseEvent(
        { "x-github-event": "pull_request_review" },
        {
          action: "submitted",
          repository: { full_name: "acme/app" },
          sender: { login: "reviewer1" },
          pull_request: {
            number: 7,
            title: "Big PR",
            user: { login: "author4" },
            head: { ref: "big-pr-branch" },
          },
          review: {
            body: "LGTM",
            html_url: "https://github.com/acme/app/pull/7#pullrequestreview-1",
          },
        }
      );
      expect(ctx!.event).toBe("pull_request_review");
      expect(ctx!.number).toBe(7);
      expect(ctx!.comment).toBe("LGTM");
    });

    it("truncates long body text", () => {
      const longBody = "x".repeat(5000);
      const ctx = provider.parseEvent(
        { "x-github-event": "issues" },
        {
          action: "opened",
          repository: { full_name: "acme/app" },
          sender: { login: "user1" },
          issue: {
            number: 1,
            title: "test",
            body: longBody,
            html_url: "https://github.com/acme/app/issues/1",
            user: { login: "a" },
            labels: [],
          },
        }
      );
      expect(ctx!.body!.length).toBeLessThan(5000);
      expect(ctx!.body!.endsWith("...")).toBe(true);
    });

    it("handles unknown event types with generic context", () => {
      const ctx = provider.parseEvent(
        { "x-github-event": "star" },
        {
          action: "created",
          repository: { full_name: "acme/app" },
          sender: { login: "starrer" },
        }
      );
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("star");
      expect(ctx!.title).toBe("created");
    });
  });

  describe("matchesFilter", () => {
    const baseContext: WebhookContext = {
      source: "github",
      event: "issues",
      action: "labeled",
      repo: "acme/app",
      number: 42,
      title: "Fix bug",
      author: "dev1",
      assignee: "bot",
      labels: ["agent", "bug"],
      branch: undefined,
      sender: "user1",
      timestamp: new Date().toISOString(),
    };

    it("matches when filter is empty (no constraints)", () => {
      const filter: GitHubWebhookFilter = { source: "github" };
      expect(provider.matchesFilter(baseContext, filter)).toBe(true);
    });

    it("matches on event type", () => {
      expect(provider.matchesFilter(baseContext, { source: "github", events: ["issues"] })).toBe(true);
      expect(provider.matchesFilter(baseContext, { source: "github", events: ["pull_request"] })).toBe(false);
    });

    it("matches on action", () => {
      expect(provider.matchesFilter(baseContext, { source: "github", actions: ["labeled"] })).toBe(true);
      expect(provider.matchesFilter(baseContext, { source: "github", actions: ["opened"] })).toBe(false);
    });

    it("matches on repos", () => {
      expect(provider.matchesFilter(baseContext, { source: "github", repos: ["acme/app"] })).toBe(true);
      expect(provider.matchesFilter(baseContext, { source: "github", repos: ["other/repo"] })).toBe(false);
    });

    it("matches on labels (any match)", () => {
      expect(provider.matchesFilter(baseContext, { source: "github", labels: ["agent"] })).toBe(true);
      expect(provider.matchesFilter(baseContext, { source: "github", labels: ["nonexistent"] })).toBe(false);
      expect(provider.matchesFilter(baseContext, { source: "github", labels: ["nonexistent", "bug"] })).toBe(true);
    });

    it("matches on assignee", () => {
      expect(provider.matchesFilter(baseContext, { source: "github", assignee: "bot" })).toBe(true);
      expect(provider.matchesFilter(baseContext, { source: "github", assignee: "other" })).toBe(false);
    });

    it("matches on author", () => {
      expect(provider.matchesFilter(baseContext, { source: "github", author: "dev1" })).toBe(true);
      expect(provider.matchesFilter(baseContext, { source: "github", author: "other" })).toBe(false);
    });

    it("matches on branches", () => {
      const prContext = { ...baseContext, branch: "main" };
      expect(provider.matchesFilter(prContext, { source: "github", branches: ["main"] })).toBe(true);
      expect(provider.matchesFilter(prContext, { source: "github", branches: ["develop"] })).toBe(false);
    });

    it("matches with multiple filter criteria (AND logic)", () => {
      const filter: GitHubWebhookFilter = {
        source: "github",
        events: ["issues"],
        actions: ["labeled"],
        labels: ["agent"],
        assignee: "bot",
      };
      expect(provider.matchesFilter(baseContext, filter)).toBe(true);

      // Fail one criterion
      const filter2: GitHubWebhookFilter = { ...filter, assignee: "wrong" };
      expect(provider.matchesFilter(baseContext, filter2)).toBe(false);
    });

    it("skips action filter when context has no action", () => {
      const noActionCtx = { ...baseContext, action: undefined };
      expect(provider.matchesFilter(noActionCtx, { source: "github", actions: ["opened"] })).toBe(false);
    });
  });
});
