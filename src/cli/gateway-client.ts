import { resolve } from "path";
import { loadGlobalConfig } from "../shared/config.js";
import { loadCredentialField } from "../shared/credentials.js";

export interface GatewayFetchOpts {
  project: string;
  path: string;
  method?: string;
  body?: unknown;
  env?: string;
}

/**
 * Make an authenticated request to the gateway.
 * Uses gateway.url from the resolved config when available (e.g. remote environments),
 * falling back to http://localhost:<port>.
 */
export async function gatewayFetch(opts: GatewayFetchOpts): Promise<Response> {
  const projectPath = resolve(opts.project);
  const globalConfig = loadGlobalConfig(projectPath, opts.env);
  const gatewayPort = globalConfig.gateway?.port || 8080;
  const baseUrl = globalConfig.gateway?.url || `http://localhost:${gatewayPort}`;

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

  return fetch(`${baseUrl}${opts.path}`, init);
}

/**
 * Parse JSON from a gateway response, throwing a clear error if the
 * response body is not valid JSON (e.g. HTML from a reverse proxy or
 * cloud load balancer).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function gatewayJson<T = any>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    // Trim the body preview to something readable
    const preview = text.length > 120 ? text.slice(0, 120) + "…" : text;
    throw new Error(
      `Gateway returned non-JSON response (HTTP ${response.status}). ` +
      `This usually means the gateway URL is wrong or a proxy is intercepting the request.\n` +
      `Response body: ${preview}`
    );
  }
}
