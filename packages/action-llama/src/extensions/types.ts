import type { WebhookProvider } from "../webhooks/types.js";

// Extension types
export type ExtensionType = "webhook" | "credential";

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
