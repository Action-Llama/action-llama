import type { CredentialDefinition } from "../schema.js";
import githubToken from "./github-token.js";
import anthropicKey from "./anthropic-key.js";
import openaiKey from "./openai-key.js";
import groqKey from "./groq-key.js";
import googleKey from "./google-key.js";
import xaiKey from "./xai-key.js";
import mistralKey from "./mistral-key.js";
import openrouterKey from "./openrouter-key.js";
import customKey from "./custom-key.js";
import sentryToken from "./sentry-token.js";
import linearToken from "./linear-token.js";
import linearOAuth from "./linear-oauth.js";
import gitSsh from "./id-rsa.js";
import githubWebhookSecret from "./github-webhook-secret.js";
import sentryClientSecret from "./sentry-client-secret.js";
import linearWebhookSecret from "./linear-webhook-secret.js";
import netlifyToken from "./netlify-token.js";
import xTwitterApi from "./x-twitter-api.js";
import bugsnagToken from "./bugsnag-token.js";
import vultrApiKey from "./vultr-api-key.js";
import hetznerApiKey from "./hetzner-api-key.js";
import vpsSsh from "./vps-ssh.js";
import cloudflareApiToken from "./cloudflare-api-token.js";
import redditOAuth from "./reddit-oauth.js";
import mintlifyToken from "./mintlify-token.js";
import mintlifyWebhookSecret from "./mintlify-webhook-secret.js";
import slackBotToken from "./slack-bot-token.js";
import slackSigningSecret from "./slack-signing-secret.js";

export const builtinCredentials: Record<string, CredentialDefinition> = {
  "github_token": githubToken,
  "anthropic_key": anthropicKey,
  "openai_key": openaiKey,
  "groq_key": groqKey,
  "google_key": googleKey,
  "xai_key": xaiKey,
  "mistral_key": mistralKey,
  "openrouter_key": openrouterKey,
  "custom_key": customKey,
  "sentry_token": sentryToken,
  "linear_token": linearToken,
  "linear_oauth": linearOAuth,
  "git_ssh": gitSsh,
  "github_webhook_secret": githubWebhookSecret,
  "sentry_client_secret": sentryClientSecret,
  "linear_webhook_secret": linearWebhookSecret,
  "netlify_token": netlifyToken,
  "x_twitter_api": xTwitterApi,
  "bugsnag_token": bugsnagToken,
  "vultr_api_key": vultrApiKey,
  "hetzner_api_key": hetznerApiKey,
  "vps_ssh": vpsSsh,
  "cloudflare_api_token": cloudflareApiToken,
  "reddit_oauth": redditOAuth,
  "mintlify_token": mintlifyToken,
  "mintlify_webhook_secret": mintlifyWebhookSecret,
  "slack_bot_token": slackBotToken,
  "slack_signing_secret": slackSigningSecret,
};
