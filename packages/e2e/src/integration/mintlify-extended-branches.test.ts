/**
 * Integration tests: webhooks/providers/mintlify.ts MintlifyWebhookProvider
 * uncovered branches — no Docker required.
 *
 * The existing discord-mintlify-webhook-provider-direct.test.ts covers the main
 * parseEvent() and matchesFilter() branches. This test covers the remaining
 * uncovered branches in extractContext() and parseEvent():
 *
 *   1. action = "failure" → conclusion:failure (alias for "failed")
 *   2. action = "success" → conclusion:success (alias for "succeeded")
 *   3. body.organization fallback for repo (when body.project absent)
 *   4. body.status as action fallback (when body.action absent)
 *   5. body.git?.branch fallback for branch (when body.branch absent)
 *   6. body.build_url fallback for url (when body.url absent)
 *   7. body.logs_url fallback for url (when body.url and body.build_url absent)
 *   8. body.message fallback for body text (when body.error absent)
 *   9. body.description fallback for body text (when body.error and body.message absent)
 *  10. matchesFilter() branches filter — matches/not-matches
 *  11. matchesFilter() actions filter when context.action absent → false
 *  12. extractContext() title default ("Build <action>" when body.title absent)
 *
 * Covers:
 *   - webhooks/providers/mintlify.ts: extractContext() action:"failure" → conclusion:failure
 *   - webhooks/providers/mintlify.ts: extractContext() action:"success" → conclusion:success
 *   - webhooks/providers/mintlify.ts: parseEvent() body.organization fallback for repo
 *   - webhooks/providers/mintlify.ts: parseEvent() body.status fallback for action
 *   - webhooks/providers/mintlify.ts: extractContext() body.git?.branch fallback for branch
 *   - webhooks/providers/mintlify.ts: extractContext() body.build_url fallback for url
 *   - webhooks/providers/mintlify.ts: extractContext() body.logs_url fallback for url
 *   - webhooks/providers/mintlify.ts: extractContext() body.message fallback for body text
 *   - webhooks/providers/mintlify.ts: extractContext() body.description fallback for body text
 *   - webhooks/providers/mintlify.ts: matchesFilter() branches filter match/mismatch
 *   - webhooks/providers/mintlify.ts: matchesFilter() actions filter with no context.action → false
 *   - webhooks/providers/mintlify.ts: extractContext() title default "Build <action>"
 */

import { describe, it, expect } from "vitest";

const { MintlifyWebhookProvider } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/providers/mintlify.js"
);

const provider = new MintlifyWebhookProvider();

// ── action:"failure" alias → conclusion:failure ──────────────────────────────

describe("MintlifyWebhookProvider.parseEvent() — action:'failure' alias", { timeout: 10_000 }, () => {
  it("conclusion:failure when action='failure' (alias for 'failed')", () => {
    const ctx = provider.parseEvent({}, {
      event: "build",
      action: "failure",
      project: "my-docs",
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.conclusion).toBe("failure");
  });

  it("conclusion:failure body includes 'Build failed' when body.error present and action='failure'", () => {
    const ctx = provider.parseEvent({}, {
      event: "build",
      action: "failure",
      project: "my-docs",
      error: "Webpack error on line 42",
    });
    expect(ctx!.conclusion).toBe("failure");
    expect(ctx!.body).toContain("Build failed");
  });
});

// ── action:"success" alias → conclusion:success ──────────────────────────────

describe("MintlifyWebhookProvider.parseEvent() — action:'success' alias", { timeout: 10_000 }, () => {
  it("conclusion:success when action='success' (alias for 'succeeded')", () => {
    const ctx = provider.parseEvent({}, {
      event: "build",
      action: "success",
      project: "my-docs",
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.conclusion).toBe("success");
  });
});

// ── body.organization fallback for repo ──────────────────────────────────────

describe("MintlifyWebhookProvider.parseEvent() — body.organization fallback", { timeout: 10_000 }, () => {
  it("uses body.organization for repo when body.project absent", () => {
    const ctx = provider.parseEvent({}, {
      event: "build",
      action: "completed",
      organization: "my-org",
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.repo).toBe("my-org");
  });

  it("prefers body.project over body.organization for repo", () => {
    const ctx = provider.parseEvent({}, {
      event: "build",
      action: "completed",
      project: "specific-project",
      organization: "org-name",
    });
    expect(ctx!.repo).toBe("specific-project");
  });

  it("uses 'unknown' when both body.project and body.organization absent", () => {
    const ctx = provider.parseEvent({}, {
      event: "build",
      action: "completed",
    });
    expect(ctx!.repo).toBe("unknown");
  });
});

// ── body.status fallback for action ──────────────────────────────────────────

describe("MintlifyWebhookProvider.parseEvent() — body.status fallback for action", { timeout: 10_000 }, () => {
  it("uses body.status as action when body.action absent", () => {
    const ctx = provider.parseEvent({}, {
      event: "build",
      status: "pending",
      project: "docs",
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.action).toBe("pending");
  });

  it("prefers body.action over body.status", () => {
    const ctx = provider.parseEvent({}, {
      event: "build",
      action: "completed",
      status: "pending",
      project: "docs",
    });
    expect(ctx!.action).toBe("completed");
  });
});

// ── body.git?.branch fallback ─────────────────────────────────────────────────

describe("MintlifyWebhookProvider.parseEvent() — body.git?.branch fallback", { timeout: 10_000 }, () => {
  it("uses body.git.branch when body.branch absent", () => {
    const ctx = provider.parseEvent({}, {
      event: "build",
      action: "completed",
      project: "docs",
      git: { branch: "feature/new-docs" },
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.branch).toBe("feature/new-docs");
  });

  it("prefers body.branch over body.git.branch", () => {
    const ctx = provider.parseEvent({}, {
      event: "build",
      action: "completed",
      project: "docs",
      branch: "main",
      git: { branch: "feature/new-docs" },
    });
    expect(ctx!.branch).toBe("main");
  });

  it("defaults branch to 'main' when both body.branch and body.git absent", () => {
    const ctx = provider.parseEvent({}, {
      event: "build",
      action: "completed",
      project: "docs",
    });
    expect(ctx!.branch).toBe("main");
  });
});

// ── URL fallback fields ───────────────────────────────────────────────────────

describe("MintlifyWebhookProvider.parseEvent() — url fallback fields", { timeout: 10_000 }, () => {
  it("uses body.build_url when body.url absent", () => {
    const ctx = provider.parseEvent({}, {
      event: "build",
      action: "completed",
      project: "docs",
      build_url: "https://build.example.com/123",
    });
    expect(ctx!.url).toBe("https://build.example.com/123");
  });

  it("uses body.logs_url when body.url and body.build_url absent", () => {
    const ctx = provider.parseEvent({}, {
      event: "build",
      action: "completed",
      project: "docs",
      logs_url: "https://logs.example.com/build-456",
    });
    expect(ctx!.url).toBe("https://logs.example.com/build-456");
  });

  it("prefers body.url over body.build_url and body.logs_url", () => {
    const ctx = provider.parseEvent({}, {
      event: "build",
      action: "completed",
      project: "docs",
      url: "https://primary.example.com",
      build_url: "https://build.example.com",
      logs_url: "https://logs.example.com",
    });
    expect(ctx!.url).toBe("https://primary.example.com");
  });
});

// ── body text fallbacks ───────────────────────────────────────────────────────

describe("MintlifyWebhookProvider.parseEvent() — body text fallback fields", { timeout: 10_000 }, () => {
  it("uses body.message when body.error absent", () => {
    const ctx = provider.parseEvent({}, {
      event: "build",
      action: "completed",
      project: "docs",
      message: "Build completed successfully",
    });
    expect(ctx!.body).toContain("Build completed");
  });

  it("uses body.description when body.error and body.message absent", () => {
    const ctx = provider.parseEvent({}, {
      event: "build",
      action: "completed",
      project: "docs",
      description: "Documentation updated for v2.0",
    });
    expect(ctx!.body).toContain("Documentation updated");
  });
});

// ── extractContext() title default ────────────────────────────────────────────

describe("MintlifyWebhookProvider.parseEvent() — title default format", { timeout: 10_000 }, () => {
  it("defaults title to 'Build <action>' when body.title absent", () => {
    const ctx = provider.parseEvent({}, {
      event: "build",
      action: "queued",
      project: "docs",
    });
    expect(ctx!.title).toBe("Build queued");
  });
});

// ── matchesFilter() branches filter ──────────────────────────────────────────

describe("MintlifyWebhookProvider.matchesFilter() — branches filter", { timeout: 10_000 }, () => {
  const ctxWithBranch = {
    source: "mintlify",
    event: "build",
    action: "completed",
    repo: "my-docs",
    sender: "mintlify",
    branch: "main",
    timestamp: new Date().toISOString(),
  } as any;

  it("matches when branches filter includes context.branch", () => {
    expect(provider.matchesFilter(ctxWithBranch, { branches: ["main"] } as any)).toBe(true);
  });

  it("does not match when branches filter excludes context.branch", () => {
    expect(provider.matchesFilter(ctxWithBranch, { branches: ["develop"] } as any)).toBe(false);
  });

  it("passes when context.branch is undefined even with branches filter", () => {
    const ctxNoBranch = { ...ctxWithBranch, branch: undefined };
    expect(provider.matchesFilter(ctxNoBranch, { branches: ["main"] } as any)).toBe(true);
  });
});

// ── matchesFilter() actions filter with no context.action → false ─────────────

describe("MintlifyWebhookProvider.matchesFilter() — actions filter with no action", { timeout: 10_000 }, () => {
  it("returns false when filter.actions set but context.action absent", () => {
    const ctxNoAction = {
      source: "mintlify",
      event: "build",
      action: undefined,
      repo: "docs",
      sender: "mintlify",
      timestamp: new Date().toISOString(),
    } as any;
    expect(provider.matchesFilter(ctxNoAction, { actions: ["completed"] } as any)).toBe(false);
  });
});
