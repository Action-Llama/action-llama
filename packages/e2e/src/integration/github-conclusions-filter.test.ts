/**
 * Integration tests: GitHub webhook conclusions filter.
 *
 * The `conclusions` field was added to WebhookTrigger (commit 779557b0) to let
 * agents filter GitHub `workflow_run` events by their conclusion (e.g. "success",
 * "failure", "cancelled"). The code path:
 *
 *   config.toml webhooks[].conclusions → loadAgentConfig → buildFilterFromTrigger
 *   → WebhookFilter.conclusions → GitHubWebhookProvider.matchesFilter
 *   → registry dispatch matched/skipped count
 *
 * Part 1 (no Docker required):
 *   Tests buildFilterFromTrigger() and GitHubWebhookProvider.matchesFilter()
 *   directly against the built JS dist, similar to other unit-style integration tests.
 *
 * Part 2 (Docker required):
 *   Tests the full gateway webhook dispatch flow: the conclusions filter is applied
 *   when POST /webhooks/github is received. The `matched` count in the response
 *   reflects whether the filter passed.
 *
 * Covers:
 *   - events/webhook-setup.ts: buildFilterFromTrigger() conclusions field mapping (779557b0)
 *   - webhooks/providers/github.ts: matchesFilter() conclusions filter
 *   - shared/config/types.ts: WebhookTrigger.conclusions field preserved through TOML serialization
 *   - webhooks/types.ts: VALID_TRIGGER_FIELDS github set includes "conclusions" (779557b0)
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

// ── Part 1: Direct function tests (no Docker required) ──────────────────────

const { buildFilterFromTrigger } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/events/webhook-setup.js"
);

const { GitHubWebhookProvider } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/providers/github.js"
);

describe("integration: buildFilterFromTrigger conclusions field (no Docker required)", () => {
  it("maps trigger.conclusions to filter.conclusions for github provider", () => {
    const filter = buildFilterFromTrigger(
      { source: "github", events: ["workflow_run"], conclusions: ["success", "failure"] },
      "github",
    ) as any;
    expect(filter).toBeDefined();
    expect(filter.events).toEqual(["workflow_run"]);
    expect(filter.conclusions).toEqual(["success", "failure"]);
  });

  it("returns filter without conclusions when trigger has no conclusions", () => {
    const filter = buildFilterFromTrigger(
      { source: "github", events: ["workflow_run"] },
      "github",
    ) as any;
    expect(filter).toBeDefined();
    expect(filter.conclusions).toBeUndefined();
  });

  it("returns undefined filter when trigger has only source (no fields)", () => {
    const filter = buildFilterFromTrigger({ source: "github" }, "github");
    expect(filter).toBeUndefined();
  });

  it("does not add conclusions to non-github providers (sentry has no conclusions field)", () => {
    const filter = buildFilterFromTrigger(
      { source: "sentry", conclusions: ["success"] } as any,
      "sentry",
    ) as any;
    // Sentry filter only supports resources — conclusions not mapped
    expect(filter).toBeUndefined(); // no resources → undefined
  });
});

describe("integration: GitHubWebhookProvider.matchesFilter conclusions (no Docker required)", () => {
  const provider = new GitHubWebhookProvider();

  function workflowContext(conclusion: string | null) {
    return {
      source: "github",
      event: "workflow_run",
      action: "completed",
      repo: "acme/app",
      sender: "dev-user",
      timestamp: new Date().toISOString(),
      conclusion: conclusion ?? undefined,
    };
  }

  it("matches when context.conclusion is in filter.conclusions", () => {
    const ctx = workflowContext("success");
    const filter = { conclusions: ["success", "failure"] };
    expect(provider.matchesFilter(ctx as any, filter as any)).toBe(true);
  });

  it("does not match when context.conclusion is NOT in filter.conclusions", () => {
    const ctx = workflowContext("cancelled");
    const filter = { conclusions: ["success", "failure"] };
    expect(provider.matchesFilter(ctx as any, filter as any)).toBe(false);
  });

  it("passes through when context has no conclusion (conclusion filter skipped)", () => {
    // The matchesFilter logic: `if (f.conclusions?.length && context.conclusion && ...)`.
    // When context.conclusion is falsy, the second condition is false → filter skipped → passes.
    const ctx = workflowContext(null);
    const filter = { conclusions: ["success"] };
    expect(provider.matchesFilter(ctx as any, filter as any)).toBe(true);
  });

  it("passes through when filter has no conclusions (empty conclusions array)", () => {
    const ctx = workflowContext("failure");
    const filter = { conclusions: [] };
    expect(provider.matchesFilter(ctx as any, filter as any)).toBe(true);
  });

  it("passes through when filter has no conclusions key at all", () => {
    const ctx = workflowContext("failure");
    const filter = { events: ["workflow_run"] };
    expect(provider.matchesFilter(ctx as any, filter as any)).toBe(true);
  });

  it("works with single-item conclusions filter matching exactly", () => {
    const ctx = workflowContext("failure");
    const filter = { conclusions: ["failure"] };
    expect(provider.matchesFilter(ctx as any, filter as any)).toBe(true);
  });

  it("works with single-item conclusions filter NOT matching", () => {
    const ctx = workflowContext("success");
    const filter = { conclusions: ["failure"] };
    expect(provider.matchesFilter(ctx as any, filter as any)).toBe(false);
  });
});

// ── Part 2: Full gateway dispatch tests (Docker required) ───────────────────

describe.skipIf(!DOCKER)("integration: GitHub conclusions filter via gateway (Docker required)", { timeout: 300_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  /** Send a POST to /webhooks/github with the given event type and payload. */
  function sendGitHubWebhook(event: string, payload: object): Promise<Response> {
    return fetch(`http://127.0.0.1:${harness.gatewayPort}/webhooks/github`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": event,
        "X-GitHub-Delivery": `delivery-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
      body: JSON.stringify(payload),
    });
  }

  /** Build a minimal workflow_run payload. */
  function workflowRunPayload(conclusion: string | null): object {
    return {
      action: "completed",
      workflow_run: {
        id: Math.floor(Math.random() * 100000),
        name: "CI",
        html_url: "https://github.com/acme/app/actions/runs/12345",
        head_branch: "main",
        actor: { login: "dev-user" },
        conclusion,
        pull_requests: [],
      },
      repository: { full_name: "acme/app" },
      sender: { login: "dev-user" },
    };
  }

  it("workflow_run with conclusion 'success' triggers agent with conclusions=['success']", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "conclusions-success-agent",
          webhooks: [
            {
              source: "github",
              events: ["workflow_run"],
              conclusions: ["success"],
            },
          ],
          testScript: "#!/bin/sh\necho 'conclusions-agent triggered'\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { github: { type: "github", allowUnsigned: true } },
      },
    });

    await harness.start();

    const res = await sendGitHubWebhook("workflow_run", workflowRunPayload("success"));
    expect(res.ok).toBe(true);

    const body = (await res.json()) as { ok: boolean; matched: number };
    expect(body.ok).toBe(true);
    expect(body.matched).toBeGreaterThanOrEqual(1);

    const run = await harness.waitForRunResult("conclusions-success-agent");
    expect(run.result).toBe("completed");
  });

  it("workflow_run with conclusion 'failure' does NOT trigger agent with conclusions=['success']", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "conclusions-filter-agent",
          webhooks: [
            {
              source: "github",
              events: ["workflow_run"],
              conclusions: ["success"],
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

    const res = await sendGitHubWebhook("workflow_run", workflowRunPayload("failure"));
    expect(res.ok).toBe(true);

    const body = (await res.json()) as { ok: boolean; matched: number };
    expect(body.ok).toBe(true);
    // "failure" is not in ["success"] → filter rejects the event
    expect(body.matched).toBe(0);
  });
});
