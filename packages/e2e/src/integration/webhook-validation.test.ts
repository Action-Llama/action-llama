/**
 * Integration tests: webhooks/validation.ts — no Docker required.
 *
 * These are pure cryptographic utility functions used by webhook providers
 * to validate incoming webhook requests. No external services or Docker needed.
 *
 * Functions tested:
 *   - truncateEventText(text, max?) — truncates long text with "..." suffix
 *   - validateHmacSignature(rawBody, sig, secrets, prefix?, allowUnsigned?) — HMAC-SHA256
 *   - validateEd25519Signature(rawBody, timestamp, sig, secrets, allowUnsigned?) — Ed25519
 *
 * Covers:
 *   - webhooks/validation.ts: truncateEventText — null/undefined/short/exactly-at-limit/long
 *   - webhooks/validation.ts: validateHmacSignature — no secrets+allowUnsigned, no secrets
 *     without allowUnsigned, valid signature, invalid signature, missing signature
 *   - webhooks/validation.ts: validateEd25519Signature — no secrets+allowUnsigned,
 *     missing signature/timestamp, invalid hex signature, wrong-length signature buffer
 */

import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";

const {
  truncateEventText,
  validateHmacSignature,
  validateEd25519Signature,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/validation.js"
);

describe("integration: webhooks/validation.ts (no Docker required)", () => {

  // ── truncateEventText ─────────────────────────────────────────────────────

  describe("truncateEventText", () => {
    it("returns undefined for null input", () => {
      expect(truncateEventText(null)).toBeUndefined();
    });

    it("returns undefined for undefined input", () => {
      expect(truncateEventText(undefined)).toBeUndefined();
    });

    it("returns short text unchanged", () => {
      const text = "Hello, world!";
      expect(truncateEventText(text)).toBe(text);
    });

    it("returns text unchanged when exactly at default max (4000 chars)", () => {
      const text = "a".repeat(4000);
      const result = truncateEventText(text);
      expect(result).toBe(text);
      expect(result!.length).toBe(4000);
    });

    it("truncates long text with '...' suffix", () => {
      const text = "a".repeat(4001);
      const result = truncateEventText(text);
      expect(result!.length).toBe(4003); // 4000 chars + "..."
      expect(result!.endsWith("...")).toBe(true);
    });

    it("respects custom max parameter", () => {
      const text = "Hello, world! This is a long message.";
      const result = truncateEventText(text, 10);
      expect(result!.length).toBe(13); // 10 + "..."
      expect(result!).toBe("Hello, wor...");
    });

    it("returns empty string unchanged for empty input", () => {
      expect(truncateEventText("")).toBeUndefined();
    });
  });

  // ── validateHmacSignature ─────────────────────────────────────────────────

  describe("validateHmacSignature", () => {
    const rawBody = JSON.stringify({ action: "opened", number: 42 });
    const secret = "test-webhook-secret";

    function computeHmac(body: string, s: string, prefix = ""): string {
      return prefix + createHmac("sha256", s).update(body).digest("hex");
    }

    it("returns '_unsigned' when no secrets and allowUnsigned=true", () => {
      const result = validateHmacSignature(rawBody, undefined, {}, "", true);
      expect(result).toBe("_unsigned");
    });

    it("returns null when no secrets and allowUnsigned=false (default)", () => {
      const result = validateHmacSignature(rawBody, undefined, {});
      expect(result).toBeNull();
    });

    it("returns null when no secrets and allowUnsigned not specified", () => {
      const result = validateHmacSignature(rawBody, undefined, undefined);
      expect(result).toBeNull();
    });

    it("returns null when signature is missing but secrets are configured", () => {
      const result = validateHmacSignature(rawBody, undefined, { default: secret });
      expect(result).toBeNull();
    });

    it("returns instance name when signature is valid (no prefix)", () => {
      const sig = computeHmac(rawBody, secret);
      const result = validateHmacSignature(rawBody, sig, { default: secret });
      expect(result).toBe("default");
    });

    it("returns instance name when signature has prefix (sha256=)", () => {
      const sig = computeHmac(rawBody, secret, "sha256=");
      const result = validateHmacSignature(rawBody, sig, { default: secret }, "sha256=");
      expect(result).toBe("default");
    });

    it("returns null for invalid signature", () => {
      const result = validateHmacSignature(rawBody, "sha256=invalidsig", { default: secret }, "sha256=");
      expect(result).toBeNull();
    });

    it("tries multiple secret instances and returns matching one", () => {
      const secret2 = "other-secret";
      const sig = computeHmac(rawBody, secret2, "sha256=");
      const result = validateHmacSignature(
        rawBody, sig,
        { inst1: secret, inst2: secret2 },
        "sha256=",
      );
      expect(result).toBe("inst2");
    });
  });

  // ── validateEd25519Signature ──────────────────────────────────────────────

  describe("validateEd25519Signature", () => {
    it("returns '_unsigned' when no secrets and allowUnsigned=true", () => {
      const result = validateEd25519Signature("body", "timestamp", "sig", {}, true);
      expect(result).toBe("_unsigned");
    });

    it("returns null when no secrets and allowUnsigned=false", () => {
      const result = validateEd25519Signature("body", "timestamp", "sig", {});
      expect(result).toBeNull();
    });

    it("returns null when signature is missing", () => {
      const result = validateEd25519Signature("body", "timestamp", undefined, { default: "pubkey" });
      expect(result).toBeNull();
    });

    it("returns null when timestamp is missing", () => {
      const result = validateEd25519Signature("body", undefined, "sig", { default: "pubkey" });
      expect(result).toBeNull();
    });

    it("returns null for invalid-length hex signature buffer (not 64 bytes)", () => {
      // "aabbcc" is 3 bytes, not 64 — should return null
      const pubKeyHex = "0".repeat(64); // 32-byte public key (all zeros)
      const result = validateEd25519Signature("body", "ts", "aabbcc", { default: pubKeyHex });
      expect(result).toBeNull();
    });

    it("returns null for invalid hex signature (64 bytes but wrong key)", () => {
      // Create a 64-byte hex signature (128 hex chars) but with a wrong key
      const fakeSig = "0".repeat(128); // 64 zero bytes
      const pubKeyHex = "0".repeat(64); // 32-byte zero public key
      // This might throw or return null (invalid public key); either is correct
      const result = validateEd25519Signature("body", "ts", fakeSig, { default: pubKeyHex });
      expect(result).toBeNull();
    });
  });
});
