import type { CredentialDefinition } from "../schema.js";

const linearWebhookSecret: CredentialDefinition = {
  id: "linear_webhook_secret",
  label: "Linear Webhook Secret",
  description: "HMAC secret for validating Linear webhook payloads",
  helpUrl: "https://developers.linear.app/docs/webhooks",
  fields: [
    { name: "secret", label: "Webhook Secret", description: "Linear webhook secret for HMAC validation", secret: true },
  ],
  envVars: {},
  agentContext: "Used by gateway only (not injected into agents)",

  async validate(values) {
    if (!values.secret || values.secret.length < 8) {
      throw new Error("Linear webhook secret must be at least 8 characters");
    }
    return true;
  },
};

export default linearWebhookSecret;