import type { CredentialDefinition } from "../schema.js";
import githubToken from "./github-token.js";
import anthropicKey from "./anthropic-key.js";
import sentryToken from "./sentry-token.js";
import idRsa from "./id-rsa.js";
import githubWebhookSecret from "./github-webhook-secret.js";
import sentryClientSecret from "./sentry-client-secret.js";

export const builtinCredentials: Record<string, CredentialDefinition> = {
  "github-token": githubToken,
  "anthropic-key": anthropicKey,
  "sentry-token": sentryToken,
  "id_rsa": idRsa,
  "github-webhook-secret": githubWebhookSecret,
  "sentry-client-secret": sentryClientSecret,
};
