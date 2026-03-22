// Core extension types and interfaces
export type {
  Extension,
  ExtensionType,
  ExtensionMetadata,
  ExtensionConfig,
  WebhookExtension,
  TelemetryExtension,
  RuntimeExtension,
  ModelExtension,
  CredentialExtension,
  CredentialRequirement,
  CredentialTypeDefinition,
  ModelProvider,
  CredentialProvider
} from "./types.js";

// Extension registry
export { ExtensionRegistry, globalRegistry } from "./registry.js";

// Extension loader
export { loadBuiltinExtensions, getGlobalRegistry, isExtension } from "./loader.js";