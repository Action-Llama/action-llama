/**
 * Integration tests: events/webhook-setup.ts utility functions — no Docker required.
 *
 * Tests the pure utility functions exported from webhook-setup.ts, which
 * validate and transform webhook configuration for the scheduler.
 *
 * These functions are only tested indirectly via Docker-gated e2e tests;
 * this file covers them directly without needing any scheduler or Docker.
 *
 * Functions tested:
 *   - resolveCredentialInstance(sourceConfig, credType): resolve credential instance name
 *   - resolveWebhookSource(sourceName, agentName, webhookSources): get source or throw
 *   - buildFilterFromTrigger(trigger, providerType): build provider filter from trigger config
 *   - validateTriggerFields(trigger, providerType, agentName): validate trigger fields
 *   - KNOWN_PROVIDER_TYPES: set of valid provider type strings
 *   - PROVIDER_CREDENTIALS: map of provider → credential type/field info
 *   - PROVIDER_TO_CREDENTIAL / PROVIDER_TO_SECRET_FIELD: legacy maps
 *
 * Covers:
 *   - webhook-setup.ts: resolveCredentialInstance — provider-specific field wins
 *   - webhook-setup.ts: resolveCredentialInstance — falls back to 'credential' field
 *   - webhook-setup.ts: resolveCredentialInstance — falls back to 'default'
 *   - webhook-setup.ts: resolveWebhookSource — returns source config when found
 *   - webhook-setup.ts: resolveWebhookSource — throws with agent name and available sources
 *   - webhook-setup.ts: buildFilterFromTrigger — github: all fields mapped
 *   - webhook-setup.ts: buildFilterFromTrigger — github: org maps to orgs array
 *   - webhook-setup.ts: buildFilterFromTrigger — github: returns undefined for empty trigger
 *   - webhook-setup.ts: buildFilterFromTrigger — sentry: resources field
 *   - webhook-setup.ts: buildFilterFromTrigger — linear: all fields mapped
 *   - webhook-setup.ts: buildFilterFromTrigger — mintlify: repos maps to projects
 *   - webhook-setup.ts: buildFilterFromTrigger — discord: guilds/channels/commands/events
 *   - webhook-setup.ts: buildFilterFromTrigger — twitter: repos maps to users
 *   - webhook-setup.ts: buildFilterFromTrigger — test: events/actions/repos
 *   - webhook-setup.ts: buildFilterFromTrigger — unknown provider → undefined
 *   - webhook-setup.ts: validateTriggerFields — valid fields return empty array
 *   - webhook-setup.ts: validateTriggerFields — unknown field returns error message
 *   - webhook-setup.ts: validateTriggerFields — typo with suggestion included in error
 *   - webhook-setup.ts: validateTriggerFields — unknown provider type flags all non-source fields
 *   - webhook-setup.ts: KNOWN_PROVIDER_TYPES — contains all expected providers
 *   - webhook-setup.ts: PROVIDER_CREDENTIALS — correct structure for all providers
 */

import { describe, it, expect } from "vitest";

const {
  resolveCredentialInstance,
  resolveWebhookSource,
  buildFilterFromTrigger,
  validateTriggerFields,
  KNOWN_PROVIDER_TYPES,
  PROVIDER_CREDENTIALS,
  PROVIDER_TO_CREDENTIAL,
  PROVIDER_TO_SECRET_FIELD,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/events/webhook-setup.js"
);

// ── resolveCredentialInstance ──────────────────────────────────────────────

describe("integration: webhook-setup.ts utility functions (no Docker required)", { timeout: 15_000 }, () => {

  describe("resolveCredentialInstance()", () => {
    it("returns provider-specific field value when present in sourceConfig", () => {
      const sourceConfig = {
        type: "github",
        github_webhook_secret: "my-org-secret",
      };
      const result = resolveCredentialInstance(sourceConfig, "github_webhook_secret");
      expect(result).toBe("my-org-secret");
    });

    it("falls back to 'credential' field when provider-specific field is absent", () => {
      const sourceConfig = {
        type: "github",
        credential: "org-instance",
      };
      const result = resolveCredentialInstance(sourceConfig, "github_webhook_secret");
      expect(result).toBe("org-instance");
    });

    it("falls back to 'default' when neither provider-specific nor credential field is set", () => {
      const sourceConfig = { type: "github" };
      const result = resolveCredentialInstance(sourceConfig, "github_webhook_secret");
      expect(result).toBe("default");
    });

    it("returns provider-specific field even when credential field is also set", () => {
      const sourceConfig = {
        type: "github",
        github_webhook_secret: "specific-instance",
        credential: "generic-instance",
      };
      const result = resolveCredentialInstance(sourceConfig, "github_webhook_secret");
      expect(result).toBe("specific-instance");
    });
  });

  // ── resolveWebhookSource ────────────────────────────────────────────────────

  describe("resolveWebhookSource()", () => {
    const webhookSources = {
      "github-main": { type: "github" },
      "sentry-prod": { type: "sentry" },
    };

    it("returns the source config when sourceName is found", () => {
      const result = resolveWebhookSource("github-main", "my-agent", webhookSources);
      expect(result).toEqual({ type: "github" });
    });

    it("throws an error with agent name and available sources when source is missing", () => {
      expect(() => resolveWebhookSource("unknown-source", "my-agent", webhookSources)).toThrow(
        /my-agent.*unknown-source/
      );
    });

    it("error message lists available sources", () => {
      expect(() => resolveWebhookSource("unknown-source", "my-agent", webhookSources)).toThrow(
        /github-main.*sentry-prod|sentry-prod.*github-main/
      );
    });

    it("error message says '(none)' when no sources are defined", () => {
      expect(() => resolveWebhookSource("src", "agent", {})).toThrow(/none/);
    });

    it("returns correct source for sentry", () => {
      const result = resolveWebhookSource("sentry-prod", "my-agent", webhookSources);
      expect(result).toEqual({ type: "sentry" });
    });
  });

  // ── buildFilterFromTrigger ─────────────────────────────────────────────────

  describe("buildFilterFromTrigger()", () => {
    describe("github provider", () => {
      it("returns undefined for empty trigger (no filter fields)", () => {
        const result = buildFilterFromTrigger({ source: "github-main" }, "github");
        expect(result).toBeUndefined();
      });

      it("maps events field", () => {
        const result = buildFilterFromTrigger({ source: "gh", events: ["issues", "pull_request"] }, "github");
        expect(result).toMatchObject({ events: ["issues", "pull_request"] });
      });

      it("maps actions field", () => {
        const result = buildFilterFromTrigger({ source: "gh", actions: ["opened", "closed"] }, "github");
        expect(result).toMatchObject({ actions: ["opened", "closed"] });
      });

      it("maps repos field", () => {
        const result = buildFilterFromTrigger({ source: "gh", repos: ["owner/repo"] }, "github");
        expect(result).toMatchObject({ repos: ["owner/repo"] });
      });

      it("maps org field to orgs array", () => {
        const result = buildFilterFromTrigger({ source: "gh", org: "my-org" }, "github");
        expect(result).toMatchObject({ orgs: ["my-org"] });
      });

      it("merges org and orgs fields into orgs array", () => {
        const result = buildFilterFromTrigger({ source: "gh", org: "org-a", orgs: ["org-b"] }, "github");
        expect((result as any).orgs).toEqual(["org-a", "org-b"]);
      });

      it("maps orgs field directly when org is absent", () => {
        const result = buildFilterFromTrigger({ source: "gh", orgs: ["org-c"] }, "github");
        expect((result as any).orgs).toEqual(["org-c"]);
      });

      it("maps labels field", () => {
        const result = buildFilterFromTrigger({ source: "gh", labels: ["bug"] }, "github");
        expect(result).toMatchObject({ labels: ["bug"] });
      });

      it("maps assignee, author, branches, conclusions fields", () => {
        const result = buildFilterFromTrigger({
          source: "gh",
          assignee: "user1",
          author: "user2",
          branches: ["main"],
          conclusions: ["success"],
        }, "github");
        expect(result).toMatchObject({
          assignee: "user1",
          author: "user2",
          branches: ["main"],
          conclusions: ["success"],
        });
      });
    });

    describe("sentry provider", () => {
      it("returns undefined when no resources specified", () => {
        const result = buildFilterFromTrigger({ source: "sentry-main" }, "sentry");
        expect(result).toBeUndefined();
      });

      it("maps resources field", () => {
        const result = buildFilterFromTrigger({ source: "sentry-main", resources: ["error"] }, "sentry");
        expect(result).toMatchObject({ resources: ["error"] });
      });
    });

    describe("linear provider", () => {
      it("returns undefined when no filter fields set", () => {
        const result = buildFilterFromTrigger({ source: "linear-main" }, "linear");
        expect(result).toBeUndefined();
      });

      it("maps events, actions, organizations, labels, assignee, author", () => {
        const result = buildFilterFromTrigger({
          source: "linear-main",
          events: ["Issue"],
          actions: ["create"],
          organizations: ["my-org"],
          labels: ["bug"],
          assignee: "alice",
          author: "bob",
        }, "linear");
        expect(result).toMatchObject({
          events: ["Issue"],
          actions: ["create"],
          organizations: ["my-org"],
          labels: ["bug"],
          assignee: "alice",
          author: "bob",
        });
      });
    });

    describe("mintlify provider", () => {
      it("maps repos to projects field", () => {
        const result = buildFilterFromTrigger({ source: "mintlify-main", repos: ["my-docs"] }, "mintlify");
        expect(result).toMatchObject({ projects: ["my-docs"] });
        expect((result as any).repos).toBeUndefined();
      });

      it("maps events, actions, branches", () => {
        const result = buildFilterFromTrigger({
          source: "mintlify-main",
          events: ["build_succeeded"],
          actions: ["create"],
          branches: ["main"],
        }, "mintlify");
        expect(result).toMatchObject({
          events: ["build_succeeded"],
          actions: ["create"],
          branches: ["main"],
        });
      });
    });

    describe("discord provider", () => {
      it("maps guilds, channels, commands, events fields", () => {
        const result = buildFilterFromTrigger({
          source: "discord-main",
          guilds: ["guild-1"],
          channels: ["chan-1"],
          commands: ["/help"],
          events: ["APPLICATION_COMMAND"],
        }, "discord");
        expect(result).toMatchObject({
          guilds: ["guild-1"],
          channels: ["chan-1"],
          commands: ["/help"],
          events: ["APPLICATION_COMMAND"],
        });
      });

      it("returns undefined when no filter fields set", () => {
        const result = buildFilterFromTrigger({ source: "discord-main" }, "discord");
        expect(result).toBeUndefined();
      });
    });

    describe("twitter provider", () => {
      it("maps repos to users field", () => {
        const result = buildFilterFromTrigger({ source: "twitter-main", repos: ["user1"] }, "twitter");
        expect(result).toMatchObject({ users: ["user1"] });
        expect((result as any).repos).toBeUndefined();
      });

      it("maps events field", () => {
        const result = buildFilterFromTrigger({ source: "twitter-main", events: ["tweet_create"] }, "twitter");
        expect(result).toMatchObject({ events: ["tweet_create"] });
      });
    });

    describe("test provider", () => {
      it("maps events, actions, repos fields", () => {
        const result = buildFilterFromTrigger({
          source: "test-src",
          events: ["push"],
          actions: ["created"],
          repos: ["test-repo"],
        }, "test");
        expect(result).toMatchObject({
          events: ["push"],
          actions: ["created"],
          repos: ["test-repo"],
        });
      });
    });

    describe("unknown provider", () => {
      it("returns undefined for unknown provider type", () => {
        const result = buildFilterFromTrigger({ source: "unknown-src", events: ["test"] }, "unknown-provider");
        expect(result).toBeUndefined();
      });
    });
  });

  // ── validateTriggerFields ──────────────────────────────────────────────────

  describe("validateTriggerFields()", () => {
    it("returns empty array for valid github trigger fields", () => {
      const trigger = { source: "gh", events: ["issues"], actions: ["opened"], repos: ["org/repo"] };
      const errors = validateTriggerFields(trigger, "github", "my-agent");
      expect(errors).toEqual([]);
    });

    it("returns error for unknown field in github trigger", () => {
      const trigger = { source: "gh", unknownField: "value" } as any;
      const errors = validateTriggerFields(trigger, "github", "my-agent");
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("my-agent");
      expect(errors[0]).toContain("unknownField");
    });

    it("includes 'Did you mean' suggestion for common typos", () => {
      // "repository" should suggest "repos"
      const trigger = { source: "gh", repository: "org/repo" } as any;
      const errors = validateTriggerFields(trigger, "github", "my-agent");
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("repos");
      expect(errors[0]).toContain("Did you mean");
    });

    it("includes suggestion for 'event' → 'events' typo", () => {
      const trigger = { source: "gh", event: "issues" } as any;
      const errors = validateTriggerFields(trigger, "github", "my-agent");
      expect(errors[0]).toContain("events");
    });

    it("includes suggestion for 'branch' → 'branches' typo", () => {
      const trigger = { source: "gh", branch: "main" } as any;
      const errors = validateTriggerFields(trigger, "github", "my-agent");
      expect(errors[0]).toContain("branches");
    });

    it("does not flag 'source' field as unknown", () => {
      const trigger = { source: "gh" };
      const errors = validateTriggerFields(trigger, "github", "my-agent");
      expect(errors).toEqual([]);
    });

    it("flags all non-source fields for unknown provider type", () => {
      const trigger = { source: "custom-src", events: ["test"], actions: ["run"] } as any;
      const errors = validateTriggerFields(trigger, "custom-unknown-type", "my-agent");
      // Should flag "events" and "actions" since provider is unknown
      expect(errors.length).toBe(2);
      expect(errors.some((e: string) => e.includes("events"))).toBe(true);
      expect(errors.some((e: string) => e.includes("actions"))).toBe(true);
    });

    it("returns multiple errors for multiple unknown fields", () => {
      const trigger = { source: "gh", badField1: "a", badField2: "b" } as any;
      const errors = validateTriggerFields(trigger, "github", "my-agent");
      expect(errors.length).toBe(2);
    });

    it("returns empty array for valid sentry trigger fields", () => {
      const trigger = { source: "sentry-main", resources: ["error"] };
      const errors = validateTriggerFields(trigger, "sentry", "my-agent");
      expect(errors).toEqual([]);
    });

    it("returns empty array for valid linear trigger fields", () => {
      const trigger = {
        source: "linear-main",
        events: ["Issue"],
        actions: ["create"],
        organizations: ["my-org"],
        labels: ["bug"],
        assignee: "alice",
        author: "bob",
      };
      const errors = validateTriggerFields(trigger, "linear", "my-agent");
      expect(errors).toEqual([]);
    });

    it("returns empty array for valid discord trigger fields", () => {
      const trigger = {
        source: "discord-main",
        events: ["APPLICATION_COMMAND"],
        guilds: ["guild-1"],
        channels: ["chan-1"],
        commands: ["/help"],
      };
      const errors = validateTriggerFields(trigger, "discord", "my-agent");
      expect(errors).toEqual([]);
    });
  });

  // ── KNOWN_PROVIDER_TYPES ───────────────────────────────────────────────────

  describe("KNOWN_PROVIDER_TYPES", () => {
    it("contains all expected provider types", () => {
      expect(KNOWN_PROVIDER_TYPES.has("github")).toBe(true);
      expect(KNOWN_PROVIDER_TYPES.has("sentry")).toBe(true);
      expect(KNOWN_PROVIDER_TYPES.has("linear")).toBe(true);
      expect(KNOWN_PROVIDER_TYPES.has("mintlify")).toBe(true);
      expect(KNOWN_PROVIDER_TYPES.has("discord")).toBe(true);
      expect(KNOWN_PROVIDER_TYPES.has("twitter")).toBe(true);
      expect(KNOWN_PROVIDER_TYPES.has("test")).toBe(true);
    });

    it("does not contain unknown providers", () => {
      expect(KNOWN_PROVIDER_TYPES.has("slack")).toBe(false);
      expect(KNOWN_PROVIDER_TYPES.has("unknown")).toBe(false);
    });
  });

  // ── PROVIDER_CREDENTIALS ───────────────────────────────────────────────────

  describe("PROVIDER_CREDENTIALS", () => {
    it("has entries for all known non-test providers", () => {
      expect(PROVIDER_CREDENTIALS["github"]).toBeDefined();
      expect(PROVIDER_CREDENTIALS["sentry"]).toBeDefined();
      expect(PROVIDER_CREDENTIALS["linear"]).toBeDefined();
      expect(PROVIDER_CREDENTIALS["mintlify"]).toBeDefined();
      expect(PROVIDER_CREDENTIALS["discord"]).toBeDefined();
      expect(PROVIDER_CREDENTIALS["twitter"]).toBeDefined();
    });

    it("each entry is an array with at least one { type, secretField } object", () => {
      for (const [provider, creds] of Object.entries(PROVIDER_CREDENTIALS)) {
        expect(Array.isArray(creds)).toBe(true);
        expect((creds as any[]).length).toBeGreaterThan(0);
        for (const cred of creds as any[]) {
          expect(typeof cred.type).toBe("string");
          expect(typeof cred.secretField).toBe("string");
        }
      }
    });

    it("github uses github_webhook_secret type", () => {
      expect(PROVIDER_CREDENTIALS["github"][0].type).toBe("github_webhook_secret");
    });

    it("discord uses discord_bot public_key", () => {
      const discordCred = PROVIDER_CREDENTIALS["discord"][0];
      expect(discordCred.type).toBe("discord_bot");
      expect(discordCred.secretField).toBe("public_key");
    });

    it("twitter has multiple credential options", () => {
      expect(PROVIDER_CREDENTIALS["twitter"].length).toBeGreaterThan(1);
    });
  });

  // ── PROVIDER_TO_CREDENTIAL / PROVIDER_TO_SECRET_FIELD ─────────────────────

  describe("PROVIDER_TO_CREDENTIAL / PROVIDER_TO_SECRET_FIELD legacy maps", () => {
    it("PROVIDER_TO_CREDENTIAL maps provider to first credential type", () => {
      expect(PROVIDER_TO_CREDENTIAL["github"]).toBe("github_webhook_secret");
      expect(PROVIDER_TO_CREDENTIAL["sentry"]).toBeDefined();
      expect(PROVIDER_TO_CREDENTIAL["discord"]).toBe("discord_bot");
    });

    it("PROVIDER_TO_SECRET_FIELD maps provider to first secret field name", () => {
      expect(PROVIDER_TO_SECRET_FIELD["github"]).toBe("secret");
      expect(PROVIDER_TO_SECRET_FIELD["discord"]).toBe("public_key");
    });
  });
});
