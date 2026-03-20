import type { CredentialDefinition } from "../schema.js";

const mintlifyToken: CredentialDefinition = {
  id: "mintlify_token",
  label: "Mintlify API Token",
  description: "API token for accessing Mintlify's API to get build logs, trigger rebuilds, and manage documentation projects.",
  helpUrl: "https://mintlify.com/docs/api-reference/authentication",
  fields: [
    { name: "token", label: "API Token", description: "Mintlify API token", secret: true },
  ],
  envVars: { token: "MINTLIFY_API_TOKEN" },
  agentContext: "`MINTLIFY_API_TOKEN` — use for API access to Mintlify services",

  // Note: Add validation later if Mintlify provides a test endpoint
};

export default mintlifyToken;