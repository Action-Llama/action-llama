import type { CredentialDefinition } from "../schema.js";
import { validateNetlifyToken } from "../../setup/validators.js";

const netlifyToken: CredentialDefinition = {
  id: "netlify_token",
  label: "Netlify Personal Access Token",
  description: "For managing Netlify sites and deployments",
  helpUrl: "https://app.netlify.com/user/applications#personal-access-tokens",
  fields: [
    { name: "token", label: "Access Token", description: "Netlify PAT", secret: true },
  ],
  envVars: { token: "NETLIFY_AUTH_TOKEN" },
  agentContext: "`NETLIFY_AUTH_TOKEN` — use for Netlify API requests",

  async validate(values) {
    await validateNetlifyToken(values.token);
    return true;
  },
};

export default netlifyToken;