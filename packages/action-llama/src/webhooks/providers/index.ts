/**
 * Webhook provider extensions
 */

import type { WebhookExtension } from "../../extensions/types.js";
import { GitHubWebhookProvider } from "./github.js";
import { LinearWebhookProvider } from "./linear.js";
import { MintlifyWebhookProvider } from "./mintlify.js";
import { SentryWebhookProvider } from "./sentry.js";
import { DiscordWebhookProvider } from "./discord.js";
import { SlackWebhookProvider } from "./slack.js";
import { TestWebhookProvider } from "./test.js";
import { TwitterWebhookProvider } from "./twitter.js";

/**
 * GitHub webhook provider extension
 */
export const githubWebhookExtension: WebhookExtension = {
  metadata: {
    name: "github",
    version: "1.0.0",
    description: "GitHub webhook provider",
    type: "webhook",
    requiredCredentials: [
      { type: "github_webhook_secret", description: "GitHub webhook secret for HMAC validation", optional: true }
    ],
    providesCredentialTypes: [
      {
        type: "github_webhook_secret",
        fields: ["secret"],
        description: "GitHub webhook secret",
        envMapping: { secret: "GITHUB_WEBHOOK_SECRET" }
      }
    ]
  },
  provider: new GitHubWebhookProvider(),
  async init() {
    // No special initialization required
  },
  async shutdown() {
    // No cleanup required
  }
};

/**
 * Linear webhook provider extension
 */
export const linearWebhookExtension: WebhookExtension = {
  metadata: {
    name: "linear",
    version: "1.0.0",
    description: "Linear webhook provider",
    type: "webhook",
    requiredCredentials: [
      { type: "linear_webhook_secret", description: "Linear webhook secret for HMAC validation", optional: true }
    ],
    providesCredentialTypes: [
      {
        type: "linear_webhook_secret",
        fields: ["secret"],
        description: "Linear webhook secret",
        envMapping: { secret: "LINEAR_WEBHOOK_SECRET" }
      }
    ]
  },
  provider: new LinearWebhookProvider(),
  async init() {
    // No special initialization required
  },
  async shutdown() {
    // No cleanup required
  }
};

/**
 * Mintlify webhook provider extension
 */
export const mintlifyWebhookExtension: WebhookExtension = {
  metadata: {
    name: "mintlify",
    version: "1.0.0",
    description: "Mintlify webhook provider",
    type: "webhook",
    requiredCredentials: [
      { type: "mintlify_webhook_secret", description: "Mintlify webhook secret for HMAC validation", optional: true }
    ],
    providesCredentialTypes: [
      {
        type: "mintlify_webhook_secret",
        fields: ["secret"],
        description: "Mintlify webhook secret",
        envMapping: { secret: "MINTLIFY_WEBHOOK_SECRET" }
      }
    ]
  },
  provider: new MintlifyWebhookProvider(),
  async init() {
    // No special initialization required
  },
  async shutdown() {
    // No cleanup required
  }
};

/**
 * Sentry webhook provider extension
 */
export const sentryWebhookExtension: WebhookExtension = {
  metadata: {
    name: "sentry",
    version: "1.0.0",
    description: "Sentry webhook provider",
    type: "webhook",
    requiredCredentials: [
      { type: "sentry_client_secret", description: "Sentry client secret for HMAC validation", optional: true }
    ],
    providesCredentialTypes: [
      {
        type: "sentry_client_secret",
        fields: ["secret"],
        description: "Sentry client secret",
        envMapping: { secret: "SENTRY_CLIENT_SECRET" }
      }
    ]
  },
  provider: new SentryWebhookProvider(),
  async init() {
    // No special initialization required
  },
  async shutdown() {
    // No cleanup required
  }
};

/**
 * Slack webhook provider extension
 */
export const slackWebhookExtension: WebhookExtension = {
  metadata: {
    name: "slack",
    version: "1.0.0",
    description: "Slack Events API webhook provider",
    type: "webhook",
    requiredCredentials: [
      { type: "slack_signing_secret", description: "Slack signing secret for request verification", optional: true }
    ],
    providesCredentialTypes: [
      {
        type: "slack_signing_secret",
        fields: ["secret"],
        description: "Slack signing secret",
        envMapping: { secret: "SLACK_SIGNING_SECRET" }
      }
    ]
  },
  provider: new SlackWebhookProvider(),
  async init() {
    // No special initialization required
  },
  async shutdown() {
    // No cleanup required
  }
};

/**
 * Test webhook provider extension
 */
export const testWebhookExtension: WebhookExtension = {
  metadata: {
    name: "test",
    version: "1.0.0",
    description: "Test webhook provider for development",
    type: "webhook",
    requiredCredentials: [] // Test provider doesn't require credentials
  },
  provider: new TestWebhookProvider(),
  async init() {
    // No special initialization required
  },
  async shutdown() {
    // No cleanup required
  }
};
/**
 * Discord webhook provider extension
 */
export const discordWebhookExtension: WebhookExtension = {
  metadata: {
    name: "discord",
    version: "1.0.0",
    description: "Discord webhook provider (Interactions Endpoint)",
    type: "webhook",
    requiredCredentials: [
      { type: "discord_bot", description: "Discord bot credentials for Ed25519 signature validation", optional: true }
    ],
    providesCredentialTypes: [
      {
        type: "discord_bot",
        fields: ["application_id", "public_key", "bot_token"],
        description: "Discord bot credentials",
        envMapping: {
          application_id: "DISCORD_APPLICATION_ID",
          public_key: "DISCORD_PUBLIC_KEY",
          bot_token: "DISCORD_BOT_TOKEN",
        }
      }
    ]
  },
  provider: new DiscordWebhookProvider(),
  async init() {
    // No special initialization required
  },
  async shutdown() {
    // No cleanup required
  }
};

/**
 * Twitter webhook provider extension
 */
export const twitterWebhookExtension: WebhookExtension = {
  metadata: {
    name: "twitter",
    version: "1.0.0",
    description: "X (Twitter) webhook provider with CRC support",
    type: "webhook",
    requiredCredentials: [
      { type: "x_twitter_api", description: "X API credentials (consumer secret used for CRC handshake and HMAC validation)", optional: true }
    ],
    providesCredentialTypes: [
      {
        type: "x_twitter_api",
        fields: ["consumer_key", "consumer_secret", "bearer_token"],
        description: "X (Twitter) app-level API credentials",
        envMapping: {
          consumer_key: "X_CONSUMER_KEY",
          consumer_secret: "X_CONSUMER_SECRET",
          bearer_token: "X_BEARER_TOKEN",
        }
      },
      {
        type: "x_twitter_user_oauth1",
        fields: ["access_token", "access_token_secret"],
        description: "X (Twitter) OAuth 1.0a user-context access tokens",
        envMapping: {
          access_token: "X_ACCESS_TOKEN",
          access_token_secret: "X_ACCESS_TOKEN_SECRET",
        }
      },
      {
        type: "x_twitter_user_oauth2",
        fields: ["client_id", "client_secret", "access_token", "refresh_token"],
        description: "X (Twitter) OAuth 2.0 user-context credentials (PKCE flow, used for Account Activity subscriptions)",
        envMapping: {
          client_id: "X_OAUTH2_CLIENT_ID",
          client_secret: "X_OAUTH2_CLIENT_SECRET",
          access_token: "X_OAUTH2_ACCESS_TOKEN",
          refresh_token: "X_OAUTH2_REFRESH_TOKEN",
        }
      }
    ]
  },
  provider: new TwitterWebhookProvider(),
  async init() {
    // No special initialization required
  },
  async shutdown() {
    // No cleanup required
  }
};
