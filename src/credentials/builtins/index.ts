import type { CredentialDefinition } from "../schema.js";
import githubToken from "./github-token.js";
import anthropicKey from "./anthropic-key.js";
import sentryToken from "./sentry-token.js";
import gitSsh from "./id-rsa.js";
import githubWebhookSecret from "./github-webhook-secret.js";
import sentryClientSecret from "./sentry-client-secret.js";
import netlifyToken from "./netlify-token.js";

export const builtinCredentials: Record<string, CredentialDefinition> = {
  "github_token": githubToken,
  "anthropic_key": anthropicKey,
  "sentry_token": sentryToken,
  "git_ssh": gitSsh,
  "github_webhook_secret": githubWebhookSecret,
  "sentry_client_secret": sentryClientSecret,
  "netlify_token": netlifyToken,
};
