/**
 * Webhook provider extensions
 */

import type { WebhookExtension } from "../../extensions/types.js";
import { GitHubWebhookProvider } from "./github.js";
import { LinearWebhookProvider } from "./linear.js";
import { MintlifyWebhookProvider } from "./mintlify.js";
import { SentryWebhookProvider } from "./sentry.js";
import { TestWebhookProvider } from "./test.js";

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