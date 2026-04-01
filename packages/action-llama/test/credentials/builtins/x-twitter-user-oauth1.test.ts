/**
 * Unit test for credentials/builtins/x-twitter-user-oauth1.ts
 */
import { describe, it, expect } from "vitest";
import xTwitterUserOauth1 from "../../../src/credentials/builtins/x-twitter-user-oauth1.js";

describe("x-twitter-user-oauth1 credential definition", () => {
  it("has id 'x_twitter_user_oauth1'", () => {
    expect(xTwitterUserOauth1.id).toBe("x_twitter_user_oauth1");
  });

  it("has fields: access_token and access_token_secret (both secret)", () => {
    const fieldNames = xTwitterUserOauth1.fields.map((f) => f.name);
    expect(fieldNames).toContain("access_token");
    expect(fieldNames).toContain("access_token_secret");
    xTwitterUserOauth1.fields.forEach((f) => {
      expect(f.secret).toBe(true);
    });
  });

  it("has envVars mapping access_token and access_token_secret", () => {
    expect(xTwitterUserOauth1.envVars!.access_token).toBe("X_ACCESS_TOKEN");
    expect(xTwitterUserOauth1.envVars!.access_token_secret).toBe("X_ACCESS_TOKEN_SECRET");
  });

  it("has agentContext describing the env vars", () => {
    expect(xTwitterUserOauth1.agentContext).toContain("X_ACCESS_TOKEN");
  });
});
