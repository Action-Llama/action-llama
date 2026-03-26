import { createHmac, timingSafeEqual, verify, createPublicKey } from "crypto";

const MAX_TEXT_LENGTH = 4000;

/**
 * Truncate text to a maximum length, appending "..." if truncated.
 */
export function truncateEventText(text: string | undefined | null, max = MAX_TEXT_LENGTH): string | undefined {
  if (!text) return undefined;
  return text.length > max ? text.slice(0, max) + "..." : text;
}

/**
 * Validate an HMAC-SHA256 webhook signature against one or more secrets.
 *
 * Returns the instance name of the matching secret, "_unsigned" if no secrets
 * are configured and allowUnsigned is true, or null if validation fails.
 *
 * @param rawBody      - The raw request body string
 * @param signature    - The signature header value (e.g. "sha256=abc123" or just "abc123")
 * @param secrets      - Map of instance name → secret value
 * @param prefix       - Optional prefix the provider prepends to the HMAC hex (e.g. "sha256=" for GitHub)
 * @param allowUnsigned - Allow unsigned webhooks when no secrets configured (default: false)
 */
export function validateHmacSignature(
  rawBody: string,
  signature: string | undefined,
  secrets: Record<string, string> | undefined,
  prefix = "",
  allowUnsigned = false,
): string | null {
  // If no secrets configured, check allowUnsigned policy
  if (!secrets || Object.keys(secrets).length === 0) {
    return allowUnsigned ? "_unsigned" : null;
  }

  if (!signature) return null;

  // Try each configured secret — different orgs/repos may use different secrets
  for (const [instanceName, secret] of Object.entries(secrets)) {
    const expected = prefix + createHmac("sha256", secret).update(rawBody).digest("hex");
    if (signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return instanceName;
    }
  }

  return null;
}

const ED25519_DER_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Validate an Ed25519 webhook signature (used by Discord).
 *
 * Discord signs `timestamp + rawBody` using its application's Ed25519 private key.
 * The public key is hex-encoded (32 bytes raw). We wrap it in DER-encoded SPKI
 * by prepending the standard Ed25519 DER header.
 *
 * Returns the instance name of the matching key, "_unsigned" if no keys
 * are configured and allowUnsigned is true, or null if validation fails.
 */
export function validateEd25519Signature(
  rawBody: string,
  timestamp: string | undefined,
  signature: string | undefined,
  secrets: Record<string, string> | undefined,
  allowUnsigned = false,
): string | null {
  if (!secrets || Object.keys(secrets).length === 0) {
    return allowUnsigned ? "_unsigned" : null;
  }
  if (!signature || !timestamp) return null;

  const message = Buffer.from(timestamp + rawBody);
  let sigBuffer: Buffer;
  try {
    sigBuffer = Buffer.from(signature, "hex");
    if (sigBuffer.length !== 64) return null;
  } catch {
    return null;
  }

  for (const [instanceName, publicKeyHex] of Object.entries(secrets)) {
    try {
      const rawKey = Buffer.from(publicKeyHex, "hex");
      if (rawKey.length !== 32) continue;
      const derKey = Buffer.concat([ED25519_DER_PREFIX, rawKey]);
      const keyObject = createPublicKey({ key: derKey, format: "der", type: "spki" });
      const isValid = verify(null, message, keyObject, sigBuffer);
      if (isValid) return instanceName;
    } catch {
      continue;
    }
  }
  return null;
}
