import type { CredentialDefinition } from "../schema.js";

async function validateLinearOAuth(token: string): Promise<void> {
  if (!token) throw new Error("Linear OAuth token is required");
  
  // Test the OAuth token by making a simple API call
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
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
      throw new Error("Invalid Linear OAuth token");
    }
    throw new Error(`Linear API error: ${response.status}`);
  }

  const data = await response.json();
  if (data.errors) {
    throw new Error("Invalid Linear OAuth token or insufficient permissions");
  }
}

const linearOAuth: CredentialDefinition = {
  id: "linear_oauth",
  label: "Linear OAuth2 Token",
  description: "OAuth2 access token for Linear workspace access",
  helpUrl: "https://developers.linear.app/docs/oauth/authentication",
  fields: [
    { name: "client_id", label: "Client ID", description: "Linear OAuth application client ID", secret: false },
    { name: "client_secret", label: "Client Secret", description: "Linear OAuth application client secret", secret: true },
    { name: "access_token", label: "Access Token", description: "OAuth2 access token", secret: true },
    { name: "refresh_token", label: "Refresh Token", description: "OAuth2 refresh token (optional)", secret: true },
  ],
  envVars: { 
    client_id: "LINEAR_CLIENT_ID",
    client_secret: "LINEAR_CLIENT_SECRET", 
    access_token: "LINEAR_ACCESS_TOKEN",
    refresh_token: "LINEAR_REFRESH_TOKEN",
  },
  agentContext: "`LINEAR_ACCESS_TOKEN` / `LINEAR_CLIENT_ID` / `LINEAR_CLIENT_SECRET` — use for Linear OAuth API access",

  async validate(values) {
    await validateLinearOAuth(values.access_token);
    return true;
  },
};

export default linearOAuth;