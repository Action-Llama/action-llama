/**
 * Unit test for credentials/builtins/linear-webhook-secret.ts
 */
import { describe, it, expect } from "vitest";
import linearWebhookSecret from "../../../src/credentials/builtins/linear-webhook-secret.js";

describe("linear-webhook-secret credential definition", () => {
  it("has id 'linear_webhook_secret'", () => {
    expect(linearWebhookSecret.id).toBe("linear_webhook_secret");
  });

  it("has at least one secret field", () => {
    const secretFields = linearWebhookSecret.fields.filter((f) => f.secret);
    expect(secretFields.length).toBeGreaterThan(0);
  });
});
