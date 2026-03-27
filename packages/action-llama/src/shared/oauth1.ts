/**
 * Minimal OAuth 1.0a authorization header signing (RFC 5849).
 * Used for Twitter Account Activity API calls that require user-context auth.
 */

import { createHmac, randomBytes } from "crypto";

export interface OAuth1Params {
  method: string;
  url: string;
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

/** RFC 3986 percent-encode */
function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Build an OAuth 1.0a `Authorization` header value.
 */
export function oauth1AuthorizationHeader(params: OAuth1Params): string {
  const { method, url, consumerKey, consumerSecret, accessToken, accessTokenSecret } = params;

  const nonce = randomBytes(16).toString("hex");
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: accessToken,
    oauth_version: "1.0",
  };

  // Parse query params from URL
  const urlObj = new URL(url);
  const allParams: [string, string][] = [...Object.entries(oauthParams)];
  for (const [k, v] of urlObj.searchParams.entries()) {
    allParams.push([k, v]);
  }

  // Sort by key, then by value
  allParams.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));

  const paramString = allParams.map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`).join("&");
  const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
  const signatureBase = `${method.toUpperCase()}&${percentEncode(baseUrl)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(accessTokenSecret)}`;
  const signature = createHmac("sha1", signingKey).update(signatureBase).digest("base64");

  oauthParams["oauth_signature"] = signature;

  const header = Object.entries(oauthParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(", ");

  return `OAuth ${header}`;
}
