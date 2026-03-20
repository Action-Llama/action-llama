import type { CredentialDefinition } from "../schema.js";
import { validateXTwitterToken } from "../../setup/validators.js";

const xTwitterApi: CredentialDefinition = {
  id: "x_twitter_api",
  label: "X (Twitter) API Credentials",
  description: "API credentials for X (formerly Twitter) platform",
  helpUrl: "https://developer.x.com/en/portal/dashboard",
  fields: [
    { name: "api_key", label: "API Key", description: "Consumer Key from X Developer Portal", secret: true },
    { name: "api_secret", label: "API Secret", description: "Consumer Secret from X Developer Portal", secret: true },
    { name: "bearer_token", label: "Bearer Token", description: "Bearer Token for app-only authentication", secret: true },
    { name: "access_token", label: "Access Token", description: "User Access Token (optional, for user authentication)", secret: true },
    { name: "access_token_secret", label: "Access Token Secret", description: "User Access Token Secret (optional, for user authentication)", secret: true },
  ],
  envVars: { 
    api_key: "X_API_KEY",
    api_secret: "X_API_SECRET", 
    bearer_token: "X_BEARER_TOKEN",
    access_token: "X_ACCESS_TOKEN",
    access_token_secret: "X_ACCESS_TOKEN_SECRET"
  },
  agentContext: "`X_API_KEY`, `X_API_SECRET`, `X_BEARER_TOKEN`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` — use X API v2 directly",

  async validate(values) {
    await validateXTwitterToken(values.bearer_token);
    return true;
  },
};

export default xTwitterApi;