import { resolve } from "path";
import { loadGlobalConfig } from "../shared/config.js";
import { loadCredentialField } from "../shared/credentials.js";

export interface GatewayFetchOpts {
  project: string;
  path: string;
  method?: string;
  body?: unknown;
}

/**
 * Make an authenticated request to the local gateway.
 * Reads the port from config.toml and the API key from the credential store.
 */
export async function gatewayFetch(opts: GatewayFetchOpts): Promise<Response> {
  const projectPath = resolve(opts.project);
  const globalConfig = loadGlobalConfig(projectPath);
  const gatewayPort = globalConfig.gateway?.port || 8080;

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

  return fetch(`http://localhost:${gatewayPort}${opts.path}`, init);
}
