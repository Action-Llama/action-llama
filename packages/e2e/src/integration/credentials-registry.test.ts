/**
 * Integration tests: credentials/registry.ts and credential builtin definitions
 * — no Docker required.
 *
 * The credential registry module (credentials/registry.ts) has zero existing
 * test coverage. It provides three pure functions for looking up built-in
 * credential definitions:
 *   - resolveCredential(id) — returns the definition or throws for unknown IDs
 *   - getBuiltinCredential(id) — returns the definition or undefined
 *   - listBuiltinCredentialIds() — returns all built-in credential type IDs
 *
 * These functions delegate to builtinCredentials from credentials/builtins/index.ts,
 * which is a plain registry of CredentialDefinition objects. The definitions
 * themselves are also untested — each has id, label, description, fields[], and
 * optional envVars and agentContext.
 *
 * Test scenarios (no Docker or external services required):
 *   1. resolveCredential: returns definition for a known credential type (github_token)
 *   2. resolveCredential: throws "Unknown credential" for an unknown ID
 *   3. getBuiltinCredential: returns definition for known ID (anthropic_key)
 *   4. getBuiltinCredential: returns undefined for unknown ID
 *   5. listBuiltinCredentialIds: returns an array of strings with known entries
 *   6. listBuiltinCredentialIds: all returned IDs can be resolved via getBuiltinCredential
 *   7. Credential definitions: each has required fields (id, label, description, fields)
 *   8. Credential definitions: fields array has entries with name/label/description/secret
 *   9. Known credential IDs are present (spot-check major ones)
 *  10. envVars field (when present) maps field names to environment variable names
 *
 * Covers:
 *   - credentials/registry.ts: resolveCredential() happy path + throw path
 *   - credentials/registry.ts: getBuiltinCredential() defined + undefined paths
 *   - credentials/registry.ts: listBuiltinCredentialIds() return
 *   - credentials/builtins/index.ts: builtinCredentials registry map import
 *   - Each CredentialDefinition object structure validated structurally
 */

import { describe, it, expect } from "vitest";

const { resolveCredential, getBuiltinCredential, listBuiltinCredentialIds } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/credentials/registry.js"
);

describe("integration: credentials/registry.ts (no Docker required)", () => {

  // ── resolveCredential ──────────────────────────────────────────────────────

  describe("resolveCredential", () => {
    it("returns the CredentialDefinition for a known credential type (github_token)", () => {
      const def = resolveCredential("github_token");
      expect(def).toBeDefined();
      expect(def.id).toBe("github_token");
      expect(def.label).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(Array.isArray(def.fields)).toBe(true);
    });

    it("returns the CredentialDefinition for anthropic_key", () => {
      const def = resolveCredential("anthropic_key");
      expect(def.id).toBe("anthropic_key");
      expect(def.fields.length).toBeGreaterThan(0);
    });

    it("throws 'Unknown credential' for an unrecognized ID", () => {
      expect(() => resolveCredential("definitely_not_a_real_credential")).toThrow(
        'Unknown credential "definitely_not_a_real_credential"'
      );
    });

    it("throws for an empty string ID", () => {
      expect(() => resolveCredential("")).toThrow("Unknown credential");
    });
  });

  // ── getBuiltinCredential ───────────────────────────────────────────────────

  describe("getBuiltinCredential", () => {
    it("returns the definition for a known credential type (openai_key)", () => {
      const def = getBuiltinCredential("openai_key");
      expect(def).toBeDefined();
      expect(def!.id).toBe("openai_key");
    });

    it("returns the definition for git_ssh", () => {
      const def = getBuiltinCredential("git_ssh");
      expect(def).toBeDefined();
      expect(def!.id).toBe("git_ssh");
    });

    it("returns undefined for an unknown credential ID", () => {
      const def = getBuiltinCredential("not_a_real_credential_xyz");
      expect(def).toBeUndefined();
    });

    it("returns undefined for empty string", () => {
      const def = getBuiltinCredential("");
      expect(def).toBeUndefined();
    });
  });

  // ── listBuiltinCredentialIds ───────────────────────────────────────────────

  describe("listBuiltinCredentialIds", () => {
    it("returns an array of strings", () => {
      const ids = listBuiltinCredentialIds();
      expect(Array.isArray(ids)).toBe(true);
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) {
        expect(typeof id).toBe("string");
      }
    });

    it("includes well-known credential types", () => {
      const ids = listBuiltinCredentialIds();
      const expected = [
        "github_token",
        "anthropic_key",
        "openai_key",
        "git_ssh",
        "github_webhook_secret",
        "slack_bot_token",
        "discord_bot",
        "hetzner_api_key",
        "vultr_api_key",
        "gcp_service_account",
        "cloudflare_api_token",
      ];
      for (const id of expected) {
        expect(ids).toContain(id);
      }
    });

    it("every returned ID resolves via getBuiltinCredential", () => {
      const ids = listBuiltinCredentialIds();
      for (const id of ids) {
        const def = getBuiltinCredential(id);
        expect(def).toBeDefined();
        expect(def!.id).toBe(id);
      }
    });

    it("every returned ID resolves via resolveCredential without throwing", () => {
      const ids = listBuiltinCredentialIds();
      for (const id of ids) {
        expect(() => resolveCredential(id)).not.toThrow();
      }
    });
  });

  // ── CredentialDefinition structure ────────────────────────────────────────

  describe("CredentialDefinition structure", () => {
    it("every builtin credential has required top-level fields", () => {
      const ids = listBuiltinCredentialIds();
      for (const id of ids) {
        const def = getBuiltinCredential(id)!;
        expect(typeof def.id).toBe("string");
        expect(typeof def.label).toBe("string");
        expect(typeof def.description).toBe("string");
        expect(Array.isArray(def.fields)).toBe(true);
      }
    });

    it("every field entry has name, label, description, and secret fields", () => {
      const ids = listBuiltinCredentialIds();
      for (const id of ids) {
        const def = getBuiltinCredential(id)!;
        for (const field of def.fields) {
          expect(typeof field.name).toBe("string");
          expect(typeof field.label).toBe("string");
          expect(typeof field.description).toBe("string");
          expect(typeof field.secret).toBe("boolean");
        }
      }
    });

    it("envVars maps field names to env var names when present (github_token)", () => {
      const def = resolveCredential("github_token");
      expect(def.envVars).toBeDefined();
      // github_token maps token → GITHUB_TOKEN
      expect(def.envVars!["token"]).toBe("GITHUB_TOKEN");
    });

    it("agentContext provides a string hint when present (github_token)", () => {
      const def = resolveCredential("github_token");
      expect(typeof def.agentContext).toBe("string");
      expect(def.agentContext!.length).toBeGreaterThan(0);
    });

    it("helpUrl is a valid URL string when provided", () => {
      const def = resolveCredential("github_token");
      expect(typeof def.helpUrl).toBe("string");
      expect(def.helpUrl!.startsWith("https://")).toBe(true);
    });

    it("credentials without envVars (git_ssh) have undefined envVars or no env injection", () => {
      // git_ssh injects its key via GIT_SSH_COMMAND in credential-setup.ts,
      // not via envVars on the definition itself
      const def = resolveCredential("git_ssh");
      // No envVars expected for git_ssh
      if (def.envVars) {
        // If present, it should be an object
        expect(typeof def.envVars).toBe("object");
      } else {
        expect(def.envVars).toBeUndefined();
      }
    });
  });

  // ── Spot-check specific credential definitions ─────────────────────────────

  describe("specific credential definitions", () => {
    it("slack_bot_token has token field with secret=true", () => {
      const def = resolveCredential("slack_bot_token");
      const tokenField = def.fields.find((f: { name: string }) => f.name === "token");
      expect(tokenField).toBeDefined();
      expect(tokenField!.secret).toBe(true);
    });

    it("discord_bot has bot_token and public_key fields", () => {
      const def = resolveCredential("discord_bot");
      const names = def.fields.map((f: { name: string }) => f.name);
      expect(names).toContain("bot_token");
      expect(names).toContain("public_key");
    });

    it("hetzner_api_key has api_key field", () => {
      const def = resolveCredential("hetzner_api_key");
      const fieldNames = def.fields.map((f: { name: string }) => f.name);
      expect(fieldNames).toContain("api_key");
    });

    it("gcp_service_account has key_json field", () => {
      const def = resolveCredential("gcp_service_account");
      const fieldNames = def.fields.map((f: { name: string }) => f.name);
      expect(fieldNames).toContain("key_json");
    });

    it("cloudflare_api_token has api_token field and envVars", () => {
      const def = resolveCredential("cloudflare_api_token");
      const fieldNames = def.fields.map((f: { name: string }) => f.name);
      expect(fieldNames).toContain("api_token");
      expect(def.envVars).toBeDefined();
      expect(def.envVars!["api_token"]).toBe("CLOUDFLARE_API_TOKEN");
    });
  });
});
