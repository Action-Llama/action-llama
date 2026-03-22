/**
 * Custom OpenAI-compatible endpoint provider implementation
 */

import type { ModelProvider, ChatMessage, ChatResponse, ChatOptions, ModelConfig } from "../types.js";

export class CustomProvider implements ModelProvider {
  name = "custom";
  private apiKey: string;
  private baseUrl: string;
  private config: ModelConfig;

  constructor(config: ModelConfig) {
    this.config = config;
    this.apiKey = config.apiKey || process.env.CUSTOM_API_KEY || "";
    
    if (!config.baseUrl) {
      throw new Error("Custom provider requires baseUrl in configuration");
    }
    this.baseUrl = config.baseUrl;
  }

  async init(): Promise<void> {
    // API key is optional for some custom endpoints
    if (!this.baseUrl) {
      throw new Error("Custom provider requires baseUrl configuration");
    }
  }

  async validateConfig(config: ModelConfig): Promise<void> {
    if (!config.baseUrl) {
      throw new Error("Custom provider requires baseUrl in configuration");
    }
    
    // Validate that baseUrl is a valid URL
    try {
      new URL(config.baseUrl);
    } catch {
      throw new Error("Invalid baseUrl provided for custom provider");
    }
  }

  getDefaultModel(): string {
    return this.config.model || "gpt-3.5-turbo";
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    // Add authorization header if API key is provided
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const body = {
      model: options?.model || this.getDefaultModel(),
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      temperature: options?.temperature ?? this.config.temperature ?? 0.7,
      max_tokens: options?.max_tokens ?? this.config.maxTokens,
      top_p: options?.top_p,
      stop: options?.stop,
      stream: false
    };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Custom API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json();
    
    return {
      content: data.choices[0]?.message?.content || "",
      usage: data.usage ? {
        prompt_tokens: data.usage.prompt_tokens,
        completion_tokens: data.usage.completion_tokens,
        total_tokens: data.usage.total_tokens
      } : undefined,
      model: data.model,
      finish_reason: data.choices[0]?.finish_reason
    };
  }

  async listModels(): Promise<string[]> {
    try {
      const url = `${this.baseUrl.replace(/\/$/, "")}/models`;
      const headers: Record<string, string> = {};

      if (this.apiKey) {
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(url, { headers });
      if (!response.ok) {
        // If models endpoint doesn't exist, return a default
        return [this.getDefaultModel()];
      }

      const data = await response.json();
      return data.data?.map((model: any) => model.id) || [this.getDefaultModel()];
    } catch {
      // Fallback to default model if listing fails
      return [this.getDefaultModel()];
    }
  }

  async shutdown(): Promise<void> {
    // No cleanup needed for HTTP-based provider
  }
}