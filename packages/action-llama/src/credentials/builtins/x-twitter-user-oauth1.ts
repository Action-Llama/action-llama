import type { CredentialDefinition } from "../schema.js";

const xTwitterUserOauth1: CredentialDefinition = {
  id: "x_twitter_user_oauth1",
  label: "X (Twitter) User OAuth 1.0a Tokens",
  description: "OAuth 1.0a user-context tokens for a bot account (required for Account Activity API subscriptions)",
  helpUrl: "https://developer.x.com/en/portal/dashboard",
  fields: [
    { name: "access_token", label: "Access Token", description: "OAuth 1.0a Access Token from the bot user's 'Keys and tokens' tab", secret: true },
    { name: "access_token_secret", label: "Access Token Secret", description: "OAuth 1.0a Access Token Secret from the bot user's 'Keys and tokens' tab", secret: true },
  ],
  envVars: {
    access_token: "X_ACCESS_TOKEN",
    access_token_secret: "X_ACCESS_TOKEN_SECRET",
  },
  agentContext: "`X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` — OAuth 1.0a user-context auth for X API (Account Activity API)",
};

export default xTwitterUserOauth1;
