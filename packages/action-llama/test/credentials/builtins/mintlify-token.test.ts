/**
 * Unit test for credentials/builtins/mintlify-token.ts
 */
import { describe, it, expect } from "vitest";
import mintlifyToken from "../../../src/credentials/builtins/mintlify-token.js";

describe("mintlify-token credential definition", () => {
  it("has id 'mintlify_token'", () => {
    expect(mintlifyToken.id).toBe("mintlify_token");
  });

  it("has a token field", () => {
    const tokenField = mintlifyToken.fields.find((f) => f.name === "token");
    expect(tokenField).toBeDefined();
    expect(tokenField?.secret).toBe(true);
  });

  it("has envVars for token", () => {
    expect(mintlifyToken.envVars).toBeDefined();
    expect(mintlifyToken.envVars!.token).toBeTruthy();
  });
});
