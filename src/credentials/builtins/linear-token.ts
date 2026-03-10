import type { CredentialDefinition } from "../schema.js";

async function validateLinearToken(token: string): Promise<void> {
  if (!token) throw new Error("Linear token is required");
  
  // Test the token by making a simple API call
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `
        query {
          viewer {
            id
            name
          }
        }
      `,
    }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Invalid Linear token");
    }
    throw new Error(`Linear API error: ${response.status}`);
  }

  const data = await response.json();
  if (data.errors) {
    throw new Error("Invalid Linear token or insufficient permissions");
  }
}

const linearToken: CredentialDefinition = {
  id: "linear_token",
  label: "Linear Personal API Token",
  description: "Personal API token for Linear workspace access",
  helpUrl: "https://linear.app/settings/api",
  fields: [
    { name: "token", label: "API Token", description: "Linear personal API token (lin_api_...)", secret: true },
  ],
  envVars: { token: "LINEAR_API_TOKEN" },
  agentContext: "`LINEAR_API_TOKEN` — use for Linear API access via curl or HTTP libraries",

  async validate(values) {
    await validateLinearToken(values.token);
    return true;
  },
};

export default linearToken;