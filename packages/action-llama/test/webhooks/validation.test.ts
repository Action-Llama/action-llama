import { describe, it, expect } from "vitest";
import { createHmac, generateKeyPairSync, sign } from "crypto";
import { truncateEventText, validateHmacSignature, validateEd25519Signature } from "../../src/webhooks/validation.js";

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

describe("validateEd25519Signature", () => {
  // Generate an Ed25519 keypair for tests
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  // Export the raw 32-byte public key as hex
  const rawPublicKeyHex = publicKey.export({ type: "spki", format: "der" }).subarray(12).toString("hex");

  function signPayload(body: string, timestamp: string): string {
    const message = Buffer.from(timestamp + body);
    return sign(null, message, privateKey).toString("hex");
  }

  const TIMESTAMP = "1700000000";
  const BODY = '{"type":2,"data":{}}';

  it("returns _unsigned when no secrets configured and allowUnsigned is true", () => {
    expect(validateEd25519Signature(BODY, TIMESTAMP, "sig", undefined, true)).toBe("_unsigned");
    expect(validateEd25519Signature(BODY, TIMESTAMP, "sig", {}, true)).toBe("_unsigned");
  });

  it("returns null when no secrets configured and allowUnsigned is false (default)", () => {
    expect(validateEd25519Signature(BODY, TIMESTAMP, "sig", undefined)).toBeNull();
    expect(validateEd25519Signature(BODY, TIMESTAMP, "sig", {})).toBeNull();
  });

  it("returns null when signature is missing", () => {
    expect(validateEd25519Signature(BODY, TIMESTAMP, undefined, { key: rawPublicKeyHex })).toBeNull();
  });

  it("returns null when timestamp is missing", () => {
    const sig = signPayload(BODY, TIMESTAMP);
    expect(validateEd25519Signature(BODY, undefined, sig, { key: rawPublicKeyHex })).toBeNull();
  });

  it("returns null when signature decodes to wrong byte length (not 64 bytes)", () => {
    // A short hex string will decode to < 64 bytes
    const shortSig = "abcd";
    expect(validateEd25519Signature(BODY, TIMESTAMP, shortSig, { key: rawPublicKeyHex })).toBeNull();
  });

  it("validates correct Ed25519 signature and returns instance name", () => {
    const sig = signPayload(BODY, TIMESTAMP);
    expect(validateEd25519Signature(BODY, TIMESTAMP, sig, { myApp: rawPublicKeyHex })).toBe("myApp");
  });

  it("returns null for wrong body", () => {
    const sig = signPayload("wrong-body", TIMESTAMP);
    expect(validateEd25519Signature(BODY, TIMESTAMP, sig, { myApp: rawPublicKeyHex })).toBeNull();
  });

  it("skips keys with wrong decoded length (not 32 bytes) and returns null if no valid key matches", () => {
    // "ab" decodes to a 1-byte buffer, which is not 32 bytes
    const shortKeyHex = "ab";
    const sig = signPayload(BODY, TIMESTAMP);
    expect(validateEd25519Signature(BODY, TIMESTAMP, sig, { shortKey: shortKeyHex })).toBeNull();
  });

  it("skips malformed key entries and tries remaining keys", () => {
    // First key is short (skipped), second key is valid
    const sig = signPayload(BODY, TIMESTAMP);
    const secrets = { badKey: "ab", goodKey: rawPublicKeyHex };
    expect(validateEd25519Signature(BODY, TIMESTAMP, sig, secrets)).toBe("goodKey");
  });
});
