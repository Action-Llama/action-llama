import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveWebhookSource, buildFilterFromTrigger, validateTriggerFields, resolveCredentialInstance, PROVIDER_CREDENTIALS, PROVIDER_TO_CREDENTIAL, PROVIDER_TO_SECRET_FIELD, KNOWN_PROVIDER_TYPES, registerWebhookBindings, setupWebhookRegistry } from "../../src/events/webhook-setup.js";
import type { WebhookSourceConfig } from "../../src/shared/config.js";
import * as twitterSubscribeMod from "../../src/webhooks/providers/twitter-subscribe.js";

vi.mock("../../src/shared/credentials.js", () => ({
  listCredentialInstances: vi.fn().mockResolvedValue([]),
  loadCredentialField: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/webhooks/providers/twitter-subscribe.js", () => ({
  twitterAutoSubscribe: vi.fn().mockResolvedValue(undefined),
}));

import * as credentials from "../../src/shared/credentials.js";
const mockedListCredentialInstances = vi.mocked(credentials.listCredentialInstances);
const mockedLoadCredentialField = vi.mocked(credentials.loadCredentialField);

const webhookSources: Record<string, WebhookSourceConfig> = {
  "my-github": { type: "github", credential: "default" },
  "my-sentry": { type: "sentry", credential: "default" },
  "my-linear": { type: "linear", credential: "default" },
  "my-mintlify": { type: "mintlify", credential: "default" },
};

describe("resolveWebhookSource", () => {
  it("returns matching source config", () => {
    const result = resolveWebhookSource("my-github", "agent1", webhookSources);
    expect(result).toEqual({ type: "github", credential: "default" });
  });

  it("throws for unknown source", () => {
    expect(() => resolveWebhookSource("missing", "agent1", webhookSources))
      .toThrow('Agent "agent1" references webhook source "missing"');
  });

  it("lists available sources in error message", () => {
    expect(() => resolveWebhookSource("missing", "agent1", webhookSources))
      .toThrow("my-github, my-sentry, my-linear");
  });

  it("shows (none) when no sources exist", () => {
    expect(() => resolveWebhookSource("missing", "agent1", {}))
      .toThrow("(none)");
  });
});

describe("buildFilterFromTrigger", () => {
  it("builds GitHub filter with events and actions", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-github", events: ["issues"], actions: ["opened"] },
      "github"
    );
    expect(filter).toEqual({ events: ["issues"], actions: ["opened"] });
  });

  it("builds GitHub filter with repos and branches", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-github", repos: ["acme/app"], branches: ["main"] },
      "github"
    );
    expect(filter).toEqual({ repos: ["acme/app"], branches: ["main"] });
  });

  it("builds Sentry filter with resources", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-sentry", resources: ["issue"] },
      "sentry"
    );
    expect(filter).toEqual({ resources: ["issue"] });
  });

  it("builds Linear filter with events and organizations", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-linear", events: ["Issue"], organizations: ["acme"] },
      "linear"
    );
    expect(filter).toEqual({ events: ["Issue"], organizations: ["acme"] });
  });

  it("builds Mintlify filter with events and projects", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-mintlify", events: ["build"], repos: ["my-docs"] },
      "mintlify"
    );
    expect(filter).toEqual({ events: ["build"], projects: ["my-docs"] });
  });

  it("builds Mintlify filter with actions and branches", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-mintlify", actions: ["failed"], branches: ["main"] },
      "mintlify"
    );
    expect(filter).toEqual({ actions: ["failed"], branches: ["main"] });
  });

  it("returns undefined when no filter fields set", () => {
    expect(buildFilterFromTrigger({ source: "my-github" }, "github")).toBeUndefined();
    expect(buildFilterFromTrigger({ source: "my-sentry" }, "sentry")).toBeUndefined();
    expect(buildFilterFromTrigger({ source: "my-linear" }, "linear")).toBeUndefined();
    expect(buildFilterFromTrigger({ source: "my-mintlify" }, "mintlify")).toBeUndefined();
  });

  it("returns undefined for unknown provider type", () => {
    expect(buildFilterFromTrigger({ source: "x", events: ["a"] }, "unknown")).toBeUndefined();
  });

  it("builds GitHub filter with orgs", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-github", orgs: ["acme", "other-org"] },
      "github"
    );
    expect(filter).toEqual({ orgs: ["acme", "other-org"] });
  });

  it("builds GitHub filter with singular org", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-github", org: "acme" },
      "github"
    );
    expect(filter).toEqual({ orgs: ["acme"] });
  });

  it("merges singular org and plural orgs together", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-github", org: "acme", orgs: ["other-org"] },
      "github"
    );
    expect(filter).toEqual({ orgs: ["acme", "other-org"] });
  });
});

describe("validateTriggerFields", () => {
  it("returns no errors for valid github fields", () => {
    const errors = validateTriggerFields(
      { source: "my-github", events: ["issues"], repos: ["acme/app"], org: "acme" },
      "github",
      "agent1"
    );
    expect(errors).toEqual([]);
  });

  it("returns no errors for valid sentry fields", () => {
    const errors = validateTriggerFields(
      { source: "my-sentry", resources: ["issue"] },
      "sentry",
      "agent1"
    );
    expect(errors).toEqual([]);
  });

  it("returns no errors for valid mintlify fields", () => {
    const errors = validateTriggerFields(
      { source: "my-mintlify", events: ["build"], actions: ["failed"], repos: ["my-docs"], branches: ["main"] },
      "mintlify",
      "agent1"
    );
    expect(errors).toEqual([]);
  });

  it("flags unrecognized fields", () => {
    const errors = validateTriggerFields(
      { source: "my-github", events: ["issues"], repository: "foo" } as any,
      "github",
      "agent1"
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('unrecognized field "repository"');
    expect(errors[0]).toContain('Did you mean "repos"');
  });

  it("flags provider-specific invalid fields (sentry trigger with repos)", () => {
    const errors = validateTriggerFields(
      { source: "my-sentry", repos: ["acme/app"] } as any,
      "sentry",
      "agent1"
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('unrecognized field "repos"');
  });

  it("flags all non-source fields for unknown provider type", () => {
    const errors = validateTriggerFields(
      { source: "x", events: ["a"], repos: ["b"] } as any,
      "unknown",
      "agent1"
    );
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('"events"');
    expect(errors[1]).toContain('"repos"');
  });
});

// ─── resolveCredentialInstance ────────────────────────────────────────────

describe("resolveCredentialInstance", () => {
  it("returns the credential field value when a provider-specific field is set", () => {
    const sourceConfig: WebhookSourceConfig = { type: "twitter", x_twitter_api: "MyBot" } as any;
    expect(resolveCredentialInstance(sourceConfig, "x_twitter_api")).toBe("MyBot");
  });

  it("falls back to the generic credential field when provider-specific field is absent", () => {
    const sourceConfig: WebhookSourceConfig = { type: "github", credential: "my-secret" };
    expect(resolveCredentialInstance(sourceConfig, "github_webhook_secret")).toBe("my-secret");
  });

  it("returns 'default' when neither provider-specific nor credential field is set", () => {
    const sourceConfig: WebhookSourceConfig = { type: "sentry" };
    expect(resolveCredentialInstance(sourceConfig, "sentry_client_secret")).toBe("default");
  });
});

// ─── PROVIDER_CREDENTIALS / derived maps ─────────────────────────────────

describe("PROVIDER_CREDENTIALS", () => {
  it("has entries for all core providers", () => {
    expect(Object.keys(PROVIDER_CREDENTIALS)).toEqual(
      expect.arrayContaining(["github", "sentry", "linear", "mintlify", "discord", "twitter"])
    );
  });

  it("twitter entry has multiple credential types", () => {
    expect(PROVIDER_CREDENTIALS.twitter.length).toBeGreaterThan(1);
  });
});

describe("PROVIDER_TO_CREDENTIAL", () => {
  it("maps github to github_webhook_secret", () => {
    expect(PROVIDER_TO_CREDENTIAL.github).toBe("github_webhook_secret");
  });

  it("maps discord to discord_bot", () => {
    expect(PROVIDER_TO_CREDENTIAL.discord).toBe("discord_bot");
  });
});

describe("PROVIDER_TO_SECRET_FIELD", () => {
  it("maps github to 'secret'", () => {
    expect(PROVIDER_TO_SECRET_FIELD.github).toBe("secret");
  });

  it("maps discord to 'public_key'", () => {
    expect(PROVIDER_TO_SECRET_FIELD.discord).toBe("public_key");
  });
});

// ─── KNOWN_PROVIDER_TYPES ─────────────────────────────────────────────────

describe("KNOWN_PROVIDER_TYPES", () => {
  it("contains all expected provider types", () => {
    for (const t of ["github", "sentry", "linear", "mintlify", "discord", "twitter", "test"]) {
      expect(KNOWN_PROVIDER_TYPES.has(t)).toBe(true);
    }
  });

  it("does not contain unknown provider types", () => {
    expect(KNOWN_PROVIDER_TYPES.has("unknown")).toBe(false);
    expect(KNOWN_PROVIDER_TYPES.has("slack")).toBe(false);
  });
});

// ─── buildFilterFromTrigger — discord and twitter ─────────────────────────

describe("buildFilterFromTrigger — discord", () => {
  it("builds discord filter with guilds and channels", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-discord", guilds: ["guild-1"], channels: ["ch-1"] } as any,
      "discord"
    );
    expect(filter).toEqual({ guilds: ["guild-1"], channels: ["ch-1"] });
  });

  it("builds discord filter with commands and events", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-discord", commands: ["!help"], events: ["MESSAGE_CREATE"] } as any,
      "discord"
    );
    expect(filter).toEqual({ commands: ["!help"], events: ["MESSAGE_CREATE"] });
  });

  it("returns undefined when no discord filter fields are set", () => {
    const filter = buildFilterFromTrigger({ source: "my-discord" } as any, "discord");
    expect(filter).toBeUndefined();
  });
});

describe("buildFilterFromTrigger — twitter", () => {
  it("builds twitter filter with events and users mapped from repos", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-twitter", events: ["dm"], repos: ["@user1"] } as any,
      "twitter"
    );
    expect(filter).toEqual({ events: ["dm"], users: ["@user1"] });
  });

  it("builds twitter filter with events only", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-twitter", events: ["mention"] } as any,
      "twitter"
    );
    expect(filter).toEqual({ events: ["mention"] });
  });

  it("returns undefined when no twitter filter fields are set", () => {
    const filter = buildFilterFromTrigger({ source: "my-twitter" } as any, "twitter");
    expect(filter).toBeUndefined();
  });
});

describe("buildFilterFromTrigger — test", () => {
  it("builds test filter with events, actions, and repos", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-test", events: ["push"], actions: ["created"], repos: ["my/repo"] } as any,
      "test"
    );
    expect(filter).toEqual({ events: ["push"], actions: ["created"], repos: ["my/repo"] });
  });

  it("returns undefined when no test filter fields are set", () => {
    const filter = buildFilterFromTrigger({ source: "my-test" } as any, "test");
    expect(filter).toBeUndefined();
  });
});

// ─── validateTriggerFields — additional providers ─────────────────────────

describe("validateTriggerFields — discord and twitter", () => {
  it("returns no errors for valid discord fields", () => {
    const errors = validateTriggerFields(
      { source: "my-discord", events: ["MESSAGE_CREATE"], guilds: ["g1"], channels: ["c1"], commands: ["!ping"] } as any,
      "discord",
      "agent1"
    );
    expect(errors).toEqual([]);
  });

  it("flags invalid field for discord", () => {
    const errors = validateTriggerFields(
      { source: "my-discord", repos: ["acme/app"] } as any,
      "discord",
      "agent1"
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"repos"');
  });

  it("returns no errors for valid twitter fields", () => {
    const errors = validateTriggerFields(
      { source: "my-twitter", events: ["dm"], repos: ["@user1"] } as any,
      "twitter",
      "agent1"
    );
    expect(errors).toEqual([]);
  });
});

// ─── setupWebhookRegistry ────────────────────────────────────────────────

describe("setupWebhookRegistry", () => {
  const makeLogger = () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }) as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedListCredentialInstances.mockResolvedValue([]);
    mockedLoadCredentialField.mockResolvedValue(undefined);
  });

  it("returns empty result when no webhook sources are configured", async () => {
    const logger = makeLogger();
    const result = await setupWebhookRegistry({ webhooks: {} } as any, logger);
    expect(result.registry).toBeUndefined();
    expect(result.secrets).toEqual({});
    expect(result.configs).toEqual({});
  });

  it("returns empty result when globalConfig has no webhooks field", async () => {
    const logger = makeLogger();
    const result = await setupWebhookRegistry({} as any, logger);
    expect(result.registry).toBeUndefined();
    expect(result.secrets).toEqual({});
    expect(result.configs).toEqual({});
  });

  it("logs a warning for sources with allowUnsigned=true", async () => {
    const logger = makeLogger();
    const result = await setupWebhookRegistry({
      webhooks: {
        "my-github": { type: "github", allowUnsigned: true },
      },
    } as any, logger);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ source: "my-github" }),
      expect.stringContaining("allows unsigned requests")
    );
    expect(result.registry).toBeDefined();
  });

  it("returns a registry with registered providers when sources exist", async () => {
    const logger = makeLogger();
    const result = await setupWebhookRegistry({
      webhooks: {
        "my-github": { type: "github", credential: "default" },
      },
    } as any, logger);
    expect(result.registry).toBeDefined();
    expect(result.configs).toEqual({ "my-github": { type: "github", credential: "default" } });
  });

  it("loads secrets for each provider type with credential instances", async () => {
    const logger = makeLogger();
    mockedListCredentialInstances.mockResolvedValue(["default"]);
    mockedLoadCredentialField.mockResolvedValue("my-secret-value");

    const result = await setupWebhookRegistry({
      webhooks: {
        "my-sentry": { type: "sentry", credential: "default" },
      },
    } as any, logger);
    expect(result.secrets.sentry).toEqual({ default: "my-secret-value" });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ providerType: "sentry", count: 1 }),
      "loaded webhook secrets"
    );
  });

  it("does not include secrets when credential field is empty", async () => {
    const logger = makeLogger();
    mockedListCredentialInstances.mockResolvedValue(["default"]);
    mockedLoadCredentialField.mockResolvedValue(undefined);

    const result = await setupWebhookRegistry({
      webhooks: {
        "my-linear": { type: "linear", credential: "default" },
      },
    } as any, logger);
    expect(result.secrets.linear).toBeUndefined();
  });
});

// ─── registerWebhookBindings ──────────────────────────────────────────────

describe("registerWebhookBindings", () => {
  const makeLogger = () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }) as any;

  const makeRegistry = () => ({
    addBinding: vi.fn(),
    registerProvider: vi.fn(),
    dispatch: vi.fn(),
    removeBindingsForAgent: vi.fn(),
  }) as any;

  it("does nothing when agent has no webhook triggers", () => {
    const logger = makeLogger();
    const registry = makeRegistry();
    const onTrigger = vi.fn();

    registerWebhookBindings({
      agentConfig: { name: "agent1", webhooks: [] } as any,
      webhookRegistry: registry,
      webhookSources: {},
      onTrigger,
      logger,
    });

    expect(registry.addBinding).not.toHaveBeenCalled();
  });

  it("does nothing when agent has no webhooks field", () => {
    const logger = makeLogger();
    const registry = makeRegistry();
    const onTrigger = vi.fn();

    registerWebhookBindings({
      agentConfig: { name: "agent1" } as any,
      webhookRegistry: registry,
      webhookSources: {},
      onTrigger,
      logger,
    });

    expect(registry.addBinding).not.toHaveBeenCalled();
  });

  it("registers a binding for a valid webhook trigger", () => {
    const logger = makeLogger();
    const registry = makeRegistry();
    const onTrigger = vi.fn().mockReturnValue(true);

    registerWebhookBindings({
      agentConfig: {
        name: "agent1",
        webhooks: [{ source: "my-github", events: ["issues"] }],
      } as any,
      webhookRegistry: registry,
      webhookSources: { "my-github": { type: "github", credential: "default" } },
      onTrigger,
      logger,
    });

    expect(registry.addBinding).toHaveBeenCalledOnce();
    const binding = registry.addBinding.mock.calls[0][0];
    expect(binding.agentName).toBe("agent1");
    expect(binding.type).toBe("github");
    expect(binding.filter).toEqual({ events: ["issues"] });
  });

  it("logs a warning and skips binding when source is not found", () => {
    const logger = makeLogger();
    const registry = makeRegistry();
    const onTrigger = vi.fn();

    registerWebhookBindings({
      agentConfig: {
        name: "agent1",
        webhooks: [{ source: "missing-source", events: ["issues"] }],
      } as any,
      webhookRegistry: registry,
      webhookSources: {},
      onTrigger,
      logger,
    });

    expect(registry.addBinding).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "agent1", source: "missing-source" }),
      "invalid webhook source, skipping"
    );
  });

  it("the registered trigger callback invokes onTrigger with agentConfig and context", () => {
    const logger = makeLogger();
    const registry = makeRegistry();
    const onTrigger = vi.fn().mockReturnValue(true);
    const agentConfig = { name: "agent1", webhooks: [{ source: "my-github" }] } as any;

    registerWebhookBindings({
      agentConfig,
      webhookRegistry: registry,
      webhookSources: { "my-github": { type: "github", credential: "default" } },
      onTrigger,
      logger,
    });

    const binding = registry.addBinding.mock.calls[0][0];
    const ctx = { event: "push" };
    const result = binding.trigger(ctx);
    expect(onTrigger).toHaveBeenCalledWith(agentConfig, ctx);
    expect(result).toBe(true);
  });

  it("uses credential from source config when no primaryCredType", () => {
    const logger = makeLogger();
    const registry = makeRegistry();
    const onTrigger = vi.fn().mockReturnValue(true);

    // "custom" is not a known provider type, so PROVIDER_TO_CREDENTIAL["custom"] is undefined
    registerWebhookBindings({
      agentConfig: {
        name: "agent1",
        webhooks: [{ source: "my-custom" }],
      } as any,
      webhookRegistry: registry,
      webhookSources: { "my-custom": { type: "custom" as any, credential: "my-cred" } },
      onTrigger,
      logger,
    });

    expect(registry.addBinding).toHaveBeenCalledOnce();
    const binding = registry.addBinding.mock.calls[0][0];
    expect(binding.source).toBe("my-cred");
  });
});

// ─── buildFilterFromTrigger — assignee and author (GitHub + Linear) ────────

describe("buildFilterFromTrigger — GitHub assignee and author filters", () => {
  it("builds GitHub filter with assignee", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-github", assignee: "alice" } as any,
      "github"
    );
    expect(filter).toEqual({ assignee: "alice" });
  });

  it("builds GitHub filter with author", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-github", author: "bob" } as any,
      "github"
    );
    expect(filter).toEqual({ author: "bob" });
  });

  it("builds GitHub filter with all fields: assignee, author, labels, branches", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-github", assignee: "alice", author: "bob", labels: ["bug"], branches: ["main"] } as any,
      "github"
    );
    expect(filter).toEqual({ assignee: "alice", author: "bob", labels: ["bug"], branches: ["main"] });
  });
});

describe("buildFilterFromTrigger — Linear filters", () => {
  it("builds Linear filter with labels", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-linear", labels: ["bug", "urgent"] } as any,
      "linear"
    );
    expect(filter).toEqual({ labels: ["bug", "urgent"] });
  });

  it("builds Linear filter with assignee", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-linear", assignee: "alice" } as any,
      "linear"
    );
    expect(filter).toEqual({ assignee: "alice" });
  });

  it("builds Linear filter with author", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-linear", author: "bob" } as any,
      "linear"
    );
    expect(filter).toEqual({ author: "bob" });
  });

  it("returns undefined when no linear filter fields are set", () => {
    const filter = buildFilterFromTrigger({ source: "my-linear" } as any, "linear");
    expect(filter).toBeUndefined();
  });

  it("builds Linear filter with all supported fields", () => {
    const filter = buildFilterFromTrigger(
      { source: "my-linear", events: ["Issue"], actions: ["create"], organizations: ["acme"], labels: ["p0"], assignee: "alice", author: "bob" } as any,
      "linear"
    );
    expect(filter).toEqual({ events: ["Issue"], actions: ["create"], organizations: ["acme"], labels: ["p0"], assignee: "alice", author: "bob" });
  });
});

// ─── setupWebhookRegistry — Twitter auto-subscribe path ──────────────────

describe("setupWebhookRegistry — Twitter auto-subscribe", () => {
  const makeLogger = () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }) as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedListCredentialInstances.mockResolvedValue([]);
    mockedLoadCredentialField.mockResolvedValue(undefined);
  });

  it("calls twitterAutoSubscribe when all required Twitter credentials are available", async () => {
    const logger = makeLogger();
    const mockedTwitterAutoSubscribe = vi.mocked(twitterSubscribeMod.twitterAutoSubscribe);

    // Provide all required credentials for Twitter auto-subscribe
    mockedLoadCredentialField.mockImplementation((_type, _inst, field) => {
      const values: Record<string, string> = {
        bearer_token: "bearer-abc",
        access_token: "access-xyz",
        refresh_token: "refresh-123",
        client_id: "client-id-456",
        client_secret: "client-secret-789",
      };
      return Promise.resolve(values[field]);
    });

    await setupWebhookRegistry(
      {
        webhooks: {
          "my-twitter": { type: "twitter", x_twitter_api: "default", x_twitter_user_oauth2: "default" },
        },
      } as any,
      logger
    );

    // Give the auto-subscribe promise time to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(mockedTwitterAutoSubscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        bearerToken: "bearer-abc",
        oauth2AccessToken: "access-xyz",
        oauth2ClientId: "client-id-456",
        oauth2ClientSecret: "client-secret-789",
      })
    );
  });

  it("does NOT call twitterAutoSubscribe when bearer token is missing", async () => {
    const logger = makeLogger();
    const mockedTwitterAutoSubscribe = vi.mocked(twitterSubscribeMod.twitterAutoSubscribe);
    mockedTwitterAutoSubscribe.mockClear();

    // bearer_token is missing
    mockedLoadCredentialField.mockImplementation((_type, _inst, field) => {
      const values: Record<string, string> = {
        access_token: "access-xyz",
        client_id: "client-id-456",
        client_secret: "client-secret-789",
      };
      return Promise.resolve(values[field] ?? undefined);
    });

    await setupWebhookRegistry(
      {
        webhooks: {
          "my-twitter": { type: "twitter", x_twitter_api: "default", x_twitter_user_oauth2: "default" },
        },
      } as any,
      logger
    );

    expect(mockedTwitterAutoSubscribe).not.toHaveBeenCalled();
  });

  it("skips secret loading for provider types with no credential mapping", async () => {
    const logger = makeLogger();

    // "test" type has no entry in PROVIDER_TO_CREDENTIAL, so credType is undefined → skip
    const result = await setupWebhookRegistry(
      {
        webhooks: {
          "my-test": { type: "test" },
        },
      } as any,
      logger
    );

    // No secrets loaded (since test provider has no credential mapping)
    expect(result.secrets).toEqual({});
    // listCredentialInstances should not have been called for test provider
    expect(mockedListCredentialInstances).not.toHaveBeenCalled();
  });

  it("logs warning when twitterAutoSubscribe rejects (.catch path)", async () => {
    const logger = makeLogger();
    const mockedTwitterAutoSubscribe = vi.mocked(twitterSubscribeMod.twitterAutoSubscribe);
    const subscribeError = new Error("Twitter subscribe failed");
    mockedTwitterAutoSubscribe.mockRejectedValueOnce(subscribeError);

    // Provide all required credentials for Twitter auto-subscribe
    mockedLoadCredentialField.mockImplementation((_type, _inst, field) => {
      const values: Record<string, string> = {
        bearer_token: "bearer-abc",
        access_token: "access-xyz",
        refresh_token: "refresh-123",
        client_id: "client-id-456",
        client_secret: "client-secret-789",
      };
      return Promise.resolve(values[field]);
    });

    await setupWebhookRegistry(
      {
        webhooks: {
          "my-twitter": { type: "twitter", x_twitter_api: "default", x_twitter_user_oauth2: "default" },
        },
      } as any,
      logger
    );

    // Wait for the async .catch() to fire
    await new Promise((r) => setTimeout(r, 20));

    // The .catch() callback logs a warning with the error
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: subscribeError }),
      "Twitter auto-subscribe failed"
    );
  });
});
