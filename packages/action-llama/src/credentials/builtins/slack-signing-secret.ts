import type { CredentialDefinition } from "../schema.js";

const slackSigningSecret: CredentialDefinition = {
  id: "slack_signing_secret",
  label: "Slack Signing Secret",
  description: "Signing secret for verifying Slack webhook payloads. Found in your Slack app settings under App Settings → Basic Information → App Credentials.",
  helpUrl: "https://api.slack.com/authentication/verifying-requests-from-slack",
  fields: [
    { name: "secret", label: "Signing Secret", description: "Slack app signing secret (found in App Settings → Basic Information → App Credentials)", secret: true },
  ],
  // No envVars or agentContext — used by the gateway, not injected into agents

  async validate(values) {
    if (!values.secret) throw new Error("Signing secret is required");
    if (values.secret.length < 8) throw new Error("Signing secret must be at least 8 characters");
    return true;
  },
};

export default slackSigningSecret;
