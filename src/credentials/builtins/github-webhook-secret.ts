import type { CredentialDefinition } from "../schema.js";

const githubWebhookSecret: CredentialDefinition = {
  id: "github_webhook_secret",
  label: "GitHub Webhook Secret",
  description: "Shared secret for verifying GitHub webhook payloads. Generate any random string, then paste it here AND in your GitHub repo's webhook settings (Settings → Webhooks → Secret).",
  helpUrl: "https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries",
  fields: [
    { name: "secret", label: "Webhook Secret", description: "Set this same value in your GitHub webhook settings", secret: true },
  ],
  // No envVars or agentContext — used by the gateway, not injected into agents
};

export default githubWebhookSecret;
