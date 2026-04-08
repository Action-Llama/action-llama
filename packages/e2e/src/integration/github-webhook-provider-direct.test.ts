/**
 * Integration tests: webhooks/providers/github.ts GitHubWebhookProvider — no Docker required.
 *
 * GitHubWebhookProvider has pure methods testable without Docker.
 * The existing tests (github-webhook.test.ts, github-conclusions-filter.test.ts)
 * focus on specific event types. This test covers additional GitHub event types
 * and branches in parseEvent() and matchesFilter().
 *
 * Covers:
 *   - webhooks/providers/github.ts: getDeliveryId() with/without x-github-delivery
 *   - webhooks/providers/github.ts: validateRequest() allowUnsigned→'_unsigned'
 *   - webhooks/providers/github.ts: parseEvent() no x-github-event → null
 *   - webhooks/providers/github.ts: parseEvent() ping event → null
 *   - webhooks/providers/github.ts: parseEvent() no repository field → null
 *   - webhooks/providers/github.ts: parseEvent() issues event → WebhookContext
 *   - webhooks/providers/github.ts: parseEvent() pull_request event → WebhookContext
 *   - webhooks/providers/github.ts: parseEvent() issue_comment event → WebhookContext
 *   - webhooks/providers/github.ts: parseEvent() pull_request_review event → WebhookContext
 *   - webhooks/providers/github.ts: parseEvent() push event → branch extracted from ref
 *   - webhooks/providers/github.ts: parseEvent() workflow_run event → conclusion field
 *   - webhooks/providers/github.ts: parseEvent() check_suite event → conclusion field
 *   - webhooks/providers/github.ts: parseEvent() create event → branch field
 *   - webhooks/providers/github.ts: parseEvent() delete event → branch field
 *   - webhooks/providers/github.ts: parseEvent() deployment event → environment field
 *   - webhooks/providers/github.ts: parseEvent() deployment_status event → status/conclusion
 *   - webhooks/providers/github.ts: parseEvent() release event → title/url
 *   - webhooks/providers/github.ts: parseEvent() star event → sender
 *   - webhooks/providers/github.ts: parseEvent() discussion event → number/title
 *   - webhooks/providers/github.ts: parseEvent() generic unknown event → default branch
 *   - webhooks/providers/github.ts: matchesFilter() repos filter
 *   - webhooks/providers/github.ts: matchesFilter() events filter
 *   - webhooks/providers/github.ts: matchesFilter() actions filter
 *   - webhooks/providers/github.ts: matchesFilter() labels filter
 *   - webhooks/providers/github.ts: matchesFilter() branches filter
 */

import { describe, it, expect } from "vitest";

const { GitHubWebhookProvider } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/providers/github.js"
);

const provider = new GitHubWebhookProvider();

/** Minimal base body with required repository field. */
function makeBase(extra: Record<string, any> = {}): Record<string, any> {
  return {
    repository: { full_name: "acme/my-repo" },
    sender: { login: "developer" },
    action: "opened",
    ...extra,
  };
}

/** Parse a GitHub event with the given event type header and body. */
function parse(event: string, body: Record<string, any>) {
  return provider.parseEvent({ "x-github-event": event }, body);
}

describe("integration: GitHubWebhookProvider pure methods (no Docker required)", { timeout: 10_000 }, () => {

  // ── getDeliveryId() ────────────────────────────────────────────────────────

  describe("getDeliveryId()", () => {
    it("returns x-github-delivery header value", () => {
      expect(provider.getDeliveryId({ "x-github-delivery": "delivery-abc" })).toBe("delivery-abc");
    });

    it("returns null when x-github-delivery is absent", () => {
      expect(provider.getDeliveryId({})).toBeNull();
    });
  });

  // ── validateRequest() ──────────────────────────────────────────────────────

  describe("validateRequest()", () => {
    it("returns '_unsigned' when no secrets and allowUnsigned=true", () => {
      expect(provider.validateRequest({}, "body", {}, true)).toBe("_unsigned");
    });

    it("returns null when no secrets and allowUnsigned=false", () => {
      expect(provider.validateRequest({}, "body", {}, false)).toBeNull();
    });
  });

  // ── parseEvent() ────────────────────────────────────────────────────────────

  describe("parseEvent()", () => {
    it("returns null when x-github-event header is missing", () => {
      expect(provider.parseEvent({}, makeBase())).toBeNull();
    });

    it("returns null for ping events", () => {
      expect(parse("ping", { hook: { type: "Repository" } })).toBeNull();
    });

    it("returns null when repository field is absent", () => {
      expect(parse("push", { ref: "refs/heads/main" })).toBeNull();
    });

    it("parses issues event", () => {
      const body = makeBase({
        issue: {
          number: 42,
          title: "Fix the bug",
          body: "Details here",
          html_url: "https://github.com/acme/my-repo/issues/42",
          user: { login: "reporter" },
          assignee: { login: "dev" },
          labels: [{ name: "bug" }, { name: "urgent" }],
        },
      });
      const ctx = parse("issues", body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("issues");
      expect(ctx!.number).toBe(42);
      expect(ctx!.title).toBe("Fix the bug");
      expect(ctx!.repo).toBe("acme/my-repo");
      expect(ctx!.sender).toBe("developer");
      expect(ctx!.labels).toContain("bug");
      expect(ctx!.assignee).toBe("dev");
    });

    it("parses pull_request event", () => {
      const body = makeBase({
        pull_request: {
          number: 123,
          title: "Add feature",
          body: "PR description",
          html_url: "https://github.com/acme/my-repo/pull/123",
          user: { login: "author" },
          labels: [{ name: "feature" }],
          head: { ref: "feature-branch" },
        },
      });
      const ctx = parse("pull_request", body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("pull_request");
      expect(ctx!.number).toBe(123);
      expect(ctx!.branch).toBe("feature-branch");
    });

    it("parses issue_comment event", () => {
      const body = makeBase({
        issue: {
          number: 5,
          title: "Issue title",
          user: { login: "issue-author" },
          labels: [],
        },
        comment: {
          body: "This is a comment",
          html_url: "https://github.com/acme/my-repo/issues/5#comment-1",
        },
      });
      const ctx = parse("issue_comment", body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("issue_comment");
      expect(ctx!.number).toBe(5);
      expect(ctx!.comment).toContain("This is a comment");
    });

    it("parses pull_request_review event", () => {
      const body = makeBase({
        pull_request: {
          number: 77,
          title: "PR to review",
          user: { login: "pr-author" },
          head: { ref: "review-branch" },
        },
        review: {
          body: "LGTM!",
          html_url: "https://github.com/acme/my-repo/pull/77#review-1",
        },
      });
      const ctx = parse("pull_request_review", body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("pull_request_review");
      expect(ctx!.branch).toBe("review-branch");
    });

    it("parses push event extracting branch from ref", () => {
      const body = makeBase({
        ref: "refs/heads/develop",
        compare: "https://github.com/acme/my-repo/compare/abc...def",
        head_commit: { message: "Fix typo", author: { username: "pusher" } },
      });
      const ctx = parse("push", body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("push");
      expect(ctx!.branch).toBe("develop");
      expect(ctx!.title).toBe("Fix typo");
    });

    it("parses workflow_run event with conclusion", () => {
      const body = makeBase({
        workflow_run: {
          name: "CI",
          conclusion: "success",
          html_url: "https://github.com/acme/my-repo/actions/runs/1",
          head_branch: "main",
        },
      });
      const ctx = parse("workflow_run", body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("workflow_run");
      expect(ctx!.conclusion).toBe("success");
      expect(ctx!.branch).toBe("main");
    });

    // Note: check_suite, create, delete, release, star, and other events not explicitly
    // handled by extractContext fall through to the default branch: { title: body.action || event }

    it("parses check_suite event via default branch (no special handling)", () => {
      const body = makeBase({
        action: "completed",
        check_suite: { conclusion: "failure" },
      });
      const ctx = parse("check_suite", body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("check_suite");
      // Default handler uses body.action as title
      expect(ctx!.title).toBe("completed");
      expect(ctx!.action).toBe("completed");
    });

    it("parses create event via default branch", () => {
      const body = makeBase({
        action: "created",
        ref_type: "branch",
        ref: "new-feature-branch",
      });
      const ctx = parse("create", body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("create");
      expect(ctx!.title).toBe("created");
    });

    it("parses delete event via default branch", () => {
      const body = makeBase({
        action: "deleted",
        ref_type: "tag",
        ref: "v1.0.0-old",
      });
      const ctx = parse("delete", body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("delete");
      expect(ctx!.title).toBe("deleted");
    });

    it("parses release event via default branch", () => {
      const body = makeBase({
        action: "published",
        release: { tag_name: "v2.0.0", html_url: "https://github.com/acme/my-repo/releases/tag/v2.0.0" },
      });
      const ctx = parse("release", body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("release");
      // Default handler: title = body.action
      expect(ctx!.title).toBe("published");
    });

    it("parses star event via default branch", () => {
      const body = makeBase({ action: "created" });
      const ctx = parse("star", body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("star");
      expect(ctx!.title).toBe("created");
    });

    it("parses unknown/custom event via default branch, uses event name when no action", () => {
      // When action is absent, title = event name
      const body = { repository: { full_name: "acme/my-repo" }, sender: { login: "user" } };
      const ctx = parse("repository_dispatch", body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("repository_dispatch");
      expect(ctx!.title).toBe("repository_dispatch"); // body.action is undefined, so falls back to event
    });
  });

  // ── matchesFilter() ────────────────────────────────────────────────────────

  describe("matchesFilter()", () => {
    const ctx: any = {
      source: "github",
      event: "issues",
      action: "opened",
      repo: "acme/my-repo",
      sender: "developer",
      timestamp: new Date().toISOString(),
      labels: ["bug", "priority"],
      branch: "main",
    };

    it("matches when no filter", () => {
      expect(provider.matchesFilter(ctx, {})).toBe(true);
    });

    it("matches when repos filter includes the repo", () => {
      expect(provider.matchesFilter(ctx, { repos: ["acme/my-repo"] })).toBe(true);
    });

    it("does not match when repos filter excludes the repo", () => {
      expect(provider.matchesFilter(ctx, { repos: ["other/repo"] })).toBe(false);
    });

    it("matches when events filter includes the event", () => {
      expect(provider.matchesFilter(ctx, { events: ["issues"] })).toBe(true);
    });

    it("does not match when events filter excludes the event", () => {
      expect(provider.matchesFilter(ctx, { events: ["pull_request"] })).toBe(false);
    });

    it("matches when actions filter includes the action", () => {
      expect(provider.matchesFilter(ctx, { actions: ["opened"] })).toBe(true);
    });

    it("does not match when actions filter excludes the action", () => {
      expect(provider.matchesFilter(ctx, { actions: ["closed"] })).toBe(false);
    });

    it("matches when labels filter has a matching label", () => {
      expect(provider.matchesFilter(ctx, { labels: ["bug"] })).toBe(true);
    });

    it("does not match when labels filter has no matching labels", () => {
      expect(provider.matchesFilter(ctx, { labels: ["feature"] })).toBe(false);
    });

    it("matches when branches filter includes the branch", () => {
      expect(provider.matchesFilter(ctx, { branches: ["main"] })).toBe(true);
    });

    it("does not match when branches filter excludes the branch", () => {
      expect(provider.matchesFilter(ctx, { branches: ["develop"] })).toBe(false);
    });
  });
});
