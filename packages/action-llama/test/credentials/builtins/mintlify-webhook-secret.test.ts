/**
 * Unit test for credentials/builtins/mintlify-webhook-secret.ts
 */
import { describe, it, expect } from "vitest";
import mintlifyWebhookSecret from "../../../src/credentials/builtins/mintlify-webhook-secret.js";

describe("mintlify-webhook-secret credential definition", () => {
  it("has id 'mintlify_webhook_secret'", () => {
    expect(mintlifyWebhookSecret.id).toBe("mintlify_webhook_secret");
  });

  it("has a secret field", () => {
    expect(mintlifyWebhookSecret.fields.length).toBeGreaterThan(0);
    const secretField = mintlifyWebhookSecret.fields[0];
    expect(secretField.secret).toBe(true);
  });
});
