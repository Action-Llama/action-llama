import type { CredentialDefinition } from "../schema.js";
import githubToken from "./github-token.js";
import anthropicKey from "./anthropic-key.js";
import openaiKey from "./openai-key.js";
import sentryToken from "./sentry-token.js";
import gitSsh from "./id-rsa.js";
import githubWebhookSecret from "./github-webhook-secret.js";
import sentryClientSecret from "./sentry-client-secret.js";

export const builtinCredentials: Record<string, CredentialDefinition> = {
  "github_token": githubToken,
  "anthropic_key": anthropicKey,
  "openai_key": openaiKey,
  "sentry_token": sentryToken,
  "git_ssh": gitSsh,
  "github_webhook_secret": githubWebhookSecret,
  "sentry_client_secret": sentryClientSecret,
};
