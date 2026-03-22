/**
 * OpenAI model provider implementation
 */

import type { ModelProvider, ChatMessage, ChatResponse, ChatOptions, ModelConfig } from "../types.js";

export class OpenAIProvider implements ModelProvider {
  name = "openai";
  private apiKey: string;
  private baseUrl: string;
  private config: ModelConfig;

  constructor(config: ModelConfig) {
    this.config = config;
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || "";
    this.baseUrl = config.baseUrl || "https://api.openai.com/v1";
  }

  async init(): Promise<void> {
    if (!this.apiKey) {
      throw new Error("OpenAI API key is required");
    }
  }

  async validateConfig(config: ModelConfig): Promise<void> {
    if (!config.apiKey && !process.env.OPENAI_API_KEY) {
      throw new Error("OpenAI API key is required in config or OPENAI_API_KEY environment variable");
    }
  }

  getDefaultModel(): string {
    return this.config.model || "gpt-4";
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const url = `${this.baseUrl}/chat/completions`;
    const headers = {
      "Authorization": `Bearer ${this.apiKey}`,
      "Content-Type": "application/json"
    };

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
      stream: false // We'll handle streaming separately if needed
    };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errorBody}`);
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
    const url = `${this.baseUrl}/models`;
    const headers = {
      "Authorization": `Bearer ${this.apiKey}`
    };

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.statusText}`);
    }

    const data = await response.json();
    return data.data
      .filter((model: any) => model.id.includes("gpt"))
      .map((model: any) => model.id);
  }

  async shutdown(): Promise<void> {
    // No cleanup needed for HTTP-based provider
  }
}