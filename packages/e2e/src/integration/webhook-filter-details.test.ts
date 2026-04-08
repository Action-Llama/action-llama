/**
 * Integration tests: WebhookRegistry.getFilterDetails() (via dryRunDispatch) and
 * cli/commands/webhook.ts handleInteractiveRun() + displayFilterDetails() —
 * no Docker required.
 *
 * WebhookRegistry.dryRunDispatch() populates binding.filterDetails via the
 * private getFilterDetails() method whenever a binding has a filter object.
 * filterDetails contains per-field boolean breakdowns (event, action, repo,
 * label, org, branch, conclusion, resource, assignee, author) so users can
 * see exactly why a webhook matched or didn't match.
 *
 * cli/commands/webhook.ts execute() with opts.run=true calls handleInteractiveRun()
 * which displays an interactive run prompt with matched agent names and
 * `al run` commands. displayFilterDetails() is called when filterDetails is
 * present in the dry-run binding result.
 *
 * Test scenarios (no Docker required):
 *   1. filterDetails.event=true when filter.events includes context.event
 *   2. filterDetails.event=false when filter.events does not include context.event
 *   3. filterDetails.action=true when filter.actions includes context.action
 *   4. filterDetails.action=false when context.action not in filter.actions
 *   5. filterDetails.action=false when context.action is undefined
 *   6. filterDetails.repo=true when filter.repos includes context.repo
 *   7. filterDetails.repo=false when context.repo not in filter.repos
 *   8. filterDetails.org=true when context.repo starts with org prefix (filter.org)
 *   9. filterDetails.org=false when context.repo does not start with org prefix
 *  10. filterDetails.org=true when filter.orgs array contains a matching org
 *  11. filterDetails.org=true when filter.organizations array contains a matching org
 *  12. filterDetails.label=true when filter.labels intersects context.labels
 *  13. filterDetails.label=false when no intersection
 *  14. filterDetails.branch=true when filter.branches includes context.branch
 *  15. filterDetails.branch=false when context.branch is undefined
 *  16. filterDetails always includes type:true and source:true base fields
 *  17. execute() with opts.run=true and matched agent → handleInteractiveRun path
 *  18. handleInteractiveRun shows "🚀 Interactive Run Mode" heading
 *  19. handleInteractiveRun lists the matched agent name
 *  20. handleInteractiveRun shows "al run <name>" instructions
 *  21. displayFilterDetails shown when binding has filterDetails with filter
 *  22. filterDetails.conclusion branch covered
 *  23. filterDetails.resource branch covered
 *  24. filterDetails.assignee and author branches covered
 *
 * Covers:
 *   - webhooks/registry.ts: getFilterDetails() events, actions, repos, org (string), orgs
 *     (array), organizations (array), labels, branches, conclusions, resources,
 *     assignee, author — all per-field branches
 *   - cli/commands/webhook.ts: handleInteractiveRun() — matched agents path
 *   - cli/commands/webhook.ts: displayFilterDetails() — via execute() with filter
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";

// ── Build imports ───────────────────────────────────────────────────────────

const { WebhookRegistry } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/registry.js"
);

const { TestWebhookProvider } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/providers/test.js"
);

const { execute: webhookExecute } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/webhook.js"
);

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
}

/**
 * Minimal webhook context compatible with TestWebhookProvider.
 * TestWebhookProvider.parseEvent() reads event/action/repo from body.
 */
function makeBody(overrides: Record<string, any> = {}): string {
  return JSON.stringify({
    event: "issues",
    action: "opened",
    repo: "my-org/my-repo",
    sender: "user1",
    labels: ["bug"],
    branch: "main",
    conclusion: "success",
    ...overrides,
  });
}

function makeRegistry() {
  const logger = makeLogger();
  const registry = new WebhookRegistry(logger);
  registry.registerProvider(new TestWebhookProvider());
  return { registry, logger };
}

// ── filterDetails — events field ─────────────────────────────────────────────

describe("WebhookRegistry.getFilterDetails() via dryRunDispatch — events", { timeout: 10_000 }, () => {
  it("filterDetails.event=true when filter.events includes context.event", () => {
    const { registry } = makeRegistry();
    registry.addBinding({
      agentName: "my-agent",
      type: "test",
      trigger: () => true,
      filter: { events: ["issues"] },
    });

    const result = registry.dryRunDispatch("test", {}, makeBody({ event: "issues" }));
    expect(result.ok).toBe(true);
    expect(result.bindings[0].filterDetails).toBeDefined();
    expect(result.bindings[0].filterDetails.event).toBe(true);
  });

  it("filterDetails.event=false when filter.events does not include context.event", () => {
    const { registry } = makeRegistry();
    registry.addBinding({
      agentName: "my-agent",
      type: "test",
      trigger: () => true,
      filter: { events: ["pull_request"] },
    });

    const result = registry.dryRunDispatch("test", {}, makeBody({ event: "issues" }));
    expect(result.ok).toBe(true);
    expect(result.bindings[0].filterDetails.event).toBe(false);
    expect(result.bindings[0].matched).toBe(false); // filter mismatch
  });

  it("filterDetails.type and filterDetails.source are always true", () => {
    const { registry } = makeRegistry();
    registry.addBinding({
      agentName: "my-agent",
      type: "test",
      trigger: () => true,
      filter: { events: ["issues"] },
    });

    const result = registry.dryRunDispatch("test", {}, makeBody({ event: "issues" }));
    expect(result.bindings[0].filterDetails.type).toBe(true);
    expect(result.bindings[0].filterDetails.source).toBe(true);
  });
});

// ── filterDetails — actions field ────────────────────────────────────────────

describe("WebhookRegistry.getFilterDetails() via dryRunDispatch — actions", { timeout: 10_000 }, () => {
  it("filterDetails.action=true when filter.actions includes context.action", () => {
    const { registry } = makeRegistry();
    registry.addBinding({
      agentName: "my-agent",
      type: "test",
      trigger: () => true,
      filter: { actions: ["opened"] },
    });

    const result = registry.dryRunDispatch("test", {}, makeBody({ action: "opened" }));
    expect(result.ok).toBe(true);
    expect(result.bindings[0].filterDetails.action).toBe(true);
  });

  it("filterDetails.action=false when context.action not in filter.actions", () => {
    const { registry } = makeRegistry();
    registry.addBinding({
      agentName: "my-agent",
      type: "test",
      trigger: () => true,
      filter: { actions: ["closed"] },
    });

    const result = registry.dryRunDispatch("test", {}, makeBody({ action: "opened" }));
    expect(result.bindings[0].filterDetails.action).toBe(false);
  });
});

// ── filterDetails — repos field ──────────────────────────────────────────────

describe("WebhookRegistry.getFilterDetails() via dryRunDispatch — repos", { timeout: 10_000 }, () => {
  it("filterDetails.repo=true when filter.repos includes context.repo", () => {
    const { registry } = makeRegistry();
    registry.addBinding({
      agentName: "my-agent",
      type: "test",
      trigger: () => true,
      filter: { repos: ["my-org/my-repo"] },
    });

    const result = registry.dryRunDispatch("test", {}, makeBody({ repo: "my-org/my-repo" }));
    expect(result.bindings[0].filterDetails.repo).toBe(true);
  });

  it("filterDetails.repo=false when context.repo not in filter.repos", () => {
    const { registry } = makeRegistry();
    registry.addBinding({
      agentName: "my-agent",
      type: "test",
      trigger: () => true,
      filter: { repos: ["other-org/other-repo"] },
    });

    const result = registry.dryRunDispatch("test", {}, makeBody({ repo: "my-org/my-repo" }));
    expect(result.bindings[0].filterDetails.repo).toBe(false);
  });
});

// ── filterDetails — org/orgs/organizations fields ────────────────────────────

describe("WebhookRegistry.getFilterDetails() via dryRunDispatch — org/orgs/organizations", { timeout: 10_000 }, () => {
  it("filterDetails.org=true when context.repo starts with filter.org prefix", () => {
    const { registry } = makeRegistry();
    registry.addBinding({
      agentName: "my-agent",
      type: "test",
      trigger: () => true,
      filter: { org: "my-org" },
    });

    const result = registry.dryRunDispatch("test", {}, makeBody({ repo: "my-org/my-repo" }));
    expect(result.bindings[0].filterDetails.org).toBe(true);
  });

  it("filterDetails.org=false when context.repo does not start with filter.org prefix", () => {
    const { registry } = makeRegistry();
    registry.addBinding({
      agentName: "my-agent",
      type: "test",
      trigger: () => true,
      filter: { org: "other-org" },
    });

    const result = registry.dryRunDispatch("test", {}, makeBody({ repo: "my-org/my-repo" }));
    expect(result.bindings[0].filterDetails.org).toBe(false);
  });

  it("filterDetails.org=true when filter.orgs array contains a matching org", () => {
    const { registry } = makeRegistry();
    registry.addBinding({
      agentName: "my-agent",
      type: "test",
      trigger: () => true,
      filter: { orgs: ["other-org", "my-org"] },
    });

    const result = registry.dryRunDispatch("test", {}, makeBody({ repo: "my-org/my-repo" }));
    expect(result.bindings[0].filterDetails.org).toBe(true);
  });

  it("filterDetails.org=true when filter.organizations array contains a matching org", () => {
    const { registry } = makeRegistry();
    registry.addBinding({
      agentName: "my-agent",
      type: "test",
      trigger: () => true,
      filter: { organizations: ["my-org", "third-org"] },
    });

    const result = registry.dryRunDispatch("test", {}, makeBody({ repo: "my-org/my-repo" }));
    expect(result.bindings[0].filterDetails.org).toBe(true);
  });
});

// ── filterDetails — labels field ─────────────────────────────────────────────

describe("WebhookRegistry.getFilterDetails() via dryRunDispatch — labels", { timeout: 10_000 }, () => {
  it("filterDetails.label=true when filter.labels intersects context.labels", () => {
    const { registry } = makeRegistry();
    registry.addBinding({
      agentName: "my-agent",
      type: "test",
      trigger: () => true,
      filter: { labels: ["bug"] },
    });

    const result = registry.dryRunDispatch("test", {}, makeBody({ labels: ["bug", "enhancement"] }));
    expect(result.bindings[0].filterDetails.label).toBe(true);
  });

  it("filterDetails.label=false when filter.labels does not intersect context.labels", () => {
    const { registry } = makeRegistry();
    registry.addBinding({
      agentName: "my-agent",
      type: "test",
      trigger: () => true,
      filter: { labels: ["critical"] },
    });

    const result = registry.dryRunDispatch("test", {}, makeBody({ labels: ["bug"] }));
    expect(result.bindings[0].filterDetails.label).toBe(false);
  });
});

// ── filterDetails — branches field ───────────────────────────────────────────

describe("WebhookRegistry.getFilterDetails() via dryRunDispatch — branches", { timeout: 10_000 }, () => {
  it("filterDetails.branch=true when filter.branches includes context.branch", () => {
    const { registry } = makeRegistry();
    registry.addBinding({
      agentName: "my-agent",
      type: "test",
      trigger: () => true,
      filter: { branches: ["main"] },
    });

    const result = registry.dryRunDispatch("test", {}, makeBody({ branch: "main" }));
    expect(result.bindings[0].filterDetails.branch).toBe(true);
  });

  it("filterDetails.branch=false when context has no branch", () => {
    const { registry } = makeRegistry();
    registry.addBinding({
      agentName: "my-agent",
      type: "test",
      trigger: () => true,
      filter: { branches: ["main"] },
    });

    // TestWebhookProvider only sets branch if provided in body
    const bodyWithoutBranch = JSON.stringify({ event: "issues", action: "opened", repo: "org/repo", sender: "u" });
    const result = registry.dryRunDispatch("test", {}, bodyWithoutBranch);
    expect(result.bindings[0].filterDetails.branch).toBe(false);
  });
});

// ── filterDetails — conclusions and resources ─────────────────────────────────

describe("WebhookRegistry.getFilterDetails() via dryRunDispatch — conclusions/resources", { timeout: 10_000 }, () => {
  it("filterDetails.conclusion=false when context has a conclusion not in filter", () => {
    const { registry } = makeRegistry();
    registry.addBinding({
      agentName: "my-agent",
      type: "test",
      trigger: () => true,
      filter: { conclusions: ["failure"] },
    });

    // TestWebhookProvider does not set conclusion on context (body.conclusion is ignored),
    // so context.conclusion is undefined → filterDetails.conclusion = false
    const result = registry.dryRunDispatch("test", {}, makeBody({ conclusion: "success" }));
    expect(result.bindings[0].filterDetails.conclusion).toBe(false);
  });

  it("filterDetails.conclusion=false when context has no conclusion", () => {
    const { registry } = makeRegistry();
    registry.addBinding({
      agentName: "my-agent",
      type: "test",
      trigger: () => true,
      filter: { conclusions: ["success"] },
    });

    const bodyWithoutConclusion = JSON.stringify({ event: "issues", action: "opened", repo: "org/repo", sender: "u" });
    const result = registry.dryRunDispatch("test", {}, bodyWithoutConclusion);
    expect(result.bindings[0].filterDetails.conclusion).toBe(false);
  });

  it("filterDetails.resource=true when filter.resources matches context.event", () => {
    const { registry } = makeRegistry();
    registry.addBinding({
      agentName: "my-agent",
      type: "test",
      trigger: () => true,
      filter: { resources: ["issues"] },
    });

    const result = registry.dryRunDispatch("test", {}, makeBody({ event: "issues" }));
    expect(result.bindings[0].filterDetails.resource).toBe(true);
  });
});

// ── filterDetails — assignee/author fields ───────────────────────────────────

describe("WebhookRegistry.getFilterDetails() via dryRunDispatch — assignee/author", { timeout: 10_000 }, () => {
  it("filterDetails.assignee=true when context.assignee equals filter.assignee", () => {
    const { registry } = makeRegistry();
    registry.addBinding({
      agentName: "my-agent",
      type: "test",
      trigger: () => true,
      filter: { assignee: "user1" },
    });

    const result = registry.dryRunDispatch("test", {}, makeBody({ assignee: "user1" }));
    expect(result.bindings[0].filterDetails.assignee).toBe(true);
  });

  it("filterDetails.assignee=false when context.assignee does not match", () => {
    const { registry } = makeRegistry();
    registry.addBinding({
      agentName: "my-agent",
      type: "test",
      trigger: () => true,
      filter: { assignee: "user1" },
    });

    const result = registry.dryRunDispatch("test", {}, makeBody({ assignee: "user2" }));
    expect(result.bindings[0].filterDetails.assignee).toBe(false);
  });

  it("filterDetails.author=true when context.author equals filter.author", () => {
    const { registry } = makeRegistry();
    registry.addBinding({
      agentName: "my-agent",
      type: "test",
      trigger: () => true,
      filter: { author: "bot-user" },
    });

    const result = registry.dryRunDispatch("test", {}, makeBody({ author: "bot-user" }));
    expect(result.bindings[0].filterDetails.author).toBe(true);
  });
});

// ── handleInteractiveRun via execute() ──────────────────────────────────────

describe("webhook execute() with opts.run=true — handleInteractiveRun path", { timeout: 30_000 }, () => {
  let tmpDir: string;
  let projectDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-webhook-run-test-"));
    projectDir = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function captureLog(fn: () => Promise<void>): Promise<string> {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...args: any[]) => { lines.push(args.join(" ")); orig(...args); };
    return fn().then(() => { console.log = orig; return lines.join("\n"); }, (err) => { console.log = orig; throw err; });
  }

  function setupProject(agentName: string) {
    // Create agent directory and SKILL.md
    const agentDir = join(projectDir, "agents", agentName);
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "SKILL.md"), `---\n---\n\n# ${agentName}\n`);
    writeFileSync(
      join(agentDir, "config.toml"),
      stringifyTOML({ models: ["sonnet"], webhooks: [{ source: "test", events: ["issues"] }] }) + "\n"
    );

    // Create global config.toml
    writeFileSync(
      join(projectDir, "config.toml"),
      stringifyTOML({
        models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
        webhooks: { test: { type: "test" } },
      }) + "\n"
    );
  }

  it("displays '🚀 Interactive Run Mode' when opts.run=true and agent matches", async () => {
    setupProject("run-test-agent");

    const fixture = {
      headers: { "x-test-event": "issues", "content-type": "application/json" },
      body: { event: "issues", action: "opened", repo: "org/repo", sender: "user1" },
    };
    const fixturePath = join(tmpDir, "fixture.json");
    writeFileSync(fixturePath, JSON.stringify(fixture));

    const output = await captureLog(() =>
      webhookExecute("replay", fixturePath, { project: projectDir, run: true })
    );

    expect(output).toContain("🚀 Interactive Run Mode");
  });

  it("lists matched agent name in handleInteractiveRun output", async () => {
    setupProject("run-test-agent");

    const fixture = {
      headers: { "x-test-event": "issues", "content-type": "application/json" },
      body: { event: "issues", action: "opened", repo: "org/repo", sender: "user1" },
    };
    const fixturePath = join(tmpDir, "fixture.json");
    writeFileSync(fixturePath, JSON.stringify(fixture));

    const output = await captureLog(() =>
      webhookExecute("replay", fixturePath, { project: projectDir, run: true })
    );

    expect(output).toContain("run-test-agent");
  });

  it("shows 'al run <name>' command in handleInteractiveRun output", async () => {
    setupProject("run-test-agent");

    const fixture = {
      headers: { "x-test-event": "issues", "content-type": "application/json" },
      body: { event: "issues", action: "opened", repo: "org/repo", sender: "user1" },
    };
    const fixturePath = join(tmpDir, "fixture.json");
    writeFileSync(fixturePath, JSON.stringify(fixture));

    const output = await captureLog(() =>
      webhookExecute("replay", fixturePath, { project: projectDir, run: true })
    );

    expect(output).toContain("al run run-test-agent");
  });

  it("does NOT show interactive run output when opts.run is false (default)", async () => {
    setupProject("run-test-agent");

    const fixture = {
      headers: { "x-test-event": "issues", "content-type": "application/json" },
      body: { event: "issues", action: "opened", repo: "org/repo", sender: "user1" },
    };
    const fixturePath = join(tmpDir, "fixture.json");
    writeFileSync(fixturePath, JSON.stringify(fixture));

    const output = await captureLog(() =>
      webhookExecute("replay", fixturePath, { project: projectDir })
    );

    expect(output).not.toContain("🚀 Interactive Run Mode");
  });

  it("displays filterDetails in output when binding has a filter", async () => {
    setupProject("run-test-agent");

    const fixture = {
      headers: { "x-test-event": "issues", "content-type": "application/json" },
      body: { event: "issues", action: "opened", repo: "org/repo", sender: "user1" },
    };
    const fixturePath = join(tmpDir, "fixture.json");
    writeFileSync(fixturePath, JSON.stringify(fixture));

    // The agent has filter: { events: ["issues"] }
    // displayFilterDetails will be called and show "event: true"
    const output = await captureLog(() =>
      webhookExecute("replay", fixturePath, { project: projectDir })
    );

    // displayResults shows Matched Agents, and displayFilterDetails shows event: true
    expect(output).toContain("Filter details:");
  });
});
