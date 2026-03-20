import type { CredentialDefinition } from "../schema.js";

const hetznerApiKey: CredentialDefinition = {
  id: "hetzner_api_key",
  label: "Hetzner API Key",
  description: "API key for Hetzner Cloud VPS provisioning (not needed at agent runtime)",
  helpUrl: "https://console.hetzner.cloud/projects",
  fields: [
    { name: "api_key", label: "API Key", description: "Hetzner Cloud API key", secret: true },
  ],
  envVars: { api_key: "HETZNER_API_KEY" },
  agentContext: "`HETZNER_API_KEY` — Hetzner Cloud API access (provisioning only, not typically needed by agents)",

  async validate(values) {
    const res = await fetch("https://api.hetzner.cloud/v1/server_types", {
      headers: { Authorization: `Bearer ${values.api_key}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: { message: "Unknown error" } }));
      const errorMessage = body.error?.message || `HTTP ${res.status}`;
      throw new Error(`Hetzner API key validation failed: ${errorMessage}`);
    }
    return true;
  },
};

export default hetznerApiKey;