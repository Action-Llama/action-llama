import type { CredentialDefinition } from "../schema.js";
import { validateBugsnagToken } from "../../setup/validators.js";

const bugsnagToken: CredentialDefinition = {
  id: "bugsnag_token",
  label: "Bugsnag Auth Token",
  description: "For error monitoring and release management",
  helpUrl: "https://app.bugsnag.com/settings/my-account/auth-tokens",
  fields: [
    { name: "token", label: "Auth Token", description: "Bugsnag auth token", secret: true },
  ],
  envVars: { token: "BUGSNAG_AUTH_TOKEN" },
  agentContext: "`BUGSNAG_AUTH_TOKEN` — use for Bugsnag API requests",

  async validate(values) {
    await validateBugsnagToken(values.token);
    return true;
  },
};

export default bugsnagToken;