/** Try to extract content-type from stored headers JSON */
function getContentType(headersJson: string | undefined | null): string | undefined {
  if (!headersJson) return undefined;
  try {
    const h = JSON.parse(headersJson) as Record<string, string>;
    return h["content-type"] ?? h["Content-Type"];
  } catch {
    return undefined;
  }
}

/**
 * Decode the body based on content-type.
 * - application/x-www-form-urlencoded: decode params, and if any value is JSON, parse it
 * - application/json: already best shown as pretty-printed JSON — returns null
 * - base64-encoded content: attempt decode
 * Returns null if the body is already best shown as-is (i.e. it's plain JSON).
 */
export function decodeBody(
  body: string | undefined | null,
  headersJson: string | undefined | null,
): { label: string; content: string } | null {
  if (!body) return null;

  const ct = getContentType(headersJson)?.toLowerCase() ?? "";

  // Form-encoded: decode URL params and try to parse JSON values within
  if (ct.includes("application/x-www-form-urlencoded")) {
    try {
      const params = new URLSearchParams(body);
      const decoded: Record<string, unknown> = {};
      for (const [key, value] of params.entries()) {
        try {
          decoded[key] = JSON.parse(value);
        } catch {
          decoded[key] = value;
        }
      }
      return {
        label: "Decoded Body (form-urlencoded)",
        content: JSON.stringify(decoded, null, 2),
      };
    } catch {
      // fall through
    }
  }

  // If the body is not valid JSON but looks like base64, try decoding it
  if (ct.includes("application/json")) return null; // already pretty-printed as JSON

  try {
    JSON.parse(body);
    return null; // valid JSON — raw section already handles it
  } catch {
    // Not JSON — try base64
    if (/^[A-Za-z0-9+/\n\r]+=*$/.test(body.trim()) && body.trim().length > 20) {
      try {
        const decoded = atob(body.trim().replace(/\s/g, ""));
        // Check if decoded content is printable
        if (/^[\x20-\x7E\t\n\r]*$/.test(decoded)) {
          try {
            const asJson = JSON.parse(decoded);
            return {
              label: "Decoded Body (base64)",
              content: JSON.stringify(asJson, null, 2),
            };
          } catch {
            return { label: "Decoded Body (base64)", content: decoded };
          }
        }
      } catch {
        // invalid base64
      }
    }
  }

  return null;
}
