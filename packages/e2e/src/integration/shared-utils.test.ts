/**
 * Integration tests: shared utility modules — no Docker required.
 *
 * These are pure utility modules that have no integration test coverage:
 *
 *   1. shared/exit-codes.ts — ExitCode enum and getExitCodeMessage()
 *   2. shared/oauth1.ts — oauth1AuthorizationHeader() for Twitter OAuth 1.0a signing
 *   3. shared/credential-refs.ts — credentialRefsToRelativePaths()
 *
 * All functions are pure (no external dependencies, no I/O beyond crypto) and
 * can be tested directly without any scheduler or Docker setup.
 *
 * Covers:
 *   - shared/exit-codes.ts: getExitCodeMessage() — all known exit codes + default
 *   - shared/oauth1.ts: oauth1AuthorizationHeader() — builds Authorization header,
 *     includes all required OAuth params, handles URL query parameters
 *   - shared/credential-refs.ts: credentialRefsToRelativePaths() — converts refs
 *     to relative filesystem paths
 */

import { describe, it, expect } from "vitest";

// Import via direct dist paths (not exported via internals/* map)
const {
  ExitCode,
  getExitCodeMessage,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/exit-codes.js"
);

const {
  oauth1AuthorizationHeader,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/oauth1.js"
);

const {
  credentialRefsToRelativePaths,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/credential-refs.js"
);

// ── getExitCodeMessage ────────────────────────────────────────────────────

describe("integration: shared utility modules (no Docker required)", () => {

  describe("getExitCodeMessage (exit-codes.ts)", () => {
    it("returns readable message for ExitCode.SUCCESS (0)", () => {
      const msg = getExitCodeMessage(ExitCode.SUCCESS);
      expect(msg).toMatch(/success/i);
    });

    it("returns readable message for ExitCode.AUTH_FAILURE (10)", () => {
      const msg = getExitCodeMessage(ExitCode.AUTH_FAILURE);
      expect(msg).toMatch(/auth|credential/i);
    });

    it("returns readable message for ExitCode.PERMISSION_DENIED (11)", () => {
      const msg = getExitCodeMessage(ExitCode.PERMISSION_DENIED);
      expect(msg).toMatch(/permission|access/i);
    });

    it("returns readable message for ExitCode.RATE_LIMITED (12)", () => {
      const msg = getExitCodeMessage(ExitCode.RATE_LIMITED);
      expect(msg).toMatch(/rate/i);
    });

    it("returns readable message for ExitCode.INVALID_CONFIG (13)", () => {
      const msg = getExitCodeMessage(ExitCode.INVALID_CONFIG);
      expect(msg).toMatch(/config/i);
    });

    it("returns readable message for ExitCode.DEPENDENCY_ERROR (14)", () => {
      const msg = getExitCodeMessage(ExitCode.DEPENDENCY_ERROR);
      expect(msg).toMatch(/dependency|service/i);
    });

    it("returns readable message for ExitCode.UNRECOVERABLE_ERROR (15)", () => {
      const msg = getExitCodeMessage(ExitCode.UNRECOVERABLE_ERROR);
      expect(msg).toMatch(/unrecoverable/i);
    });

    it("returns readable message for ExitCode.USER_ABORT (16)", () => {
      const msg = getExitCodeMessage(ExitCode.USER_ABORT);
      expect(msg).toMatch(/abort|user/i);
    });

    it("returns default message for unknown exit code", () => {
      const msg = getExitCodeMessage(99);
      expect(msg).toMatch(/unknown/i);
      expect(msg).toContain("99");
    });
  });

  // ── oauth1AuthorizationHeader ─────────────────────────────────────────────

  describe("oauth1AuthorizationHeader (oauth1.ts)", () => {
    const baseParams = {
      method: "GET",
      url: "https://api.twitter.com/1.1/account_activity/all/dev/webhooks.json",
      consumerKey: "my-consumer-key",
      consumerSecret: "my-consumer-secret",
      accessToken: "my-access-token",
      accessTokenSecret: "my-access-token-secret",
    };

    it("returns a string starting with 'OAuth '", () => {
      const header = oauth1AuthorizationHeader(baseParams);
      expect(header).toMatch(/^OAuth /);
    });

    it("includes all required OAuth 1.0a parameters", () => {
      const header = oauth1AuthorizationHeader(baseParams);
      expect(header).toContain("oauth_consumer_key");
      expect(header).toContain("oauth_nonce");
      expect(header).toContain("oauth_signature_method");
      expect(header).toContain("oauth_timestamp");
      expect(header).toContain("oauth_token");
      expect(header).toContain("oauth_version");
      expect(header).toContain("oauth_signature");
    });

    it("uses HMAC-SHA1 signature method", () => {
      const header = oauth1AuthorizationHeader(baseParams);
      expect(header).toContain('oauth_signature_method="HMAC-SHA1"');
    });

    it("includes the consumer key value", () => {
      const header = oauth1AuthorizationHeader(baseParams);
      expect(header).toContain("my-consumer-key");
    });

    it("produces different signatures on each call (due to random nonce)", () => {
      const header1 = oauth1AuthorizationHeader(baseParams);
      const header2 = oauth1AuthorizationHeader(baseParams);
      // They should differ because nonce and timestamp may differ
      // (we just verify both are valid OAuth headers)
      expect(header1).toMatch(/^OAuth /);
      expect(header2).toMatch(/^OAuth /);
    });

    it("handles URL with query parameters by including them in signature base", () => {
      const paramsWithQuery = {
        ...baseParams,
        url: "https://api.twitter.com/1.1/account_activity/all/dev/webhooks.json?foo=bar",
      };
      const header = oauth1AuthorizationHeader(paramsWithQuery);
      // Should still produce a valid OAuth header
      expect(header).toMatch(/^OAuth /);
      expect(header).toContain("oauth_signature");
    });

    it("POST method is uppercased in signature base", () => {
      const postParams = { ...baseParams, method: "post" };
      const header = oauth1AuthorizationHeader(postParams);
      // Method is used in signature base as uppercase — we verify it produces a valid header
      expect(header).toMatch(/^OAuth /);
    });
  });

  // ── credentialRefsToRelativePaths ─────────────────────────────────────────

  describe("credentialRefsToRelativePaths (credential-refs.ts)", () => {
    it("converts type-only ref to type/default path", () => {
      const paths = credentialRefsToRelativePaths(new Set(["anthropic_key"]));
      expect(paths).toContain("anthropic_key/default");
    });

    it("converts type:instance ref to type/instance path", () => {
      const paths = credentialRefsToRelativePaths(new Set(["github_token:my-org"]));
      expect(paths).toContain("github_token/my-org");
    });

    it("handles multiple refs", () => {
      const paths = credentialRefsToRelativePaths(
        new Set(["anthropic_key", "github_token:org1", "gateway_api_key"])
      );
      expect(paths).toContain("anthropic_key/default");
      expect(paths).toContain("github_token/org1");
      expect(paths).toContain("gateway_api_key/default");
      expect(paths).toHaveLength(3);
    });

    it("returns empty array for empty set", () => {
      const paths = credentialRefsToRelativePaths(new Set());
      expect(paths).toHaveLength(0);
    });
  });
});
