/**
 * Anthropic model provider implementation
 */

import type { ModelProvider, ChatMessage, ChatResponse, ChatOptions, ModelConfig } from "../types.js";

export class AnthropicProvider implements ModelProvider {
  name = "anthropic";
  private apiKey: string;
  private baseUrl: string;
  private config: ModelConfig;

  constructor(config: ModelConfig) {
    this.config = config;
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || "";
    this.baseUrl = config.baseUrl || "https://api.anthropic.com/v1";
  }

  async init(): Promise<void> {
    if (!this.apiKey) {
      throw new Error("Anthropic API key is required");
    }
  }

  async validateConfig(config: ModelConfig): Promise<void> {
    if (!config.apiKey && !process.env.ANTHROPIC_API_KEY) {
      throw new Error("Anthropic API key is required in config or ANTHROPIC_API_KEY environment variable");
    }
  }

  getDefaultModel(): string {
    return this.config.model || "claude-sonnet-4-20250514";
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const url = `${this.baseUrl}/messages`;
    const headers = {
      "x-api-key": this.apiKey,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01"
    };

    // Anthropic's API requires separating system messages
    const systemMessages = messages.filter(msg => msg.role === "system");
    const conversationMessages = messages.filter(msg => msg.role !== "system");

    const body = {
      model: options?.model || this.getDefaultModel(),
      max_tokens: options?.max_tokens ?? this.config.maxTokens ?? 1000,
      temperature: options?.temperature ?? this.config.temperature ?? 0.7,
      top_p: options?.top_p,
      stop_sequences: options?.stop,
      system: systemMessages.map(msg => msg.content).join("\n\n"),
      messages: conversationMessages.map(msg => ({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: msg.content
      }))
    };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json();
    
    return {
      content: data.content[0]?.text || "",
      usage: data.usage ? {
        prompt_tokens: data.usage.input_tokens,
        completion_tokens: data.usage.output_tokens,
        total_tokens: data.usage.input_tokens + data.usage.output_tokens
      } : undefined,
      model: data.model,
      finish_reason: data.stop_reason
    };
  }

  async shutdown(): Promise<void> {
    // No cleanup needed for HTTP-based provider
  }
}