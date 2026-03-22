/**
 * Model provider interfaces and types
 */

// Common types for chat messages and responses
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatResponse {
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model?: string;
  finish_reason?: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string[];
  stream?: boolean;
}

// Model configuration interface
export interface ModelConfig {
  provider: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  [key: string]: any; // Allow provider-specific config
}

// Model provider interface
export interface ModelProvider {
  /** Provider name */
  name: string;
  
  /** Initialize the provider */
  init(): Promise<void>;
  
  /** Send a chat completion request */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  
  /** Validate provider configuration */
  validateConfig(config: ModelConfig): Promise<void>;
  
  /** List available models */
  listModels?(): Promise<string[]>;
  
  /** Get default model name */
  getDefaultModel(): string;
  
  /** Shutdown the provider */
  shutdown(): Promise<void>;
}