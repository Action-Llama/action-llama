/**
 * Integration tests: github.ts and discord.ts provider fallback branches
 * — no Docker required.
 *
 * These tests cover the `|| default_value` fallback branches in parseEvent()
 * and matchesFilter() that are skipped by existing tests which always supply
 * truthy values for optional fields.
 *
 * Covers:
 *   - webhooks/providers/github.ts: parseEvent() pull_request without labels → labels: []
 *   - webhooks/providers/github.ts: parseEvent() push without ref → branch: ""
 *   - webhooks/providers/github.ts: parseEvent() unknown event without action → title uses event name
 *   - webhooks/providers/github.ts: matchesFilter() context.labels undefined → contextLabels: []
 *   - webhooks/providers/github.ts: parseEvent() push author fallback: head_commit.author.username absent → pusher.name
 *   - webhooks/providers/discord.ts: parseEvent() APPLICATION_COMMAND without data.name → commandName "unknown"
 *   - webhooks/providers/discord.ts: parseEvent() MESSAGE_COMPONENT without component_type → action "unknown"
 *   - webhooks/providers/discord.ts: parseEvent() MESSAGE_COMPONENT without custom_id → title "component"
 *   - webhooks/providers/discord.ts: parseEvent() AUTOCOMPLETE without data.name → commandName "unknown"
 *   - webhooks/providers/discord.ts: parseEvent() MODAL_SUBMIT without custom_id → action/title "modal"
 */

import { describe, it, expect } from "vitest";

const { GitHubWebhookProvider } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/providers/github.js"
);

const { DiscordWebhookProvider } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/providers/discord.js"
);

// ── GitHubWebhookProvider fallback branches ───────────────────────────────────

describe(
  "integration: GitHubWebhookProvider and DiscordWebhookProvider fallback branches (no Docker required)",
  { timeout: 10_000 },
  () => {
    const github = new GitHubWebhookProvider();
    const discord = new DiscordWebhookProvider();

    // ── github.ts parseEvent() fallback branches ────────────────────────────

    describe("GitHubWebhookProvider.parseEvent() fallback branches", () => {
      it("pull_request without labels field → labels defaults to []", () => {
        // Covers line 74: `labels: pr.labels?.map((l) => l.name) || []`
        // When pr.labels is undefined, `?.map(...)` returns undefined, so `|| []` is used.
        const ctx = github.parseEvent(
          { "x-github-event": "pull_request" },
          {
            action: "opened",
            repository: { full_name: "acme/app" },
            sender: { login: "user1" },
            pull_request: {
              number: 42,
              title: "No labels PR",
              body: "body",
              html_url: "https://github.com/acme/app/pull/42",
              user: { login: "author" },
              assignee: null,
              // labels intentionally omitted
              head: { ref: "feature" },
            },
          }
        );
        expect(ctx).not.toBeNull();
        expect(ctx!.labels).toEqual([]);
      });

      it("issue_comment without issue.labels → labels defaults to []", () => {
        // Covers line 90: `labels: issue.labels?.map((l) => l.name) || []`
        const ctx = github.parseEvent(
          { "x-github-event": "issue_comment" },
          {
            action: "created",
            repository: { full_name: "acme/app" },
            sender: { login: "commenter" },
            issue: {
              number: 5,
              title: "Issue title",
              user: { login: "issue-author" },
              // labels intentionally omitted
            },
            comment: {
              html_url: "https://github.com/acme/app/issues/5#comment-1",
              body: "Great issue!",
            },
          }
        );
        expect(ctx).not.toBeNull();
        expect(ctx!.labels).toEqual([]);
      });

      it("push event without ref → branch defaults to ''", () => {
        // Covers line 110: `const ref = body.ref || ""`
        // When body.ref is absent, `|| ""` is used so branch becomes "".
        const ctx = github.parseEvent(
          { "x-github-event": "push" },
          {
            repository: { full_name: "acme/app" },
            sender: { login: "pusher" },
            compare: "https://github.com/acme/app/compare/abc...def",
            head_commit: { message: "initial commit", author: { username: "dev" } },
            // ref intentionally omitted
          }
        );
        expect(ctx).not.toBeNull();
        expect(ctx!.branch).toBe("");
      });

      it("push event: head_commit.author.username absent → falls back to pusher.name", () => {
        // Covers line 117: `author: body.head_commit?.author?.username || body.pusher?.name`
        // When head_commit.author.username is absent, pusher.name is used.
        const ctx = github.parseEvent(
          { "x-github-event": "push" },
          {
            ref: "refs/heads/main",
            repository: { full_name: "acme/app" },
            sender: { login: "pusher-user" },
            compare: "https://github.com/acme/app/compare/abc...def",
            head_commit: {
              message: "some commit",
              author: {
                // username intentionally omitted
                name: "Dev Name",
              },
            },
            pusher: { name: "pusher-fallback" },
          }
        );
        expect(ctx).not.toBeNull();
        expect(ctx!.author).toBe("pusher-fallback");
      });

      it("unknown event without action field → title uses event name", () => {
        // Covers line 139: `title: body.action || event`
        // When body.action is absent, `|| event` fallback is used (event name becomes title).
        const ctx = github.parseEvent(
          { "x-github-event": "star" },
          {
            repository: { full_name: "acme/app" },
            sender: { login: "starrrrr" },
            // action intentionally omitted
          }
        );
        expect(ctx).not.toBeNull();
        expect(ctx!.event).toBe("star");
        // title should be the event name "star" since no action
        expect(ctx!.title).toBe("star");
      });

      it("matchesFilter: context.labels undefined → contextLabels defaults to []", () => {
        // Covers line 174: `const contextLabels = context.labels || []`
        // When context.labels is undefined, the filter comparison uses [].
        const ctx: any = {
          source: "github",
          event: "push",
          repo: "acme/app",
          sender: "dev",
          timestamp: new Date().toISOString(),
          // labels intentionally omitted (undefined)
        };
        // Filter requires label "bug" but context has no labels → should NOT match
        const result = github.matchesFilter(ctx, { labels: ["bug"] });
        expect(result).toBe(false);
      });

      it("matchesFilter: context.labels undefined → passes when filter has no labels", () => {
        // Covers the context.labels === undefined path via the `|| []` branch
        // but with no labels filter — so matchesFilter should still return true.
        const ctx: any = {
          source: "github",
          event: "push",
          repo: "acme/app",
          sender: "dev",
          timestamp: new Date().toISOString(),
          // labels intentionally omitted
        };
        expect(github.matchesFilter(ctx, {})).toBe(true);
      });
    });

    // ── discord.ts parseEvent() fallback branches ───────────────────────────

    describe("DiscordWebhookProvider.parseEvent() fallback branches", () => {
      const makeBase = (type: number, data?: any) => ({
        type,
        guild_id: "guild-123",
        channel_id: "channel-456",
        member: { user: { username: "user1" } },
        ...(data !== undefined ? { data } : {}),
      });

      it("APPLICATION_COMMAND without data.name → commandName defaults to 'unknown'", () => {
        // Covers line 65: `const commandName = data?.name || "unknown"`
        // When data.name is absent, "unknown" is used.
        const ctx = discord.parseEvent({}, makeBase(2, { options: [] }));
        expect(ctx).not.toBeNull();
        expect(ctx!.action).toBe("unknown");
        expect(ctx!.title).toBe("unknown");
      });

      it("MESSAGE_COMPONENT without component_type → action defaults to 'unknown'", () => {
        // Covers line 83: `action: String(data?.component_type || "unknown")`
        // When component_type is absent, "unknown" is used.
        const ctx = discord.parseEvent({}, makeBase(3, { custom_id: "btn-1" }));
        expect(ctx).not.toBeNull();
        expect(ctx!.action).toBe("unknown");
        expect(ctx!.title).toBe("btn-1");
      });

      it("MESSAGE_COMPONENT without custom_id → title defaults to 'component'", () => {
        // Covers line 84: `title: data?.custom_id || "component"`
        // When custom_id is absent, "component" is used.
        const ctx = discord.parseEvent({}, makeBase(3, { component_type: 2 }));
        expect(ctx).not.toBeNull();
        expect(ctx!.action).toBe("2");
        expect(ctx!.title).toBe("component");
      });

      it("AUTOCOMPLETE without data.name → commandName defaults to 'unknown'", () => {
        // Covers line 89: `const commandName = data?.name || "unknown"`
        // When autocomplete data has no name, "unknown" is used.
        const ctx = discord.parseEvent({}, makeBase(4, {}));
        expect(ctx).not.toBeNull();
        expect(ctx!.action).toBe("unknown");
        expect(ctx!.title).toBe("unknown");
      });

      it("MODAL_SUBMIT without custom_id → action and title default to 'modal'", () => {
        // Covers lines 100-101: `action: data?.custom_id || "modal"` and `title: data?.custom_id || "modal"`
        // When modal data has no custom_id, "modal" is used.
        const ctx = discord.parseEvent({}, makeBase(5, {}));
        expect(ctx).not.toBeNull();
        expect(ctx!.action).toBe("modal");
        expect(ctx!.title).toBe("modal");
      });
    });
  }
);
