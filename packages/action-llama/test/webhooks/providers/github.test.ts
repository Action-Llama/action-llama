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

    it("accepts valid HMAC signature and returns instance name", () => {
      const body = '{"action":"opened"}';
      const sig = sign(body, secret);
      expect(provider.validateRequest({ "x-hub-signature-256": sig }, body, { MyOrg: secret })).toBe("MyOrg");
    });

    it("rejects invalid HMAC signature", () => {
      const body = '{"action":"opened"}';
      const sig = sign("different body", secret);
      expect(provider.validateRequest({ "x-hub-signature-256": sig }, body, { MyOrg: secret })).toBeNull();
    });

    it("rejects missing signature when secret is configured", () => {
      expect(provider.validateRequest({}, '{"action":"opened"}', { MyOrg: secret })).toBeNull();
    });

    it("accepts any request when no secret is configured and allowUnsigned is true", () => {
      expect(provider.validateRequest({}, '{"action":"opened"}', undefined, true)).toBe("_unsigned");
      expect(provider.validateRequest({}, '{"action":"opened"}', {}, true)).toBe("_unsigned");
    });

    it("rejects requests when no secret is configured and allowUnsigned is false (default)", () => {
      expect(provider.validateRequest({}, '{"action":"opened"}')).toBeNull();
      expect(provider.validateRequest({}, '{"action":"opened"}', undefined)).toBeNull();
      expect(provider.validateRequest({}, '{"action":"opened"}', {})).toBeNull();
      expect(provider.validateRequest({}, '{"action":"opened"}', undefined, false)).toBeNull();
      expect(provider.validateRequest({}, '{"action":"opened"}', {}, false)).toBeNull();
    });

    it("rejects wrong-length signature", () => {
      expect(provider.validateRequest({ "x-hub-signature-256": "sha256=abc" }, "{}", { MyOrg: secret })).toBeNull();
    });

    it("accepts when any of multiple secrets matches and returns correct instance", () => {
      const body = '{"action":"opened"}';
      const sig = sign(body, "second-secret");
      expect(provider.validateRequest({ "x-hub-signature-256": sig }, body, { OrgA: "wrong-secret", OrgB: "second-secret" })).toBe("OrgB");
    });

    it("rejects when none of multiple secrets match", () => {
      const body = '{"action":"opened"}';
      const sig = sign(body, "actual-secret");
      expect(provider.validateRequest({ "x-hub-signature-256": sig }, body, { OrgA: "wrong1", OrgB: "wrong2" })).toBeNull();
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

    it("extracts conclusion from workflow_run event", () => {
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
            conclusion: "failure",
          },
        }
      );
      expect(ctx!.event).toBe("workflow_run");
      expect(ctx!.conclusion).toBe("failure");
    });

    it("extracts pull request number from workflow_run event when triggered by PR", () => {
      const ctx = provider.parseEvent(
        { "x-github-event": "workflow_run" },
        {
          action: "completed",
          repository: { full_name: "acme/app" },
          sender: { login: "user1" },
          workflow_run: {
            name: "CI",
            html_url: "https://github.com/acme/app/actions/runs/123",
            head_branch: "feature-branch",
            actor: { login: "actor1" },
            conclusion: "success",
            pull_requests: [{ number: 42 }],
          },
        }
      );
      expect(ctx!.event).toBe("workflow_run");
      expect(ctx!.number).toBe(42);
      expect(ctx!.conclusion).toBe("success");
    });

    it("does not extract pull request number when workflow not triggered by PR", () => {
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
            conclusion: "success",
            pull_requests: [],
          },
        }
      );
      expect(ctx!.event).toBe("workflow_run");
      expect(ctx!.number).toBeUndefined();
      expect(ctx!.conclusion).toBe("success");
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
      const filter: GitHubWebhookFilter = {};
      expect(provider.matchesFilter(baseContext, filter)).toBe(true);
    });

    it("matches on event type", () => {
      expect(provider.matchesFilter(baseContext, { events: ["issues"] })).toBe(true);
      expect(provider.matchesFilter(baseContext, { events: ["pull_request"] })).toBe(false);
    });

    it("matches on action", () => {
      expect(provider.matchesFilter(baseContext, { actions: ["labeled"] })).toBe(true);
      expect(provider.matchesFilter(baseContext, { actions: ["opened"] })).toBe(false);
    });

    it("matches on repos", () => {
      expect(provider.matchesFilter(baseContext, { repos: ["acme/app"] })).toBe(true);
      expect(provider.matchesFilter(baseContext, { repos: ["other/repo"] })).toBe(false);
    });

    it("matches on orgs", () => {
      expect(provider.matchesFilter(baseContext, { orgs: ["acme"] })).toBe(true);
      expect(provider.matchesFilter(baseContext, { orgs: ["other"] })).toBe(false);
      expect(provider.matchesFilter(baseContext, { orgs: ["acme", "other"] })).toBe(true);
    });

    it("matches on labels (any match)", () => {
      expect(provider.matchesFilter(baseContext, { labels: ["agent"] })).toBe(true);
      expect(provider.matchesFilter(baseContext, { labels: ["nonexistent"] })).toBe(false);
      expect(provider.matchesFilter(baseContext, { labels: ["nonexistent", "bug"] })).toBe(true);
    });

    it("matches on assignee", () => {
      expect(provider.matchesFilter(baseContext, { assignee: "bot" })).toBe(true);
      expect(provider.matchesFilter(baseContext, { assignee: "other" })).toBe(false);
    });

    it("matches on author", () => {
      expect(provider.matchesFilter(baseContext, { author: "dev1" })).toBe(true);
      expect(provider.matchesFilter(baseContext, { author: "other" })).toBe(false);
    });

    it("matches on branches", () => {
      const prContext = { ...baseContext, branch: "main" };
      expect(provider.matchesFilter(prContext, { branches: ["main"] })).toBe(true);
      expect(provider.matchesFilter(prContext, { branches: ["develop"] })).toBe(false);
    });

    it("allows events without a branch through the branches filter", () => {
      // An issue event has no branch — it should pass even when branches filter is set.
      // This is intentional: filtering branches: ["main"] should still allow issue events.
      const issueContext = { ...baseContext, branch: undefined };
      expect(provider.matchesFilter(issueContext, { branches: ["main"] })).toBe(true);
    });

    it("matches with multiple filter criteria (AND logic)", () => {
      const filter: GitHubWebhookFilter = {
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

    it("matches with both repos and orgs criteria", () => {
      const filter: GitHubWebhookFilter = {
        repos: ["acme/app"],
        orgs: ["acme"],
      };
      expect(provider.matchesFilter(baseContext, filter)).toBe(true);

      // Test with different repos in same org
      const otherRepoContext = { ...baseContext, repo: "acme/other" };
      expect(provider.matchesFilter(otherRepoContext, { orgs: ["acme"] })).toBe(true);
      expect(provider.matchesFilter(otherRepoContext, { repos: ["acme/app"] })).toBe(false);

      // Test with different org
      const differentOrgContext = { ...baseContext, repo: "other-org/app" };
      expect(provider.matchesFilter(differentOrgContext, { orgs: ["acme"] })).toBe(false);
    });

    it("skips action filter when context has no action", () => {
      const noActionCtx = { ...baseContext, action: undefined };
      expect(provider.matchesFilter(noActionCtx, { actions: ["opened"] })).toBe(false);
    });

    it("matches with singular org field", () => {
      expect(provider.matchesFilter(baseContext, { org: "acme" })).toBe(true);
      expect(provider.matchesFilter(baseContext, { org: "other" })).toBe(false);
    });

    it("matches with both org and orgs", () => {
      expect(provider.matchesFilter(baseContext, { org: "other", orgs: ["acme"] })).toBe(true);
      expect(provider.matchesFilter(baseContext, { org: "nope", orgs: ["also-nope"] })).toBe(false);
    });

    it("matches on conclusion for workflow_run events", () => {
      const workflowContext = {
        ...baseContext,
        event: "workflow_run",
        action: "completed",
        conclusion: "failure",
      };
      
      expect(provider.matchesFilter(workflowContext, { conclusions: ["failure"] })).toBe(true);
      expect(provider.matchesFilter(workflowContext, { conclusions: ["success"] })).toBe(false);
      expect(provider.matchesFilter(workflowContext, { conclusions: ["failure", "cancelled"] })).toBe(true);
    });

    it("ignores conclusion filter for events without conclusion", () => {
      // Issue events don't have conclusions, so the filter should be ignored
      expect(provider.matchesFilter(baseContext, { conclusions: ["failure"] })).toBe(true);
    });

    it("allows events without conclusion through conclusion filter", () => {
      const noConclusion = { ...baseContext, conclusion: undefined };
      expect(provider.matchesFilter(noConclusion, { conclusions: ["success"] })).toBe(true);
    });

    it("filters workflow runs by conclusion correctly", () => {
      const successWorkflow = {
        ...baseContext,
        event: "workflow_run",
        action: "completed",
        conclusion: "success",
      };
      
      const failedWorkflow = {
        ...baseContext,
        event: "workflow_run", 
        action: "completed",
        conclusion: "failure",
      };

      // Filter for failures only
      const failureFilter: GitHubWebhookFilter = { conclusions: ["failure"] };
      expect(provider.matchesFilter(successWorkflow, failureFilter)).toBe(false);
      expect(provider.matchesFilter(failedWorkflow, failureFilter)).toBe(true);

      // Filter for success only  
      const successFilter: GitHubWebhookFilter = { conclusions: ["success"] };
      expect(provider.matchesFilter(successWorkflow, successFilter)).toBe(true);
      expect(provider.matchesFilter(failedWorkflow, successFilter)).toBe(false);
    });
  });

  describe("getDeliveryId", () => {
    it("returns the x-github-delivery header value", () => {
      expect(provider.getDeliveryId({ "x-github-delivery": "abc-123" })).toBe("abc-123");
    });

    it("returns null when x-github-delivery header is missing", () => {
      expect(provider.getDeliveryId({})).toBeNull();
      expect(provider.getDeliveryId({ "x-other-header": "value" })).toBeNull();
    });
  });

  describe("parseEvent edge cases", () => {
    it("returns null for issues event when body.issue is missing", () => {
      const result = provider.parseEvent(
        { "x-github-event": "issues" },
        {
          action: "labeled",
          repository: { full_name: "acme/app" },
          sender: { login: "user1" },
          // issue field intentionally omitted
        }
      );
      expect(result).toBeNull();
    });

    it("returns null for pull_request event when body.pull_request is missing", () => {
      const result = provider.parseEvent(
        { "x-github-event": "pull_request" },
        {
          action: "opened",
          repository: { full_name: "acme/app" },
          sender: { login: "user1" },
          // pull_request field intentionally omitted
        }
      );
      expect(result).toBeNull();
    });

    it("returns null for issue_comment event when comment is missing", () => {
      const result = provider.parseEvent(
        { "x-github-event": "issue_comment" },
        {
          action: "created",
          repository: { full_name: "acme/app" },
          sender: { login: "user1" },
          issue: { number: 1, title: "test", user: { login: "a" }, labels: [] },
          // comment field intentionally omitted
        }
      );
      expect(result).toBeNull();
    });

    it("returns null for issue_comment event when issue is missing", () => {
      const result = provider.parseEvent(
        { "x-github-event": "issue_comment" },
        {
          action: "created",
          repository: { full_name: "acme/app" },
          sender: { login: "user1" },
          comment: { body: "A comment", html_url: "https://github.com/acme/app/issues/1#comment-1" },
          // issue field intentionally omitted
        }
      );
      expect(result).toBeNull();
    });

    it("handles issue_comment event with undefined labels on issue", () => {
      const result = provider.parseEvent(
        { "x-github-event": "issue_comment" },
        {
          action: "created",
          repository: { full_name: "acme/app" },
          sender: { login: "user1" },
          issue: {
            number: 5,
            title: "Some issue",
            user: { login: "author" },
            // labels intentionally omitted (undefined)
          },
          comment: {
            body: "A comment",
            html_url: "https://github.com/acme/app/issues/5#comment-1",
          },
        }
      );
      expect(result).not.toBeNull();
      expect(result!.labels).toEqual([]);
    });

    it("returns null for pull_request_review event when pull_request is missing", () => {
      const result = provider.parseEvent(
        { "x-github-event": "pull_request_review" },
        {
          action: "submitted",
          repository: { full_name: "acme/app" },
          sender: { login: "reviewer" },
          review: { body: "LGTM", html_url: "https://github.com" },
          // pull_request intentionally omitted
        }
      );
      expect(result).toBeNull();
    });

    it("returns null for pull_request_review event when review is missing", () => {
      const result = provider.parseEvent(
        { "x-github-event": "pull_request_review" },
        {
          action: "submitted",
          repository: { full_name: "acme/app" },
          sender: { login: "reviewer" },
          pull_request: { number: 1, title: "PR", user: { login: "a" }, head: { ref: "main" } },
          // review intentionally omitted
        }
      );
      expect(result).toBeNull();
    });

    it("returns null for workflow_run event when workflow_run body field is missing", () => {
      const result = provider.parseEvent(
        { "x-github-event": "workflow_run" },
        {
          action: "completed",
          repository: { full_name: "acme/app" },
          sender: { login: "user1" },
          // workflow_run field intentionally omitted
        }
      );
      expect(result).toBeNull();
    });

    it("uses pusher name as author fallback in push event when head_commit has no author username", () => {
      const result = provider.parseEvent(
        { "x-github-event": "push" },
        {
          ref: "refs/heads/main",
          repository: { full_name: "acme/app" },
          sender: { login: "user1" },
          compare: "https://github.com/acme/app/compare/abc...def",
          head_commit: {
            message: "fix: bug",
            author: { name: "John Doe" }, // no username field
          },
          pusher: { name: "johndoe" },
        }
      );
      expect(result).not.toBeNull();
      expect(result!.author).toBe("johndoe");
    });

    it("parses issue_comment event with non-empty labels (covers l.name mapping)", () => {
      const ctx = provider.parseEvent(
        { "x-github-event": "issue_comment" },
        {
          action: "created",
          repository: { full_name: "acme/app" },
          sender: { login: "user1" },
          issue: {
            number: 7,
            title: "Labeled issue",
            user: { login: "author5" },
            labels: [{ name: "bug" }, { name: "urgent" }],
          },
          comment: {
            body: "A comment on a labeled issue",
            html_url: "https://github.com/acme/app/issues/7#comment-2",
          },
        }
      );
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("issue_comment");
      expect(ctx!.labels).toEqual(["bug", "urgent"]);
    });
  });
});
