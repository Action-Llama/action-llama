/**
 * GCP service account JWT authentication.
 * Uses only Node.js built-in `crypto` — no external dependencies.
 */

import { createSign } from "crypto";

export interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number; // Unix timestamp (ms)
}

export function parseServiceAccountKey(json: string): ServiceAccountKey {
  let key: any;
  try {
    key = JSON.parse(json);
  } catch {
    throw new Error("Invalid JSON — expected a service account key file");
  }
  if (key.type !== "service_account") {
    throw new Error('JSON key type must be "service_account"');
  }
  if (!key.private_key || !key.client_email || !key.project_id) {
    throw new Error("JSON key missing required fields (private_key, client_email, project_id)");
  }
  return key as ServiceAccountKey;
}

function base64url(data: string | Buffer): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export class GcpAuth {
  private key: ServiceAccountKey;
  private cached: CachedToken | null = null;

  constructor(key: ServiceAccountKey) {
    this.key = key;
  }

  /**
   * Get a valid access token (cached, auto-refreshed 5 min before expiry).
   */
  async getAccessToken(): Promise<string> {
    const now = Date.now();
    // Return cached token if still valid (with 5-minute buffer)
    if (this.cached && this.cached.expiresAt - now > 5 * 60 * 1000) {
      return this.cached.accessToken;
    }

    const nowSec = Math.floor(now / 1000);
    const expSec = nowSec + 3600;

    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64url(
      JSON.stringify({
        iss: this.key.client_email,
        scope: "https://www.googleapis.com/auth/cloud-platform",
        aud: "https://oauth2.googleapis.com/token",
        iat: nowSec,
        exp: expSec,
      })
    );

    const signingInput = `${header}.${payload}`;
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    const signature = base64url(signer.sign(this.key.private_key));
    const jwt = `${signingInput}.${signature}`;

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GCP token exchange failed (HTTP ${res.status}): ${body}`);
    }

    const data = await res.json() as { access_token: string; expires_in: number };
    this.cached = {
      accessToken: data.access_token,
      expiresAt: now + data.expires_in * 1000,
    };

    return this.cached.accessToken;
  }
}
