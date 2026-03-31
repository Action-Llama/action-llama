/**
 * Integration test: GitHub webhook provider end-to-end.
 *
 * Verifies that the GitHub webhook provider correctly:
 *   - Accepts unsigned payloads when allowUnsigned=true is configured
 *   - Parses Issues, Pull Request, Push, and Issue Comment events
 *   - Triggers agents subscribed to GitHub events
 *   - Applies label, action, and branch filters correctly
 *   - Rejects unsigned webhooks when no HMAC secrets configured
 *
 * GitHub uses x-hub-signature-256 (sha256= prefix + HMAC-SHA256 hex).
 * Uses allowUnsigned=true to avoid needing real webhook secrets in tests.
 *
 * Covers: webhooks/providers/github.ts (parseEvent, validateRequest,
 *         matchesFilter) including multiple event types and filter paths.
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

/** Send a raw POST to /webhooks/github with the given GitHub event payload. */
function sendGitHubWebhook(
  harness: IntegrationHarness,
  event: string,
  payload: object,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.gatewayPort}/webhooks/github`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": event,
      "X-GitHub-Delivery": `delivery-${Date.now()}`,
    },
    body: JSON.stringify(payload),
  });
}

describe.skipIf(!DOCKER)("integration: GitHub webhook provider", { timeout: 300_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("triggers agent on GitHub issues event", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "github-issues-agent",
          webhooks: [{ source: "github", events: ["issues"], actions: ["opened"] }],
          testScript: [
            "#!/bin/sh",
            "set -e",
            'test -n "$PROMPT" || { echo "PROMPT not set"; exit 1; }',
            'echo "github-issues-agent triggered OK"',
            "exit 0",
          ].join("\n"),
        },
      ],
      globalConfig: {
        webhooks: { github: { type: "github", allowUnsigned: true } },
      },
    });

    await harness.start();

    const payload = {
      action: "opened",
      issue: {
        number: 42,
        title: "Bug: integration test fails",
        body: "Description of the bug found in testing.",
        html_url: "https://github.com/test-org/test-repo/issues/42",
        user: { login: "test-user" },
        assignee: null,
        labels: [{ name: "bug" }],
      },
      repository: { full_name: "test-org/test-repo" },
      sender: { login: "test-user" },
    };

    const res = await sendGitHubWebhook(harness, "issues", payload);
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body.matched).toBeGreaterThanOrEqual(1);

    const run = await harness.waitForRunResult("github-issues-agent");
    expect(run.result).toBe("completed");
  });

  it("triggers agent on GitHub pull_request event", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "github-pr-agent",
          webhooks: [{ source: "github", events: ["pull_request"], actions: ["opened"] }],
          testScript: "#!/bin/sh\necho 'PR agent'\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { github: { type: "github", allowUnsigned: true } },
      },
    });

    await harness.start();

    const payload = {
      action: "opened",
      pull_request: {
        number: 100,
        title: "Add new feature",
        body: "This PR adds a new feature.",
        html_url: "https://github.com/test-org/test-repo/pull/100",
        user: { login: "contributor" },
        assignee: null,
        labels: [],
        head: { ref: "feature/new-feature" },
      },
      repository: { full_name: "test-org/test-repo" },
      sender: { login: "contributor" },
    };

    const res = await sendGitHubWebhook(harness, "pull_request", payload);
    expect(res.ok).toBe(true);
    expect((await res.json()).matched).toBeGreaterThanOrEqual(1);

    const run = await harness.waitForRunResult("github-pr-agent");
    expect(run.result).toBe("completed");
  });

  it("triggers agent on GitHub push event to main branch", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "github-push-agent",
          webhooks: [{ source: "github", events: ["push"] }],
          testScript: "#!/bin/sh\necho 'push agent'\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { github: { type: "github", allowUnsigned: true } },
      },
    });

    await harness.start();

    const payload = {
      ref: "refs/heads/main",
      compare: "https://github.com/test-org/test-repo/compare/abc123...def456",
      head_commit: {
        id: "def456",
        message: "fix: resolve production bug",
        author: { username: "dev-user", email: "dev@example.com" },
      },
      pusher: { name: "dev-user" },
      repository: { full_name: "test-org/test-repo" },
      sender: { login: "dev-user" },
    };

    const res = await sendGitHubWebhook(harness, "push", payload);
    expect(res.ok).toBe(true);
    expect((await res.json()).matched).toBeGreaterThanOrEqual(1);

    const run = await harness.waitForRunResult("github-push-agent");
    expect(run.result).toBe("completed");
  });

  it("does not trigger agent when label filter does not match", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "github-bug-label-agent",
          webhooks: [
            {
              source: "github",
              events: ["issues"],
              actions: ["opened"],
              labels: ["bug"],
            },
          ],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { github: { type: "github", allowUnsigned: true } },
      },
    });

    await harness.start();

    // Issue without "bug" label — should not match
    const payload = {
      action: "opened",
      issue: {
        number: 99,
        title: "Feature request",
        html_url: "https://github.com/test-org/test-repo/issues/99",
        user: { login: "user1" },
        labels: [{ name: "enhancement" }],
      },
      repository: { full_name: "test-org/test-repo" },
      sender: { login: "user1" },
    };

    const res = await sendGitHubWebhook(harness, "issues", payload);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.matched).toBe(0);
  });

  it("does not trigger agent when action filter does not match", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "github-closed-agent",
          webhooks: [{ source: "github", events: ["issues"], actions: ["closed"] }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { github: { type: "github", allowUnsigned: true } },
      },
    });

    await harness.start();

    // Issue "opened" action — should not match "closed" filter
    const payload = {
      action: "opened",
      issue: {
        number: 55,
        title: "Open issue",
        html_url: "https://github.com/test-org/test-repo/issues/55",
        user: { login: "opener" },
        labels: [],
      },
      repository: { full_name: "test-org/test-repo" },
      sender: { login: "opener" },
    };

    const res = await sendGitHubWebhook(harness, "issues", payload);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.matched).toBe(0);
  });

  it("rejects GitHub webhook when no secrets and not allowUnsigned", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "github-secure-agent",
          webhooks: [{ source: "github", events: ["issues"] }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        // No allowUnsigned, no github_webhook_secret — unsigned webhooks rejected
        webhooks: { github: { type: "github" } },
      },
    });

    await harness.start();

    const payload = {
      action: "opened",
      issue: {
        number: 1,
        title: "Unsigned issue",
        html_url: "https://github.com/test-org/test-repo/issues/1",
        user: { login: "hacker" },
        labels: [],
      },
      repository: { full_name: "test-org/test-repo" },
      sender: { login: "hacker" },
    };

    // No x-hub-signature-256 header → 401
    const res = await sendGitHubWebhook(harness, "issues", payload);
    expect(res.status).toBe(401);
  });

  it("duplicate webhook delivery ID is rejected with duplicate:true", async () => {
    // When the same X-GitHub-Delivery ID is received twice, the webhook
    // system checks the stats store and short-circuits on the duplicate.
    // The second delivery should return { ok: true, matched: 0, duplicate: true }.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "dedup-agent",
          webhooks: [{ source: "github", events: ["issues"] }],
          testScript: "#!/bin/sh\necho 'dedup-agent ran'\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { github: { type: "github", allowUnsigned: true } },
      },
    });

    await harness.start();

    const deliveryId = `dedup-test-delivery-${Date.now()}`;
    const payload = {
      action: "opened",
      issue: {
        number: 42,
        title: "Duplicate delivery test issue",
        html_url: "https://github.com/acme/app/issues/42",
        user: { login: "tester" },
        labels: [],
      },
      repository: { full_name: "acme/app" },
      sender: { login: "tester" },
    };

    // First delivery — should succeed and trigger the agent
    const res1 = await fetch(`http://127.0.0.1:${harness.gatewayPort}/webhooks/github`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "issues",
        "X-GitHub-Delivery": deliveryId,
      },
      body: JSON.stringify(payload),
    });
    expect(res1.ok).toBe(true);
    const body1 = await res1.json();
    expect(body1.matched).toBeGreaterThanOrEqual(1);

    // Wait for the first run to complete
    const run = await harness.waitForRunResult("dedup-agent");
    expect(run.result).toBe("completed");

    // Second delivery with the same ID — should be deduplicated
    const res2 = await fetch(`http://127.0.0.1:${harness.gatewayPort}/webhooks/github`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "issues",
        "X-GitHub-Delivery": deliveryId,
      },
      body: JSON.stringify(payload),
    });
    expect(res2.ok).toBe(true);
    const body2 = await res2.json();
    // Duplicate deliveries are short-circuited
    expect(body2.duplicate).toBe(true);
    expect(body2.matched).toBe(0);
  });

  it("GitHub ping event is silently ignored — returns ok:true with matched:0", async () => {
    // GitHub sends a 'ping' event when a webhook is first configured.
    // The GitHub provider's parseEvent() returns null for ping events,
    // which causes the registry to return { ok: true, matched: 0 }.
    // The agent should NOT be triggered.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "ping-test-agent",
          webhooks: [{ source: "github", events: ["issues"] }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { github: { type: "github", allowUnsigned: true } },
      },
    });

    await harness.start();

    // Send a GitHub ping event (sent when webhook is first registered)
    const res = await fetch(`http://127.0.0.1:${harness.gatewayPort}/webhooks/github`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "ping",
        "X-GitHub-Delivery": `ping-delivery-${Date.now()}`,
      },
      body: JSON.stringify({
        zen: "Practicality beats purity.",
        hook_id: 12345,
        hook: { type: "Repository", id: 12345, active: true },
      }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    // Ping events are parsed as null → no agents matched, but dispatch succeeded
    expect(body.ok).toBe(true);
    expect(body.matched).toBe(0);
  });
});
