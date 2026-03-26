import type { CredentialDefinition } from "../schema.js";

const xTwitterWebhookSecret: CredentialDefinition = {
  id: "x_twitter_webhook_secret",
  label: "X (Twitter) Webhook Secret",
  description: "Consumer Secret (API Secret) from the X Developer Portal. Used for CRC challenge-response handshake and HMAC signature validation of incoming webhooks.",
  helpUrl: "https://developer.x.com/en/docs/twitter-api/enterprise/account-activity-api/guides/securing-webhooks",
  fields: [
    { name: "secret", label: "Consumer Secret", description: "The API Secret / Consumer Secret from your X app", secret: true },
  ],
  // No envVars or agentContext — used by the gateway, not injected into agents
};

export default xTwitterWebhookSecret;
