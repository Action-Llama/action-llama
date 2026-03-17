import type { CredentialDefinition } from "../schema.js";

const vultrApiKey: CredentialDefinition = {
  id: "vultr_api_key",
  label: "Vultr API Key",
  description: "API key for Vultr VPS provisioning (not needed at agent runtime)",
  helpUrl: "https://my.vultr.com/settings/#settingsapi",
  fields: [
    { name: "api_key", label: "API Key", description: "Vultr API key", secret: true },
  ],
  envVars: { api_key: "VULTR_API_KEY" },
  agentContext: "`VULTR_API_KEY` — Vultr API access (provisioning only, not typically needed by agents)",

  async validate(values) {
    const res = await fetch("https://api.vultr.com/v2/account", {
      headers: { Authorization: `Bearer ${values.api_key}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Vultr API key validation failed (HTTP ${res.status}): ${body}`);
    }
    return true;
  },
};

export default vultrApiKey;
