import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { truncateEventText, validateHmacSignature } from "../../src/webhooks/validation.js";

describe("truncateEventText", () => {
  it("returns undefined for null/undefined", () => {
    expect(truncateEventText(null)).toBeUndefined();
    expect(truncateEventText(undefined)).toBeUndefined();
  });

  it("returns empty string input as undefined", () => {
    expect(truncateEventText("")).toBeUndefined();
  });

  it("returns short text unchanged", () => {
    expect(truncateEventText("hello")).toBe("hello");
  });

  it("truncates text exceeding max length", () => {
    const long = "a".repeat(5000);
    const result = truncateEventText(long)!;
    expect(result.length).toBe(4003); // 4000 + "..."
    expect(result.endsWith("...")).toBe(true);
  });

  it("supports custom max length", () => {
    const result = truncateEventText("abcdefgh", 5)!;
    expect(result).toBe("abcde...");
  });

  it("returns text at exact max length unchanged", () => {
    const exact = "a".repeat(4000);
    expect(truncateEventText(exact)).toBe(exact);
  });
});

describe("validateHmacSignature", () => {
  const secrets = {
    default: "secret-key",
    staging: "staging-key",
  };

  function hmac(body: string, secret: string, prefix = ""): string {
    return prefix + createHmac("sha256", secret).update(body).digest("hex");
  }

  it("returns _unsigned when no secrets configured and allowUnsigned is true", () => {
    expect(validateHmacSignature("body", "sig", undefined, "", true)).toBe("_unsigned");
    expect(validateHmacSignature("body", "sig", {}, "", true)).toBe("_unsigned");
  });

  it("returns null when no secrets configured and allowUnsigned is false (default)", () => {
    expect(validateHmacSignature("body", "sig", undefined)).toBeNull();
    expect(validateHmacSignature("body", "sig", {})).toBeNull();
    expect(validateHmacSignature("body", "sig", undefined, "", false)).toBeNull();
    expect(validateHmacSignature("body", "sig", {}, "", false)).toBeNull();
  });

  it("returns null when no signature provided", () => {
    expect(validateHmacSignature("body", undefined, secrets)).toBeNull();
  });

  it("validates correct signature without prefix", () => {
    const sig = hmac("body", "secret-key");
    expect(validateHmacSignature("body", sig, secrets)).toBe("default");
  });

  it("validates correct signature with prefix", () => {
    const sig = hmac("body", "secret-key", "sha256=");
    expect(validateHmacSignature("body", sig, secrets, "sha256=")).toBe("default");
  });

  it("matches against correct secret instance", () => {
    const sig = hmac("body", "staging-key");
    expect(validateHmacSignature("body", sig, secrets)).toBe("staging");
  });

  it("returns null for invalid signature", () => {
    expect(validateHmacSignature("body", "invalid-signature", secrets)).toBeNull();
  });

  it("returns null for wrong body", () => {
    const sig = hmac("body", "secret-key");
    expect(validateHmacSignature("different-body", sig, secrets)).toBeNull();
  });

  it("returns null for signature with wrong prefix", () => {
    const sig = hmac("body", "secret-key", "sha256=");
    // No prefix expected but signature has one → length mismatch → null
    expect(validateHmacSignature("body", sig, secrets)).toBeNull();
  });
});
