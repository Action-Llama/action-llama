import type { CredentialDefinition } from "../schema.js";

const cloudflareApiToken: CredentialDefinition = {
  id: "cloudflare_api_token",
  label: "Cloudflare API Token",
  description: "API token for Cloudflare DNS and Origin CA management (not needed at agent runtime)",
  helpUrl: "https://dash.cloudflare.com/profile/api-tokens",
  fields: [
    { name: "api_token", label: "API Token", description: "Cloudflare API token with Zone:DNS:Edit and Zone:SSL:Edit permissions", secret: true },
  ],
  envVars: { api_token: "CLOUDFLARE_API_TOKEN" },
  agentContext: "`CLOUDFLARE_API_TOKEN` — Cloudflare API access (provisioning only, not typically needed by agents)",

  async validate(values) {
    const { verifyToken } = await import("../../cloud/vps/cloudflare-api.js");
    const active = await verifyToken(values.api_token);
    if (!active) {
      throw new Error("Cloudflare API token is not active");
    }
    return true;
  },
};

export default cloudflareApiToken;
