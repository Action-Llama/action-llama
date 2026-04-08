/**
 * Integration tests: setup/validators.ts API validation functions — no Docker required.
 *
 * These functions make HTTP calls to external APIs and throw descriptive errors
 * when authentication fails. We exercise the error paths by passing obviously
 * invalid tokens/keys. Each API returns a 4xx response for invalid credentials,
 * triggering the throw branches inside each validator.
 *
 * No Docker container is needed — these are pure fetch()-based calls that
 * fail at the authentication layer.
 *
 * Covers:
 *   - setup/validators.ts: validateGitHubToken() — throws Error with "GitHub auth failed"
 *   - setup/validators.ts: validateGitHubToken() — Error instance
 *   - setup/validators.ts: validateSentryToken() — throws Error with "Sentry auth failed"
 *   - setup/validators.ts: validateSentryToken() — Error instance
 *   - setup/validators.ts: validateSentryProjects() — throws Error with "Sentry projects fetch failed"
 *   - setup/validators.ts: validateAnthropicApiKey() — throws Error with "Anthropic API key validation failed"
 *   - setup/validators.ts: validateAnthropicApiKey() — Error instance
 *   - setup/validators.ts: validateNetlifyToken() — throws Error with "Netlify auth failed"
 *   - setup/validators.ts: validateNetlifyToken() — Error instance
 *   - setup/validators.ts: validateXTwitterToken() — throws Error with "X (Twitter) API token validation failed"
 *   - setup/validators.ts: validateXTwitterToken() — Error instance
 *   - setup/validators.ts: validateBugsnagToken() — throws Error with "Bugsnag auth failed"
 *   - setup/validators.ts: validateBugsnagToken() — Error instance
 */

import { describe, it, expect } from "vitest";

const {
  validateGitHubToken,
  validateSentryToken,
  validateSentryProjects,
  validateAnthropicApiKey,
  validateNetlifyToken,
  validateXTwitterToken,
  validateBugsnagToken,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/setup/validators.js"
);

describe(
  "integration: setup/validators.ts — validateGitHubToken() error paths (invalid token)",
  { timeout: 30_000 },
  () => {
    it("validateGitHubToken(invalid) throws an Error instance", async () => {
      await expect(validateGitHubToken("invalid-github-token")).rejects.toThrow(Error);
    });

    it("validateGitHubToken(invalid) error message mentions 'GitHub auth failed'", async () => {
      await expect(validateGitHubToken("invalid-github-token")).rejects.toThrow(
        /GitHub auth failed/,
      );
    });

    it("validateGitHubToken(invalid) error message includes HTTP status code", async () => {
      let caught: Error | undefined;
      try {
        await validateGitHubToken("invalid-github-token");
      } catch (err: unknown) {
        caught = err as Error;
      }
      expect(caught).toBeDefined();
      expect(caught!.message).toMatch(/\d{3}/); // HTTP status code like 401
    });
  },
);

describe(
  "integration: setup/validators.ts — validateSentryToken() error paths (invalid token)",
  { timeout: 30_000 },
  () => {
    it("validateSentryToken(invalid) throws an Error instance", async () => {
      await expect(validateSentryToken("invalid-sentry-token")).rejects.toThrow(Error);
    });

    it("validateSentryToken(invalid) error message mentions 'Sentry auth failed'", async () => {
      await expect(validateSentryToken("invalid-sentry-token")).rejects.toThrow(
        /Sentry auth failed/,
      );
    });
  },
);

describe(
  "integration: setup/validators.ts — validateSentryProjects() error paths (invalid token)",
  { timeout: 30_000 },
  () => {
    it("validateSentryProjects(invalid, org) throws an Error instance", async () => {
      await expect(
        validateSentryProjects("invalid-sentry-token", "my-org"),
      ).rejects.toThrow(Error);
    });

    it("validateSentryProjects(invalid, org) error message mentions 'Sentry projects fetch failed'", async () => {
      await expect(
        validateSentryProjects("invalid-sentry-token", "my-org"),
      ).rejects.toThrow(/Sentry projects fetch failed/);
    });
  },
);

describe(
  "integration: setup/validators.ts — validateAnthropicApiKey() error paths (invalid key)",
  { timeout: 30_000 },
  () => {
    it("validateAnthropicApiKey(invalid) throws an Error instance", async () => {
      await expect(validateAnthropicApiKey("invalid-anthropic-key")).rejects.toThrow(Error);
    });

    it("validateAnthropicApiKey(invalid) error message mentions 'Anthropic API key validation failed'", async () => {
      await expect(validateAnthropicApiKey("invalid-anthropic-key")).rejects.toThrow(
        /Anthropic API key validation failed/,
      );
    });

    it("validateAnthropicApiKey(invalid) error message includes HTTP status code", async () => {
      let caught: Error | undefined;
      try {
        await validateAnthropicApiKey("invalid-anthropic-key");
      } catch (err: unknown) {
        caught = err as Error;
      }
      expect(caught).toBeDefined();
      expect(caught!.message).toMatch(/\d{3}/); // HTTP status code like 401
    });
  },
);

describe(
  "integration: setup/validators.ts — validateNetlifyToken() error paths (invalid token)",
  { timeout: 30_000 },
  () => {
    it("validateNetlifyToken(invalid) throws an Error instance", async () => {
      await expect(validateNetlifyToken("invalid-netlify-token")).rejects.toThrow(Error);
    });

    it("validateNetlifyToken(invalid) error message mentions 'Netlify auth failed'", async () => {
      await expect(validateNetlifyToken("invalid-netlify-token")).rejects.toThrow(
        /Netlify auth failed/,
      );
    });
  },
);

describe(
  "integration: setup/validators.ts — validateXTwitterToken() error paths (invalid token)",
  { timeout: 30_000 },
  () => {
    it("validateXTwitterToken(invalid) throws an Error instance", async () => {
      await expect(validateXTwitterToken("invalid-twitter-token")).rejects.toThrow(Error);
    });

    it("validateXTwitterToken(invalid) error message mentions 'X (Twitter) API token validation failed'", async () => {
      await expect(validateXTwitterToken("invalid-twitter-token")).rejects.toThrow(
        /X \(Twitter\) API token validation failed/,
      );
    });
  },
);

describe(
  "integration: setup/validators.ts — validateBugsnagToken() error paths (invalid token)",
  { timeout: 30_000 },
  () => {
    it("validateBugsnagToken(invalid) throws an Error instance", async () => {
      await expect(validateBugsnagToken("invalid-bugsnag-token")).rejects.toThrow(Error);
    });

    it("validateBugsnagToken(invalid) error message mentions 'Bugsnag auth failed'", async () => {
      await expect(validateBugsnagToken("invalid-bugsnag-token")).rejects.toThrow(
        /Bugsnag auth failed/,
      );
    });
  },
);
