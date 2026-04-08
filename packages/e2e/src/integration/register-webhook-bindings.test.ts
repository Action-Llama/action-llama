/**
 * Integration tests: events/webhook-setup.ts registerWebhookBindings() — no Docker required.
 *
 * registerWebhookBindings() iterates over an agent's webhook trigger list and
 * calls webhookRegistry.addBinding() for each one, resolving the source config,
 * credential instance, and filter. Invalid sources are skipped with a warning.
 *
 * Covers:
 *   - webhook-setup.ts: registerWebhookBindings() — no webhooks → no bindings added
 *   - webhook-setup.ts: registerWebhookBindings() — empty webhooks array → no bindings added
 *   - webhook-setup.ts: registerWebhookBindings() — single webhook → addBinding called once
 *   - webhook-setup.ts: registerWebhookBindings() — binding has correct agentName/type/source
 *   - webhook-setup.ts: registerWebhookBindings() — filter is built from trigger fields
 *   - webhook-setup.ts: registerWebhookBindings() — trigger callback invokes onTrigger
 *   - webhook-setup.ts: registerWebhookBindings() — multiple webhooks → multiple bindings
 *   - webhook-setup.ts: registerWebhookBindings() — invalid source → skipped with warning
 *   - webhook-setup.ts: registerWebhookBindings() — source with explicit credential instance
 */

import { describe, it, expect, vi } from "vitest";
import type { AgentConfig } from "@action-llama/action-llama/internals/config";

const {
  registerWebhookBindings,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/events/webhook-setup.js"
);

const {
  WebhookRegistry,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/registry.js"
);

const {
  GitHubWebhookProvider,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/providers/github.js"
);

const {
  TestWebhookProvider,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/providers/test.js"
);

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
}

function makeRegistry(logger?: ReturnType<typeof makeLogger>) {
  const l = logger || makeLogger();
  const registry = new WebhookRegistry(l);
  registry.registerProvider(new GitHubWebhookProvider());
  registry.registerProvider(new TestWebhookProvider());
  return registry;
}

/** Minimal AgentConfig for testing. */
function makeAgentConfig(name: string, overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    name,
    credentials: [],
    models: [],
    params: {},
    ...overrides,
  } as AgentConfig;
}

describe("integration: events/webhook-setup.ts registerWebhookBindings() (no Docker required)", { timeout: 15_000 }, () => {

  it("no webhooks on agent → no bindings added", () => {
    const registry = makeRegistry();
    const addBindingSpy = vi.spyOn(registry, "addBinding");
    const agent = makeAgentConfig("no-webhook-agent");

    registerWebhookBindings({
      agentConfig: agent,
      webhookRegistry: registry,
      webhookSources: {},
      onTrigger: vi.fn(),
      logger: makeLogger(),
    });

    expect(addBindingSpy).not.toHaveBeenCalled();
  });

  it("empty webhooks array → no bindings added", () => {
    const registry = makeRegistry();
    const addBindingSpy = vi.spyOn(registry, "addBinding");
    const agent = makeAgentConfig("empty-webhook-agent", { webhooks: [] });

    registerWebhookBindings({
      agentConfig: agent,
      webhookRegistry: registry,
      webhookSources: {},
      onTrigger: vi.fn(),
      logger: makeLogger(),
    });

    expect(addBindingSpy).not.toHaveBeenCalled();
  });

  it("single webhook → addBinding called once", () => {
    const registry = makeRegistry();
    const addBindingSpy = vi.spyOn(registry, "addBinding");
    const agent = makeAgentConfig("github-agent", {
      webhooks: [{ source: "gh-src", events: ["push"] }] as any,
    });

    registerWebhookBindings({
      agentConfig: agent,
      webhookRegistry: registry,
      webhookSources: {
        "gh-src": { type: "github" },
      } as any,
      onTrigger: vi.fn(),
      logger: makeLogger(),
    });

    expect(addBindingSpy).toHaveBeenCalledTimes(1);
  });

  it("binding has correct agentName and type", () => {
    const registry = makeRegistry();
    const addBindingSpy = vi.spyOn(registry, "addBinding");
    const agent = makeAgentConfig("my-agent", {
      webhooks: [{ source: "gh-src", events: ["push"] }] as any,
    });

    registerWebhookBindings({
      agentConfig: agent,
      webhookRegistry: registry,
      webhookSources: {
        "gh-src": { type: "github" },
      } as any,
      onTrigger: vi.fn(),
      logger: makeLogger(),
    });

    expect(addBindingSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        agentName: "my-agent",
        type: "github",
      })
    );
  });

  it("filter is built from trigger events field", () => {
    const registry = makeRegistry();
    const addBindingSpy = vi.spyOn(registry, "addBinding");
    const agent = makeAgentConfig("filter-agent", {
      webhooks: [{ source: "gh-src", events: ["push", "pull_request"] }] as any,
    });

    registerWebhookBindings({
      agentConfig: agent,
      webhookRegistry: registry,
      webhookSources: {
        "gh-src": { type: "github" },
      } as any,
      onTrigger: vi.fn(),
      logger: makeLogger(),
    });

    const binding = addBindingSpy.mock.calls[0][0];
    expect(binding.filter).toBeDefined();
    // GitHub filter should have events field
    expect((binding.filter as any).events).toEqual(["push", "pull_request"]);
  });

  it("trigger callback invokes onTrigger with the agentConfig and context", async () => {
    const registry = makeRegistry();
    const addBindingSpy = vi.spyOn(registry, "addBinding");
    const agent = makeAgentConfig("cb-agent", {
      webhooks: [{ source: "test-src", events: ["push"] }] as any,
    });
    const onTrigger = vi.fn().mockResolvedValue(undefined);

    registerWebhookBindings({
      agentConfig: agent,
      webhookRegistry: registry,
      webhookSources: {
        "test-src": { type: "test" },
      } as any,
      onTrigger,
      logger: makeLogger(),
    });

    const binding = addBindingSpy.mock.calls[0][0];
    const fakeContext = { event: "push", payload: {} };
    await binding.trigger(fakeContext);

    expect(onTrigger).toHaveBeenCalledTimes(1);
    expect(onTrigger).toHaveBeenCalledWith(agent, fakeContext);
  });

  it("multiple webhooks → multiple bindings registered", () => {
    const registry = makeRegistry();
    const addBindingSpy = vi.spyOn(registry, "addBinding");
    const agent = makeAgentConfig("multi-agent", {
      webhooks: [
        { source: "gh-src", events: ["push"] },
        { source: "test-src", events: ["deploy"] },
      ] as any,
    });

    registerWebhookBindings({
      agentConfig: agent,
      webhookRegistry: registry,
      webhookSources: {
        "gh-src": { type: "github" },
        "test-src": { type: "test" },
      } as any,
      onTrigger: vi.fn(),
      logger: makeLogger(),
    });

    expect(addBindingSpy).toHaveBeenCalledTimes(2);
  });

  it("invalid source name → binding skipped with warning", () => {
    const registry = makeRegistry();
    const addBindingSpy = vi.spyOn(registry, "addBinding");
    const logger = makeLogger();
    const agent = makeAgentConfig("bad-src-agent", {
      webhooks: [{ source: "nonexistent-source", events: ["push"] }] as any,
    });

    registerWebhookBindings({
      agentConfig: agent,
      webhookRegistry: registry,
      webhookSources: {}, // nonexistent-source not defined here
      onTrigger: vi.fn(),
      logger,
    });

    // addBinding should NOT have been called (invalid source was skipped)
    expect(addBindingSpy).not.toHaveBeenCalled();
    // A warning should have been logged
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "bad-src-agent", source: "nonexistent-source" }),
      expect.stringContaining("invalid webhook source")
    );
  });

  it("one valid source + one invalid source → one binding registered, one warned", () => {
    const registry = makeRegistry();
    const addBindingSpy = vi.spyOn(registry, "addBinding");
    const logger = makeLogger();
    const agent = makeAgentConfig("mixed-agent", {
      webhooks: [
        { source: "gh-src", events: ["push"] },
        { source: "bad-src", events: ["deploy"] },
      ] as any,
    });

    registerWebhookBindings({
      agentConfig: agent,
      webhookRegistry: registry,
      webhookSources: {
        "gh-src": { type: "github" },
        // bad-src not present
      } as any,
      onTrigger: vi.fn(),
      logger,
    });

    expect(addBindingSpy).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("source with explicit credential instance → binding uses that instance as source", () => {
    const registry = makeRegistry();
    const addBindingSpy = vi.spyOn(registry, "addBinding");
    const agent = makeAgentConfig("explicit-cred-agent", {
      webhooks: [{ source: "gh-src", events: ["push"] }] as any,
    });

    registerWebhookBindings({
      agentConfig: agent,
      webhookRegistry: registry,
      webhookSources: {
        "gh-src": {
          type: "github",
          "github_webhook_secret": "my-instance", // explicit credential instance
        },
      } as any,
      onTrigger: vi.fn(),
      logger: makeLogger(),
    });

    const binding = addBindingSpy.mock.calls[0][0];
    // Should use "my-instance" as the source (credential instance)
    expect(binding.source).toBe("my-instance");
  });
});
