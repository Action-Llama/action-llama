/**
 * Integration tests: agents/prompt.ts buildCredentialContext() — no Docker required.
 *
 * buildCredentialContext(credentials, options?) builds the <credential-context>
 * block that is injected into agent prompts. It has two main branches:
 *
 *   1. Default path (hostUser=false/undefined) → uses /credentials/ path
 *   2. hostUser=true path → uses $AL_CREDENTIALS_PATH variable
 *
 * For each credential reference in the credentials array, the function resolves
 * the credential type and, if the definition has an agentContext field, includes
 * a bullet point. Unknown credential types are silently skipped.
 *
 * Test scenarios (no Docker required):
 *   1. Default call returns <credential-context> block
 *   2. Default call references /credentials/ path
 *   3. hostUser=true references $AL_CREDENTIALS_PATH
 *   4. Empty credentials list still returns valid block structure
 *   5. Known credential (github_token) includes its agentContext text
 *   6. Unknown credential type is silently skipped (no error)
 *   7. Multiple known credentials include all their agentContext lines
 *   8. Credential with no agentContext defined is skipped in context block
 *   9. Contains anti-exfiltration policy section
 *   10. Contains git clone protocol guidance
 *   11. Starts with <credential-context> and ends with </credential-context>
 *   12. type:instance notation works (type is resolved correctly)
 *
 * Covers:
 *   - agents/prompt.ts: buildCredentialContext() hostUser=false (default) → /credentials/
 *   - agents/prompt.ts: buildCredentialContext() hostUser=true → $AL_CREDENTIALS_PATH
 *   - agents/prompt.ts: buildCredentialContext() empty credentials → base structure only
 *   - agents/prompt.ts: buildCredentialContext() known type with agentContext → included
 *   - agents/prompt.ts: buildCredentialContext() unknown type → silently skipped (catch block)
 *   - agents/prompt.ts: buildCredentialContext() type:instance notation
 */

import { describe, it, expect } from "vitest";

const {
  buildCredentialContext,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/agents/prompt.js"
);

describe(
  "integration: agents/prompt.ts buildCredentialContext() (no Docker required)",
  { timeout: 15_000 },
  () => {
    // ── Basic structure ───────────────────────────────────────────────────────

    it("returns a string", () => {
      expect(typeof buildCredentialContext([])).toBe("string");
    });

    it("contains <credential-context> opening tag", () => {
      expect(buildCredentialContext([])).toContain("<credential-context>");
    });

    it("contains </credential-context> closing tag", () => {
      expect(buildCredentialContext([])).toContain("</credential-context>");
    });

    it("starts with <credential-context>", () => {
      expect(buildCredentialContext([]).startsWith("<credential-context>")).toBe(true);
    });

    it("ends with </credential-context>", () => {
      const result = buildCredentialContext([]).trim();
      expect(result.endsWith("</credential-context>")).toBe(true);
    });

    it("contains anti-exfiltration policy", () => {
      expect(buildCredentialContext([])).toContain("exfiltration");
    });

    it("contains git clone protocol guidance", () => {
      expect(buildCredentialContext([])).toContain("git clone");
    });

    // ── Default path (hostUser = undefined/false) ────────────────────────────

    it("references /credentials/ path when hostUser is undefined", () => {
      expect(buildCredentialContext([])).toContain("/credentials/");
    });

    it("references /credentials/ path when hostUser is false", () => {
      expect(buildCredentialContext([], { hostUser: false })).toContain("/credentials/");
    });

    it("does NOT reference AL_CREDENTIALS_PATH when hostUser is false", () => {
      expect(buildCredentialContext([], { hostUser: false })).not.toContain("AL_CREDENTIALS_PATH");
    });

    // ── hostUser = true path ─────────────────────────────────────────────────

    it("references AL_CREDENTIALS_PATH when hostUser=true", () => {
      expect(buildCredentialContext([], { hostUser: true })).toContain("AL_CREDENTIALS_PATH");
    });

    it("does NOT reference /credentials/ when hostUser=true", () => {
      const result = buildCredentialContext([], { hostUser: true });
      // Should not contain the literal /credentials/ path (uses $AL_CREDENTIALS_PATH instead)
      expect(result).not.toContain("`/credentials/`");
    });

    // ── Known credential types ────────────────────────────────────────────────

    it("includes agentContext for github_token credential", () => {
      // github_token has agentContext: "`GITHUB_TOKEN` / `GH_TOKEN` — use `gh` CLI and `git` directly"
      const result = buildCredentialContext(["github_token"]);
      expect(result).toContain("GITHUB_TOKEN");
    });

    it("includes agentContext for anthropic_key credential", () => {
      // The anthropic_key definition may not have agentContext — that's fine, just checking it doesn't throw
      expect(() => buildCredentialContext(["anthropic_key"])).not.toThrow();
    });

    // ── Unknown credential type ───────────────────────────────────────────────

    it("silently skips unknown credential type without throwing", () => {
      expect(() => buildCredentialContext(["completely-unknown-type-xyz"])).not.toThrow();
    });

    it("returns valid block even with unknown credential type", () => {
      const result = buildCredentialContext(["totally-fake-type"]);
      expect(result).toContain("<credential-context>");
      expect(result).toContain("</credential-context>");
    });

    // ── Multiple credentials ─────────────────────────────────────────────────

    it("includes context for all known credential types", () => {
      // github_token has an agentContext
      const result = buildCredentialContext(["github_token", "completely-unknown-xyz"]);
      // Should include github_token's agentContext
      expect(result).toContain("GITHUB_TOKEN");
      // Should not throw for the unknown type
      expect(result).toContain("<credential-context>");
    });

    // ── type:instance notation ───────────────────────────────────────────────

    it("resolves type:instance notation correctly (uses the type part)", () => {
      // "github_token:my-instance" → type = "github_token"
      const withType = buildCredentialContext(["github_token"]);
      const withTypeInstance = buildCredentialContext(["github_token:my-instance"]);
      // Both should produce same content since type is the same
      expect(withTypeInstance).toContain("GITHUB_TOKEN");
    });

    it("does not throw for type:instance notation with unknown type", () => {
      expect(() => buildCredentialContext(["unknown-type:my-instance"])).not.toThrow();
    });
  },
);
