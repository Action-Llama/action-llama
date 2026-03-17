import { loadCredentialField } from "../shared/credentials.js";
import type { GatewayFetchOpts } from "./gateway-client.js";

/**
 * Make an authenticated request to the cloud-deployed scheduler gateway.
 * Uses the same API key as the local gateway (the cloud scheduler reads
 * the same key from its cloud secret store).
 *
 * Returns a parsed `{ ok, status, data }` result. Throws if the response
 * is not valid JSON (e.g. cloud-infra auth pages, HTML error pages).
 */
export async function cloudGatewayFetch(
  serviceUrl: string,
  opts: GatewayFetchOpts,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
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

  const url = `${base}${opts.path}`;
  const response = await fetch(url, init);
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    const body = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Cloud scheduler returned ${response.status} Unauthorized. ` +
        "Check that your local gateway_api_key matches the one deployed to the cloud."
      );
    }
    throw new Error(
      `Cloud scheduler returned unexpected ${response.status} response from ${url}\n` +
      `Content-Type: ${contentType || "(none)"}\n` +
      `Body: ${body.slice(0, 200)}`
    );
  }

  const data = await response.json() as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}
