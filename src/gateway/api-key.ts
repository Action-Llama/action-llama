import { randomBytes } from "crypto";
import { loadCredentialField, writeCredentialField } from "../shared/credentials.js";

const CRED_TYPE = "gateway_api_key";
const CRED_INSTANCE = "default";
const CRED_FIELD = "key";

export interface ApiKeyResult {
  key: string;
  generated: boolean;
}

/**
 * Load the gateway API key from the credential store,
 * or generate one if it doesn't exist yet.
 */
export async function ensureGatewayApiKey(): Promise<ApiKeyResult> {
  const existing = await loadCredentialField(CRED_TYPE, CRED_INSTANCE, CRED_FIELD);
  if (existing) {
    return { key: existing, generated: false };
  }

  const key = randomBytes(32).toString("base64url");
  await writeCredentialField(CRED_TYPE, CRED_INSTANCE, CRED_FIELD, key);
  return { key, generated: true };
}
