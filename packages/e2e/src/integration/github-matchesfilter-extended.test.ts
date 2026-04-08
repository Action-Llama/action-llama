/**
 * Integration tests: webhooks/providers/github.ts GitHubWebhookProvider.matchesFilter()
 * uncovered branches — no Docker required.
 *
 * The existing github-webhook-provider-direct.test.ts covers repos/events/actions/labels/branches.
 * This test covers the remaining matchesFilter() branches:
 *   1. f.actions filter with context.action=undefined → returns false (no-action skip)
 *   2. f.org filter: context.repo org matches → true
 *   3. f.org filter: context.repo org does not match → false
 *   4. f.orgs filter: context.repo org in orgs array → true
 *   5. f.orgs filter: context.repo org not in orgs array → false
 *   6. f.org + f.orgs combined: either matches → true
 *   7. f.assignee filter: context.assignee matches → true
 *   8. f.assignee filter: context.assignee doesn't match → false
 *   9. f.assignee filter: context.assignee undefined, filter non-null → false
 *  10. f.author filter: context.author matches → true
 *  11. f.author filter: context.author doesn't match → false
 *  12. branches filter with no context.branch → passes through (allow all events without branch)
 *
 * Covers:
 *   - webhooks/providers/github.ts: matchesFilter() f.actions && !context.action → false
 *   - webhooks/providers/github.ts: matchesFilter() f.org — matching/non-matching org
 *   - webhooks/providers/github.ts: matchesFilter() f.orgs array — matching/non-matching
 *   - webhooks/providers/github.ts: matchesFilter() f.org + f.orgs combined
 *   - webhooks/providers/github.ts: matchesFilter() f.assignee — matching/non-matching/undefined
 *   - webhooks/providers/github.ts: matchesFilter() f.author — matching/non-matching
 *   - webhooks/providers/github.ts: matchesFilter() branches filter with no branch in context
 */

import { describe, it, expect } from "vitest";

const { GitHubWebhookProvider } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/providers/github.js"
);

const provider = new GitHubWebhookProvider();

/** Minimal WebhookContext for matchesFilter tests. */
function makeCtx(overrides: Record<string, any> = {}) {
  return {
    source: "github",
    event: "issues",
    action: "opened",
    repo: "acme/my-repo",
    sender: "user1",
    labels: ["bug"],
    branch: "main",
    author: "dev-user",
    assignee: "reviewer-user",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ── actions filter with no action in context ─────────────────────────────────

describe("GitHubWebhookProvider.matchesFilter() — actions with no context.action", { timeout: 10_000 }, () => {
  it("returns false when filter.actions is set but context has no action", () => {
    // An issue labeled event may have no action in some cases
    const ctx = makeCtx({ action: undefined });
    expect(provider.matchesFilter(ctx, { actions: ["opened"] })).toBe(false);
  });

  it("returns false when context.action is null and filter has actions", () => {
    const ctx = makeCtx({ action: null });
    expect(provider.matchesFilter(ctx, { actions: ["opened"] })).toBe(false);
  });

  it("passes when no actions filter and context has no action", () => {
    const ctx = makeCtx({ action: undefined });
    // No actions filter — should not reject
    expect(provider.matchesFilter(ctx, { events: ["issues"] })).toBe(true);
  });
});

// ── org filter (string) ──────────────────────────────────────────────────────

describe("GitHubWebhookProvider.matchesFilter() — org filter (string)", { timeout: 10_000 }, () => {
  it("matches when context.repo org matches f.org", () => {
    const ctx = makeCtx({ repo: "acme/my-repo" });
    expect(provider.matchesFilter(ctx, { org: "acme" })).toBe(true);
  });

  it("does not match when context.repo org does not match f.org", () => {
    const ctx = makeCtx({ repo: "acme/my-repo" });
    expect(provider.matchesFilter(ctx, { org: "other-org" })).toBe(false);
  });

  it("org filter uses first segment before '/'", () => {
    const ctx = makeCtx({ repo: "my-company/service-api" });
    expect(provider.matchesFilter(ctx, { org: "my-company" })).toBe(true);
  });
});

// ── orgs filter (array) ──────────────────────────────────────────────────────

describe("GitHubWebhookProvider.matchesFilter() — orgs filter (array)", { timeout: 10_000 }, () => {
  it("matches when context.repo org is in f.orgs array", () => {
    const ctx = makeCtx({ repo: "acme/my-repo" });
    expect(provider.matchesFilter(ctx, { orgs: ["other-org", "acme"] })).toBe(true);
  });

  it("does not match when context.repo org is not in f.orgs array", () => {
    const ctx = makeCtx({ repo: "acme/my-repo" });
    expect(provider.matchesFilter(ctx, { orgs: ["third-party", "vendor"] })).toBe(false);
  });

  it("matches when first org in orgs array matches", () => {
    const ctx = makeCtx({ repo: "acme/my-repo" });
    expect(provider.matchesFilter(ctx, { orgs: ["acme", "other"] })).toBe(true);
  });
});

// ── org + orgs combined ───────────────────────────────────────────────────────

describe("GitHubWebhookProvider.matchesFilter() — org + orgs combined", { timeout: 10_000 }, () => {
  it("matches when f.org matches (ignoring empty orgs)", () => {
    const ctx = makeCtx({ repo: "acme/repo" });
    // f.org="acme", f.orgs=[] — combined orgs=["acme"] → matches
    expect(provider.matchesFilter(ctx, { org: "acme", orgs: [] })).toBe(true);
  });

  it("matches when f.orgs contains matching org (f.org does not match alone)", () => {
    const ctx = makeCtx({ repo: "acme/repo" });
    // f.org="other", f.orgs=["acme"] — combined orgs=["other","acme"] → matches
    expect(provider.matchesFilter(ctx, { org: "other", orgs: ["acme"] })).toBe(true);
  });

  it("does not match when neither f.org nor f.orgs match", () => {
    const ctx = makeCtx({ repo: "acme/repo" });
    expect(provider.matchesFilter(ctx, { org: "foo", orgs: ["bar", "baz"] })).toBe(false);
  });
});

// ── assignee filter ──────────────────────────────────────────────────────────

describe("GitHubWebhookProvider.matchesFilter() — assignee filter", { timeout: 10_000 }, () => {
  it("matches when context.assignee equals f.assignee", () => {
    const ctx = makeCtx({ assignee: "reviewer-user" });
    expect(provider.matchesFilter(ctx, { assignee: "reviewer-user" })).toBe(true);
  });

  it("does not match when context.assignee is different", () => {
    const ctx = makeCtx({ assignee: "other-user" });
    expect(provider.matchesFilter(ctx, { assignee: "reviewer-user" })).toBe(false);
  });

  it("does not match when context.assignee is undefined and filter is set", () => {
    const ctx = makeCtx({ assignee: undefined });
    expect(provider.matchesFilter(ctx, { assignee: "reviewer-user" })).toBe(false);
  });

  it("passes when no assignee filter regardless of context.assignee", () => {
    const ctx = makeCtx({ assignee: "anyone" });
    expect(provider.matchesFilter(ctx, { events: ["issues"] })).toBe(true);
  });
});

// ── author filter ────────────────────────────────────────────────────────────

describe("GitHubWebhookProvider.matchesFilter() — author filter", { timeout: 10_000 }, () => {
  it("matches when context.author equals f.author", () => {
    const ctx = makeCtx({ author: "bot-user" });
    expect(provider.matchesFilter(ctx, { author: "bot-user" })).toBe(true);
  });

  it("does not match when context.author is different", () => {
    const ctx = makeCtx({ author: "human-user" });
    expect(provider.matchesFilter(ctx, { author: "bot-user" })).toBe(false);
  });

  it("does not match when context.author is undefined and filter is set", () => {
    const ctx = makeCtx({ author: undefined });
    expect(provider.matchesFilter(ctx, { author: "bot-user" })).toBe(false);
  });
});

// ── branches filter pass-through when no branch in context ───────────────────

describe("GitHubWebhookProvider.matchesFilter() — branches filter with no branch", { timeout: 10_000 }, () => {
  it("passes when context has no branch (e.g. issue event) even with branches filter", () => {
    // Issues don't have a branch — should still match the agent
    const ctx = makeCtx({ branch: undefined });
    expect(provider.matchesFilter(ctx, { branches: ["main"], events: ["issues"] })).toBe(true);
  });

  it("passes when context.branch is null and filter has branches", () => {
    const ctx = makeCtx({ branch: null });
    expect(provider.matchesFilter(ctx, { branches: ["main"] })).toBe(true);
  });
});
