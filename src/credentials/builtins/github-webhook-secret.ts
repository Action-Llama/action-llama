import type { CredentialDefinition } from "../schema.js";

const githubWebhookSecret: CredentialDefinition = {
  id: "github-webhook-secret",
  label: "GitHub Webhook Secret",
  description: "Shared secret for verifying GitHub webhook payloads",
  filename: "github-webhook-secret",
  fields: [
    { name: "secret", label: "Webhook Secret", description: "Set this same value in your GitHub webhook settings", secret: true },
  ],
  // No envVars or agentContext — used by the gateway, not injected into agents
};

export default githubWebhookSecret;
