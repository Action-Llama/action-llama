import { loadCredentialField } from "../shared/credentials.js";
import type { GatewayFetchOpts } from "./gateway-client.js";

/**
 * Make an authenticated request to the cloud-deployed scheduler gateway.
 * Uses the same API key as the local gateway (the cloud scheduler reads
 * the same key from its cloud secret store).
 */
export async function cloudGatewayFetch(
  serviceUrl: string,
  opts: GatewayFetchOpts,
): Promise<Response> {
  const base = serviceUrl.replace(/\/+$/, "");

  const headers: Record<string, string> = {};

  const apiKey = await loadCredentialField("gateway_api_key", "default", "key");
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const init: RequestInit = {
    method: opts.method || "GET",
    headers,
  };

  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }

  return fetch(`${base}${opts.path}`, init);
}
