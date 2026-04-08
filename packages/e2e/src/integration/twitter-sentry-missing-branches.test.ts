/**
 * Integration tests: TwitterWebhookProvider.parseEvent() uncovered branches
 * and SentryWebhookProvider.parseEvent() 'comment' resource — no Docker required.
 *
 * The existing twitter-webhook-provider-direct.test.ts covers: null body,
 * no event array key, tweet_create_events, favorite_events, follow_events,
 * and direct_message_events.
 *
 * The existing linear-sentry-webhook-provider-direct.test.ts covers: event_alert,
 * metric_alert, issue, error, and default branch.
 *
 * This test covers the remaining uncovered branches:
 *
 * Twitter:
 *   - tweet_delete_events → event:tweet_delete_events action:delete, title has tweet ID
 *   - unfollow_events → event:unfollow_events, title has "unfollowed"
 *   - block_events → event:block_events, title has "blocked"
 *   - unblock_events → event:unblock_events, title has "unblocked"
 *   - mute_events → event:mute_events, title has "muted"
 *   - unmute_events → event:unmute_events, title has "unmuted"
 *   - direct_message_indicate_typing_events → event:..., title has "Typing indicator"
 *   - direct_message_mark_read_events → event:..., title has "Message read"
 *   - unknown event key (default branch) → title = eventKey
 *   - firstEvent null (empty array) → base context without extractContext
 *
 * Sentry:
 *   - comment resource → event:comment, title from issue, comment from comment.text
 *
 * Covers:
 *   - webhooks/providers/twitter.ts: parseEvent() tweet_delete_events branch
 *   - webhooks/providers/twitter.ts: parseEvent() unfollow_events branch
 *   - webhooks/providers/twitter.ts: parseEvent() block_events branch
 *   - webhooks/providers/twitter.ts: parseEvent() unblock_events branch
 *   - webhooks/providers/twitter.ts: parseEvent() mute_events branch
 *   - webhooks/providers/twitter.ts: parseEvent() unmute_events branch
 *   - webhooks/providers/twitter.ts: parseEvent() direct_message_indicate_typing_events branch
 *   - webhooks/providers/twitter.ts: parseEvent() direct_message_mark_read_events branch
 *   - webhooks/providers/twitter.ts: extractContext() default branch (unknown eventKey)
 *   - webhooks/providers/twitter.ts: parseEvent() empty events array → base context returned
 *   - webhooks/providers/sentry.ts: parseEvent() comment resource → comment+issue context
 */

import { describe, it, expect } from "vitest";

const { TwitterWebhookProvider } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/providers/twitter.js"
);

const { SentryWebhookProvider } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/providers/sentry.js"
);

const twitterProvider = new TwitterWebhookProvider();
const sentryProvider = new SentryWebhookProvider();

/** Build a Twitter event payload with one event item. */
function twitterPayload(eventKey: string, event: Record<string, any>) {
  return { for_user_id: "user123", [eventKey]: [event] };
}

// ── tweet_delete_events ───────────────────────────────────────────────────────

describe("TwitterWebhookProvider.parseEvent() — tweet_delete_events", { timeout: 10_000 }, () => {
  it("returns event:tweet_delete_events action:delete", () => {
    const ctx = twitterProvider.parseEvent({}, twitterPayload("tweet_delete_events", {
      status: { id: "987654" },
      user_id: "user123",
      timestamp_ms: "1700000000000",
    }));
    expect(ctx).not.toBeNull();
    expect(ctx!.event).toBe("tweet_delete_events");
    expect(ctx!.action).toBe("delete");
  });

  it("title includes deleted tweet ID", () => {
    const ctx = twitterProvider.parseEvent({}, twitterPayload("tweet_delete_events", {
      status: { id: "987654" },
      user_id: "user-abc",
    }));
    expect(ctx!.title).toContain("987654");
  });

  it("sender uses user_id field", () => {
    const ctx = twitterProvider.parseEvent({}, twitterPayload("tweet_delete_events", {
      status: { id: "1" },
      user_id: "user-xyz",
    }));
    expect(ctx!.sender).toBe("user-xyz");
  });
});

// ── unfollow_events ───────────────────────────────────────────────────────────

describe("TwitterWebhookProvider.parseEvent() — unfollow_events", { timeout: 10_000 }, () => {
  it("returns event:unfollow_events", () => {
    const ctx = twitterProvider.parseEvent({}, twitterPayload("unfollow_events", {
      source: { screen_name: "follower" },
      target: { screen_name: "target-user" },
      created_timestamp: "1700000000000",
    }));
    expect(ctx).not.toBeNull();
    expect(ctx!.event).toBe("unfollow_events");
  });

  it("title contains 'unfollowed'", () => {
    const ctx = twitterProvider.parseEvent({}, twitterPayload("unfollow_events", {
      source: { screen_name: "follower" },
      target: { screen_name: "target" },
    }));
    expect(ctx!.title).toContain("unfollowed");
  });
});

// ── block_events ──────────────────────────────────────────────────────────────

describe("TwitterWebhookProvider.parseEvent() — block_events", { timeout: 10_000 }, () => {
  it("returns event:block_events", () => {
    const ctx = twitterProvider.parseEvent({}, twitterPayload("block_events", {
      source: { screen_name: "user1" },
      target: { screen_name: "user2" },
      created_timestamp: "1700000000000",
    }));
    expect(ctx).not.toBeNull();
    expect(ctx!.event).toBe("block_events");
  });

  it("title contains 'blocked'", () => {
    const ctx = twitterProvider.parseEvent({}, twitterPayload("block_events", {
      source: { screen_name: "blocker" },
      target: { screen_name: "blocked-user" },
    }));
    expect(ctx!.title).toContain("blocked");
  });
});

// ── unblock_events ────────────────────────────────────────────────────────────

describe("TwitterWebhookProvider.parseEvent() — unblock_events", { timeout: 10_000 }, () => {
  it("returns event:unblock_events", () => {
    const ctx = twitterProvider.parseEvent({}, twitterPayload("unblock_events", {
      source: { screen_name: "user1" },
      target: { screen_name: "user2" },
    }));
    expect(ctx).not.toBeNull();
    expect(ctx!.event).toBe("unblock_events");
  });

  it("title contains 'unblocked'", () => {
    const ctx = twitterProvider.parseEvent({}, twitterPayload("unblock_events", {
      source: { screen_name: "user1" },
      target: { screen_name: "user2" },
    }));
    expect(ctx!.title).toContain("unblocked");
  });
});

// ── mute_events ───────────────────────────────────────────────────────────────

describe("TwitterWebhookProvider.parseEvent() — mute_events", { timeout: 10_000 }, () => {
  it("returns event:mute_events", () => {
    const ctx = twitterProvider.parseEvent({}, twitterPayload("mute_events", {
      source: { screen_name: "muter" },
      target: { screen_name: "muted" },
    }));
    expect(ctx).not.toBeNull();
    expect(ctx!.event).toBe("mute_events");
  });

  it("title contains 'muted'", () => {
    const ctx = twitterProvider.parseEvent({}, twitterPayload("mute_events", {
      source: { screen_name: "muter" },
      target: { screen_name: "muted-user" },
    }));
    expect(ctx!.title).toContain("muted");
  });
});

// ── unmute_events ─────────────────────────────────────────────────────────────

describe("TwitterWebhookProvider.parseEvent() — unmute_events", { timeout: 10_000 }, () => {
  it("returns event:unmute_events", () => {
    const ctx = twitterProvider.parseEvent({}, twitterPayload("unmute_events", {
      source: { screen_name: "user" },
      target: { screen_name: "other" },
    }));
    expect(ctx).not.toBeNull();
    expect(ctx!.event).toBe("unmute_events");
  });

  it("title contains 'unmuted'", () => {
    const ctx = twitterProvider.parseEvent({}, twitterPayload("unmute_events", {
      source: { screen_name: "user" },
      target: { screen_name: "other" },
    }));
    expect(ctx!.title).toContain("unmuted");
  });
});

// ── direct_message_indicate_typing_events ────────────────────────────────────

describe("TwitterWebhookProvider.parseEvent() — direct_message_indicate_typing_events", { timeout: 10_000 }, () => {
  it("returns event:direct_message_indicate_typing_events", () => {
    const ctx = twitterProvider.parseEvent({}, twitterPayload("direct_message_indicate_typing_events", {
      sender_id: "typist-123",
      created_timestamp: "1700000000000",
    }));
    expect(ctx).not.toBeNull();
    expect(ctx!.event).toBe("direct_message_indicate_typing_events");
  });

  it("title contains 'Typing indicator'", () => {
    const ctx = twitterProvider.parseEvent({}, twitterPayload("direct_message_indicate_typing_events", {
      sender_id: "typist-123",
    }));
    expect(ctx!.title).toContain("Typing indicator");
  });

  it("sender equals sender_id", () => {
    const ctx = twitterProvider.parseEvent({}, twitterPayload("direct_message_indicate_typing_events", {
      sender_id: "user-456",
    }));
    expect(ctx!.sender).toBe("user-456");
  });
});

// ── direct_message_mark_read_events ──────────────────────────────────────────

describe("TwitterWebhookProvider.parseEvent() — direct_message_mark_read_events", { timeout: 10_000 }, () => {
  it("returns event:direct_message_mark_read_events", () => {
    const ctx = twitterProvider.parseEvent({}, twitterPayload("direct_message_mark_read_events", {
      sender_id: "reader-789",
      created_timestamp: "1700000000000",
    }));
    expect(ctx).not.toBeNull();
    expect(ctx!.event).toBe("direct_message_mark_read_events");
  });

  it("title contains 'Message read'", () => {
    const ctx = twitterProvider.parseEvent({}, twitterPayload("direct_message_mark_read_events", {
      sender_id: "reader-789",
    }));
    expect(ctx!.title).toContain("Message read");
  });
});

// ── default (unknown event key) ───────────────────────────────────────────────

describe("TwitterWebhookProvider.parseEvent() — default/unknown event key", { timeout: 10_000 }, () => {
  it("returns context with title=eventKey for unknown event type", () => {
    const ctx = twitterProvider.parseEvent({}, twitterPayload("some_future_events", {
      data: "value",
    }));
    expect(ctx).not.toBeNull();
    // In extractContext default branch, title = eventKey
    expect(ctx!.event).toBe("some_future_events");
    expect(ctx!.title).toBe("some_future_events");
  });
});

// ── empty events array (firstEvent=null path) ─────────────────────────────────

describe("TwitterWebhookProvider.parseEvent() — empty events array", { timeout: 10_000 }, () => {
  it("returns base context when events array is empty (firstEvent=null skips extractContext)", () => {
    // Empty array → firstEvent is null → return base without extractContext
    const ctx = twitterProvider.parseEvent({}, {
      for_user_id: "user123",
      tweet_create_events: [],
    });
    expect(ctx).not.toBeNull();
    // Should have the base fields
    expect(ctx!.event).toBe("tweet_create_events");
    expect(ctx!.action).toBe("create");
    // sender will be "unknown" since extractContext wasn't called
    expect(ctx!.sender).toBe("unknown");
  });
});

// ── Sentry: comment resource ──────────────────────────────────────────────────

describe("SentryWebhookProvider.parseEvent() — comment resource", { timeout: 10_000 }, () => {
  it("parses comment resource → event:comment", () => {
    const headers = { "sentry-hook-resource": "comment" };
    const body = {
      action: "created",
      actor: { name: "dev" },
      data: {
        comment: { text: "This needs attention", author: "alice" },
        issue: {
          title: "TypeError in handler",
          web_url: "https://sentry.io/issues/42",
          project: { slug: "my-service" },
        },
      },
    };
    const ctx = sentryProvider.parseEvent(headers, body);
    expect(ctx).not.toBeNull();
    expect(ctx!.event).toBe("comment");
    expect(ctx!.action).toBe("created");
  });

  it("comment resource: repo uses issue.project.slug", () => {
    const headers = { "sentry-hook-resource": "comment" };
    const body = {
      action: "created",
      actor: { name: "dev" },
      data: {
        comment: { text: "LGTM" },
        issue: {
          title: "Error",
          web_url: "https://sentry.io/issues/1",
          project: { slug: "backend-service" },
        },
      },
    };
    const ctx = sentryProvider.parseEvent(headers, body);
    expect(ctx!.repo).toBe("backend-service");
  });

  it("comment resource: comment field set from comment.text", () => {
    const headers = { "sentry-hook-resource": "comment" };
    const body = {
      action: "created",
      actor: { name: "dev" },
      data: {
        comment: { text: "Please investigate this issue" },
        issue: {
          title: "Exception in main",
          web_url: "https://sentry.io/issues/7",
          project: { slug: "api" },
        },
      },
    };
    const ctx = sentryProvider.parseEvent(headers, body);
    expect(ctx!.comment).toContain("Please investigate");
  });

  it("comment resource: title from issue.title", () => {
    const headers = { "sentry-hook-resource": "comment" };
    const body = {
      action: "created",
      actor: { name: "dev" },
      data: {
        comment: { text: "ok" },
        issue: {
          title: "NullPointerException",
          web_url: "https://sentry.io/issues/100",
          project: { slug: "myapp" },
        },
      },
    };
    const ctx = sentryProvider.parseEvent(headers, body);
    expect(ctx!.title).toContain("NullPointerException");
  });

  it("comment resource: url from issue.web_url", () => {
    const headers = { "sentry-hook-resource": "comment" };
    const body = {
      action: "created",
      actor: { name: "dev" },
      data: {
        comment: { text: "ok" },
        issue: {
          title: "Error",
          web_url: "https://sentry.io/issues/999",
          project: { slug: "myapp" },
        },
      },
    };
    const ctx = sentryProvider.parseEvent(headers, body);
    expect(ctx!.url).toBe("https://sentry.io/issues/999");
  });
});
