import type { CredentialDefinition } from "../schema.js";

const mintlifyWebhookSecret: CredentialDefinition = {
  id: "mintlify_webhook_secret",
  label: "Mintlify Webhook Secret",
  description: "Shared secret for verifying Mintlify webhook payloads. Generate any random string, then paste it here AND in your Mintlify project's webhook settings.",
  helpUrl: "https://mintlify.com/docs/api-reference/webhooks",
  fields: [
    { name: "secret", label: "Webhook Secret", description: "Set this same value in your Mintlify webhook settings", secret: true },
  ],
  // No envVars or agentContext — used by the gateway, not injected into agents
};

export default mintlifyWebhookSecret;