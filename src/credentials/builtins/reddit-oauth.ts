import type { CredentialDefinition } from "../schema.js";

async function validateRedditOAuth(clientId: string, clientSecret: string, username: string, password: string, userAgent: string): Promise<void> {
  if (!clientId) throw new Error("Reddit client ID is required");
  if (!clientSecret) throw new Error("Reddit client secret is required");
  if (!username) throw new Error("Reddit username is required");
  if (!password) throw new Error("Reddit password is required");
  if (!userAgent) throw new Error("Reddit user agent is required");
  
  // Test OAuth2 with Reddit's script app flow
  // Reddit uses a "script" app type which requires username/password authentication
  const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  
  const response = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${authHeader}`,
      'User-Agent': userAgent,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      'grant_type': 'password',
      'username': username,
      'password': password,
    }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Invalid Reddit credentials or app configuration");
    }
    if (response.status === 429) {
      throw new Error("Reddit API rate limit exceeded - try again later");
    }
    throw new Error(`Reddit API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`Reddit OAuth error: ${data.error} - ${data.error_description || 'Check your credentials'}`);
  }
  
  if (!data.access_token) {
    throw new Error("No access token received from Reddit - check your credentials");
  }
}

const redditOAuth: CredentialDefinition = {
  id: "reddit_oauth",
  label: "Reddit OAuth2 Credentials",
  description: "OAuth2 credentials for Reddit script app (posting and moderation)",
  helpUrl: "https://www.reddit.com/prefs/apps",
  fields: [
    { name: "client_id", label: "Client ID", description: "App ID from Reddit Preferences > Apps (script type)", secret: false },
    { name: "client_secret", label: "Client Secret", description: "Secret from your Reddit script app", secret: true },
    { name: "username", label: "Username", description: "Reddit username for the bot account", secret: false },
    { name: "password", label: "Password", description: "Password for the Reddit bot account", secret: true },
    { name: "user_agent", label: "User Agent", description: "Custom user agent string (e.g., 'script:mybot:v1.0 (by u/yourusername)')", secret: false },
  ],
  envVars: { 
    client_id: "REDDIT_CLIENT_ID",
    client_secret: "REDDIT_CLIENT_SECRET", 
    username: "REDDIT_USERNAME",
    password: "REDDIT_PASSWORD",
    user_agent: "REDDIT_USER_AGENT",
  },
  agentContext: "`REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`, `REDDIT_PASSWORD`, `REDDIT_USER_AGENT` — use for Reddit OAuth2 script app authentication. Get access token via POST to /api/v1/access_token with Basic auth and password grant",

  async validate(values) {
    await validateRedditOAuth(values.client_id, values.client_secret, values.username, values.password, values.user_agent);
    return true;
  },
};

export default redditOAuth;