import type { CredentialDefinition } from "../schema.js";

const sentryClientSecret: CredentialDefinition = {
  id: "sentry_client_secret",
  label: "Sentry Client Secret",
  description: "Client secret for verifying Sentry webhook payloads",
  fields: [
    { name: "secret", label: "Client Secret", description: "From your Sentry integration settings", secret: true },
  ],
  // No envVars or agentContext — used by the gateway, not injected into agents
};

export default sentryClientSecret;
