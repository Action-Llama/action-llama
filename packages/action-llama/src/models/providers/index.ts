/**
 * Model provider extensions
 */

import type { ModelExtension } from "../../extensions/types.js";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { CustomProvider } from "./custom.js";

/**
 * OpenAI model provider extension
 */
export const openAIModelExtension: ModelExtension = {
  metadata: {
    name: "openai",
    version: "1.0.0",
    description: "OpenAI model provider",
    type: "model",
    requiredCredentials: [
      { type: "openai_api_key", description: "OpenAI API key" }
    ],
    providesCredentialTypes: [
      {
        type: "openai_api_key",
        fields: ["api_key"],
        description: "OpenAI API key for GPT models",
        envMapping: { api_key: "OPENAI_API_KEY" }
      }
    ]
  },
  provider: new OpenAIProvider({ provider: "openai" }),
  async init() {
    await this.provider.init();
  },
  async shutdown() {
    await this.provider.shutdown();
  }
};

/**
 * Anthropic model provider extension
 */
export const anthropicModelExtension: ModelExtension = {
  metadata: {
    name: "anthropic",
    version: "1.0.0",
    description: "Anthropic model provider",
    type: "model",
    requiredCredentials: [
      { type: "anthropic_api_key", description: "Anthropic API key" }
    ],
    providesCredentialTypes: [
      {
        type: "anthropic_api_key",
        fields: ["api_key"],
        description: "Anthropic API key for Claude models",
        envMapping: { api_key: "ANTHROPIC_API_KEY" }
      }
    ]
  },
  provider: new AnthropicProvider({ provider: "anthropic" }),
  async init() {
    await this.provider.init();
  },
  async shutdown() {
    await this.provider.shutdown();
  }
};

/**
 * Custom OpenAI-compatible endpoint provider extension
 */
export const customModelExtension: ModelExtension = {
  metadata: {
    name: "custom",
    version: "1.0.0",
    description: "Custom OpenAI-compatible endpoint provider",
    type: "model",
    requiredCredentials: [
      { type: "custom_api_key", description: "API key for custom endpoint", optional: true },
      { type: "custom_base_url", description: "Base URL for custom endpoint" }
    ],
    providesCredentialTypes: [
      {
        type: "custom_api_key",
        fields: ["api_key"],
        description: "API key for custom OpenAI-compatible endpoint",
        envMapping: { api_key: "CUSTOM_API_KEY" }
      },
      {
        type: "custom_base_url",
        fields: ["base_url"],
        description: "Base URL for custom OpenAI-compatible endpoint",
        validation: async (values) => {
          // Validate URL format
          new URL(values.base_url);
        }
      }
    ]
  },
  provider: new CustomProvider({ 
    provider: "custom",
    baseUrl: process.env.CUSTOM_BASE_URL || "http://localhost:8080/v1"
  }),
  async init() {
    await this.provider.init();
  },
  async shutdown() {
    await this.provider.shutdown();
  }
};