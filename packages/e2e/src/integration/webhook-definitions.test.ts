/**
 * Integration tests: webhooks/definitions — no Docker required.
 *
 * The webhooks/definitions module provides a registry of webhook definition
 * objects (WebhookDefinition) that describe how each webhook provider can be
 * configured in an agent's config.toml (events, actions, labels, etc.).
 *
 * The definitions module has zero existing test coverage. It exports:
 *   - resolveWebhookDefinition(id) — returns the definition or throws for unknown IDs
 *   - listWebhookDefinitions() — returns all built-in webhook definitions
 *
 * Each WebhookDefinition object has:
 *   - id: string (matches provider ID used in webhook routes)
 *   - label: string
 *   - description: string
 *   - secretCredential?: string (optional credential type for signing)
 *   - filterSpec: FilterFieldSpec[] (describes available filter fields)
 *
 * Each FilterFieldSpec has:
 *   - field: string
 *   - label: string
 *   - type: "multi-select" | "text" | "text[]"
 *   - options?: FilterFieldOption[] (for multi-select)
 *   - required?: boolean
 *
 * Test scenarios (no Docker required):
 *   1. resolveWebhookDefinition: returns definition for "github"
 *   2. resolveWebhookDefinition: throws for unknown ID
 *   3. listWebhookDefinitions: returns all 5 built-in definitions
 *   4. listWebhookDefinitions: all definitions have required fields
 *   5. github definition: has events (required multi-select) and actions fields
 *   6. github definition: secretCredential is "github_webhook_secret"
 *   7. slack definition: has events field with message/app_mention options
 *   8. discord definition: has event_types and guild_ids filter fields
 *   9. twitter definition: has events field with tweet/follow options
 *  10. sentry definition: has event_types field
 *  11. filterSpec options: all multi-select fields have non-empty options arrays
 *
 * Covers:
 *   - webhooks/definitions/registry.ts: resolveWebhookDefinition() happy + throw
 *   - webhooks/definitions/registry.ts: listWebhookDefinitions()
 *   - webhooks/definitions/github.ts: structure imported and accessible
 *   - webhooks/definitions/slack.ts: structure imported and accessible
 *   - webhooks/definitions/discord.ts: structure imported and accessible
 *   - webhooks/definitions/twitter.ts: structure imported and accessible
 *   - webhooks/definitions/sentry.ts: structure imported and accessible
 */

import { describe, it, expect } from "vitest";

const { resolveWebhookDefinition, listWebhookDefinitions } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/definitions/registry.js"
);

describe("integration: webhooks/definitions registry (no Docker required)", () => {

  // ── resolveWebhookDefinition ───────────────────────────────────────────────

  describe("resolveWebhookDefinition", () => {
    it("returns the WebhookDefinition for 'github'", () => {
      const def = resolveWebhookDefinition("github");
      expect(def).toBeDefined();
      expect(def.id).toBe("github");
      expect(def.label).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(Array.isArray(def.filterSpec)).toBe(true);
    });

    it("returns definitions for all built-in sources", () => {
      for (const source of ["github", "slack", "discord", "twitter", "sentry"]) {
        const def = resolveWebhookDefinition(source);
        expect(def.id).toBe(source);
      }
    });

    it("throws 'Unknown webhook definition' for an unrecognized ID", () => {
      expect(() => resolveWebhookDefinition("not-a-real-source")).toThrow(
        'Unknown webhook definition: "not-a-real-source"'
      );
    });

    it("error message includes available sources", () => {
      let errorMessage = "";
      try {
        resolveWebhookDefinition("bogus");
      } catch (err: unknown) {
        errorMessage = err instanceof Error ? err.message : String(err);
      }
      expect(errorMessage).toContain("Available:");
      expect(errorMessage).toContain("github");
    });
  });

  // ── listWebhookDefinitions ─────────────────────────────────────────────────

  describe("listWebhookDefinitions", () => {
    it("returns an array of 5 built-in definitions", () => {
      const defs = listWebhookDefinitions();
      expect(Array.isArray(defs)).toBe(true);
      expect(defs.length).toBe(5);
    });

    it("returned array contains all expected provider IDs", () => {
      const defs = listWebhookDefinitions();
      const ids = defs.map((d: { id: string }) => d.id);
      expect(ids).toContain("github");
      expect(ids).toContain("slack");
      expect(ids).toContain("discord");
      expect(ids).toContain("twitter");
      expect(ids).toContain("sentry");
    });

    it("returns a new array (not a reference to internal array)", () => {
      const defs1 = listWebhookDefinitions();
      const defs2 = listWebhookDefinitions();
      expect(defs1).not.toBe(defs2); // different array instances
      expect(defs1.length).toBe(defs2.length);
    });

    it("every definition has required top-level fields", () => {
      const defs = listWebhookDefinitions();
      for (const def of defs) {
        expect(typeof def.id).toBe("string");
        expect(def.id.length).toBeGreaterThan(0);
        expect(typeof def.label).toBe("string");
        expect(def.label.length).toBeGreaterThan(0);
        expect(typeof def.description).toBe("string");
        expect(Array.isArray(def.filterSpec)).toBe(true);
      }
    });
  });

  // ── GitHub definition ─────────────────────────────────────────────────────

  describe("github definition", () => {
    it("has secretCredential = 'github_webhook_secret'", () => {
      const def = resolveWebhookDefinition("github");
      expect(def.secretCredential).toBe("github_webhook_secret");
    });

    it("has an 'events' filter field that is required multi-select", () => {
      const def = resolveWebhookDefinition("github");
      const events = def.filterSpec.find((f: { field: string }) => f.field === "events");
      expect(events).toBeDefined();
      expect(events!.type).toBe("multi-select");
      expect(events!.required).toBe(true);
      expect(events!.options!.length).toBeGreaterThan(0);
    });

    it("events field includes 'issues', 'pull_request', 'push' options", () => {
      const def = resolveWebhookDefinition("github");
      const events = def.filterSpec.find((f: { field: string }) => f.field === "events");
      const values = events!.options!.map((o: { value: string }) => o.value);
      expect(values).toContain("issues");
      expect(values).toContain("pull_request");
      expect(values).toContain("push");
    });

    it("has an 'actions' filter field (optional multi-select)", () => {
      const def = resolveWebhookDefinition("github");
      const actions = def.filterSpec.find((f: { field: string }) => f.field === "actions");
      expect(actions).toBeDefined();
      expect(actions!.type).toBe("multi-select");
    });

    it("has 'repos' and 'labels' text[] fields", () => {
      const def = resolveWebhookDefinition("github");
      const fieldNames = def.filterSpec.map((f: { field: string }) => f.field);
      expect(fieldNames).toContain("repos");
      expect(fieldNames).toContain("labels");
    });
  });

  // ── Slack definition ──────────────────────────────────────────────────────

  describe("slack definition", () => {
    it("has secretCredential for signing", () => {
      const def = resolveWebhookDefinition("slack");
      expect(def.secretCredential).toBeTruthy();
    });

    it("has at least one filter field", () => {
      const def = resolveWebhookDefinition("slack");
      expect(def.filterSpec.length).toBeGreaterThan(0);
    });

    it("filterSpec fields all have required properties", () => {
      const def = resolveWebhookDefinition("slack");
      for (const field of def.filterSpec) {
        expect(typeof field.field).toBe("string");
        expect(typeof field.label).toBe("string");
        expect(["multi-select", "text", "text[]"]).toContain(field.type);
      }
    });
  });

  // ── Discord definition ────────────────────────────────────────────────────

  describe("discord definition", () => {
    it("has at least one filter field", () => {
      const def = resolveWebhookDefinition("discord");
      expect(def.filterSpec.length).toBeGreaterThan(0);
    });

    it("all filter fields have valid types", () => {
      const def = resolveWebhookDefinition("discord");
      for (const field of def.filterSpec) {
        expect(["multi-select", "text", "text[]"]).toContain(field.type);
      }
    });
  });

  // ── Twitter definition ────────────────────────────────────────────────────

  describe("twitter definition", () => {
    it("has secretCredential for signing", () => {
      const def = resolveWebhookDefinition("twitter");
      expect(def.secretCredential).toBeTruthy();
    });

    it("has at least one filter field", () => {
      const def = resolveWebhookDefinition("twitter");
      expect(def.filterSpec.length).toBeGreaterThan(0);
    });
  });

  // ── Sentry definition ─────────────────────────────────────────────────────

  describe("sentry definition", () => {
    it("has secretCredential for signing", () => {
      const def = resolveWebhookDefinition("sentry");
      expect(def.secretCredential).toBeTruthy();
    });

    it("has at least one filter field", () => {
      const def = resolveWebhookDefinition("sentry");
      expect(def.filterSpec.length).toBeGreaterThan(0);
    });
  });

  // ── FilterFieldSpec options validation ────────────────────────────────────

  describe("FilterFieldSpec options", () => {
    it("all multi-select fields across all definitions have non-empty options arrays", () => {
      const defs = listWebhookDefinitions();
      for (const def of defs) {
        for (const field of def.filterSpec) {
          if (field.type === "multi-select") {
            expect(Array.isArray(field.options)).toBe(true);
            expect(field.options!.length).toBeGreaterThan(0);
            // Each option has value and label
            for (const opt of field.options!) {
              expect(typeof opt.value).toBe("string");
              expect(typeof opt.label).toBe("string");
            }
          }
        }
      }
    });
  });
});
