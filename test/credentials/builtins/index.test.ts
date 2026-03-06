import { describe, it, expect } from "vitest";
import { builtinCredentials } from "../../../src/credentials/builtins/index.js";

describe("builtin credentials", () => {
  it("should include all expected credential types", () => {
    const expectedTypes = [
      "github_token",
      "anthropic_key", 
      "sentry_token",
      "git_ssh",
      "github_webhook_secret",
      "sentry_client_secret",
      "aws_credentials",
    ];
    
    for (const type of expectedTypes) {
      expect(builtinCredentials).toHaveProperty(type);
      expect(builtinCredentials[type].id).toBe(type);
    }
  });

  it("should have aws_credentials with correct structure", () => {
    const awsCreds = builtinCredentials.aws_credentials;
    expect(awsCreds).toBeDefined();
    expect(awsCreds.id).toBe("aws_credentials");
    expect(awsCreds.fields).toHaveLength(3);
    expect(awsCreds.envVars).toBeDefined();
  });
});