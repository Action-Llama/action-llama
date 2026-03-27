import type { CredentialDefinition } from "../schema.js";
import { validateXTwitterToken } from "../../setup/validators.js";

const xTwitterApi: CredentialDefinition = {
  id: "x_twitter_api",
  label: "X (Twitter) API Credentials",
  description: "App-level API credentials for X (formerly Twitter) platform",
  helpUrl: "https://developer.x.com/en/portal/dashboard",
  fields: [
    { name: "consumer_key", label: "Consumer Key", description: "OAuth 1.0a Consumer Key from X Developer Portal", secret: true },
    { name: "consumer_secret", label: "Consumer Secret", description: "OAuth 1.0a Consumer Secret from X Developer Portal", secret: true },
    { name: "bearer_token", label: "Bearer Token", description: "App-Only authentication token from X Developer Portal", secret: true },
  ],
  envVars: {
    consumer_key: "X_CONSUMER_KEY",
    consumer_secret: "X_CONSUMER_SECRET",
    bearer_token: "X_BEARER_TOKEN",
  },
  agentContext: "`X_CONSUMER_KEY`, `X_CONSUMER_SECRET`, `X_BEARER_TOKEN` — use X API v2 directly",

  async validate(values) {
    await validateXTwitterToken(values.bearer_token);
    return true;
  },
};

export default xTwitterApi;
