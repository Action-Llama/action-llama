/**
 * Unit test for credentials/builtins/sentry-client-secret.ts
 */
import { describe, it, expect } from "vitest";
import sentryClientSecret from "../../../src/credentials/builtins/sentry-client-secret.js";

describe("sentry-client-secret credential definition", () => {
  it("has id 'sentry_client_secret'", () => {
    expect(sentryClientSecret.id).toBe("sentry_client_secret");
  });

  it("has exactly one field: secret (marked as secret)", () => {
    expect(sentryClientSecret.fields).toHaveLength(1);
    expect(sentryClientSecret.fields[0].name).toBe("secret");
    expect(sentryClientSecret.fields[0].secret).toBe(true);
  });

  it("has no envVars (gateway-only, not injected into agents)", () => {
    expect(sentryClientSecret.envVars).toBeUndefined();
  });
});
