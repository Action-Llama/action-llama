import type { WebhookProvider } from "../webhooks/types.js";
import type { TelemetryProvider } from "../telemetry/types.js";
import type { ContainerRuntime } from "../docker/runtime.js";

// Extension types
export type ExtensionType = "webhook" | "telemetry" | "runtime" | "model" | "credential";

// Credential requirement interface
export interface CredentialRequirement {
  type: string;              // e.g., "github_token", "otel_api_key"
  instance?: string;         // optional instance name
  description?: string;      // for documentation
  optional?: boolean;        // whether the credential is optional
}

// Custom credential type registration
export interface CredentialTypeDefinition {
  type: string;
  fields: string[];
  validation?: (values: Record<string, string>) => Promise<void>;
  envMapping?: Record<string, string>;
  description?: string;
}

// Base extension metadata
export interface ExtensionMetadata {
  name: string;
  version: string;
  description: string;
  type: ExtensionType;
  requiredCredentials?: CredentialRequirement[];
  providesCredentialTypes?: CredentialTypeDefinition[];  // Extensions can define new credential types
}

// Base extension interface
export interface Extension {
  metadata: ExtensionMetadata;
  init(config?: ExtensionConfig): Promise<void>;
  shutdown(): Promise<void>;
}

// Extension configuration
export interface ExtensionConfig {
  [key: string]: any;
}

// Type-specific extensions
export interface WebhookExtension extends Extension {
  metadata: ExtensionMetadata & { type: "webhook" };
  provider: WebhookProvider;
}

export interface TelemetryExtension extends Extension {
  metadata: ExtensionMetadata & { type: "telemetry" };
  provider: TelemetryProvider;
}

export interface RuntimeExtension extends Extension {
  metadata: ExtensionMetadata & { type: "runtime" };
  provider: ContainerRuntime;
}

// Import the actual ModelProvider interface
import type { ModelProvider } from "../models/types.js";
export type { ModelProvider } from "../models/types.js";

export interface ModelExtension extends Extension {
  metadata: ExtensionMetadata & { type: "model" };
  provider: ModelProvider;
}

// Credential provider interface placeholder
export interface CredentialProvider {
  name: string;
  
  // List available credentials of a given type
  list(type: string): Promise<string[]>;
  
  // Retrieve credential values
  get(type: string, instance?: string): Promise<Record<string, string> | null>;
  
  // Store new credentials
  store(type: string, instance: string, values: Record<string, string>): Promise<void>;
  
  // Delete credentials
  remove(type: string, instance: string): Promise<void>;
  
  // Health check
  isAvailable(): Promise<boolean>;
}

export interface CredentialExtension extends Extension {
  metadata: ExtensionMetadata & { type: "credential" };
  provider: CredentialProvider;
}