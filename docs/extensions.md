# Extension API

Action Llama provides a stable extension API that allows you to create custom providers for webhooks, telemetry, runtimes, models, and credentials. This document explains how to use and create extensions.

## Overview

The extension system provides a consistent way to register, discover, and manage different types of providers in Action Llama. Instead of hardcoded switch statements or provider-specific conditionals in the core, all providers are registered through a central extension registry.

### Extension Types

- **Webhook Extensions**: Handle incoming webhook events from different platforms (GitHub, Linear, Sentry, etc.)
- **Telemetry Extensions**: Send observability data to different backends (OpenTelemetry, etc.)
- **Runtime Extensions**: Execute agents in different environments (Local Docker, SSH Docker, etc.)
- **Model Extensions**: Provide LLM integration for different providers (OpenAI, Anthropic, custom endpoints)
- **Credential Extensions**: Store and retrieve secrets from different backends (files, Vault, AWS Secrets Manager, etc.)

## Architecture

```
┌─────────────────┐
│  Extension API  │
├─────────────────┤
│  Core Registry  │
├─────────────────┤
│   Extensions    │
│                 │
│ ┌─────┬─────┐   │
│ │ Web │ Tel │   │
│ │ hook│ eme │   │
│ │     │ try │   │
│ └─────┴─────┘   │
│ ┌─────┬─────┐   │
│ │ Run │ Mod │   │
│ │ time│ el  │   │
│ │     │     │   │
│ └─────┴─────┘   │
│ ┌─────────────┐ │
│ │ Credential  │ │
│ │             │ │
│ └─────────────┘ │
└─────────────────┘
```

Extensions are loaded at startup and registered in a global registry. The core system queries the registry to get the appropriate provider for a given configuration.

## Creating Extensions

### Base Extension Interface

All extensions implement the base `Extension` interface:

```typescript
interface Extension {
  metadata: ExtensionMetadata;
  init(config?: ExtensionConfig): Promise<void>;
  shutdown(): Promise<void>;
}
```

### Extension Metadata

Each extension declares metadata including its name, version, type, and credential requirements:

```typescript
interface ExtensionMetadata {
  name: string;
  version: string;
  description: string;
  type: ExtensionType;
  requiredCredentials?: CredentialRequirement[];
  providesCredentialTypes?: CredentialTypeDefinition[];
}
```

### Credential Requirements

Extensions can declare what credentials they need:

```typescript
{
  requiredCredentials: [
    { 
      type: "github_token", 
      description: "GitHub API token",
      optional: false 
    },
    { 
      type: "webhook_secret", 
      description: "Webhook signature secret",
      optional: true 
    }
  ]
}
```

### Custom Credential Types

Extensions can define new credential types:

```typescript
{
  providesCredentialTypes: [
    {
      type: "my_service_api_key",
      fields: ["api_key", "endpoint"],
      description: "API key for My Service",
      validation: async (values) => {
        // Validate the credentials
        if (!values.api_key) {
          throw new Error("API key is required");
        }
      },
      envMapping: {
        api_key: "MY_SERVICE_API_KEY",
        endpoint: "MY_SERVICE_ENDPOINT"
      }
    }
  ]
}
```

## Extension Types

### Webhook Extensions

Webhook extensions handle incoming webhook events from different platforms.

```typescript
interface WebhookExtension extends Extension {
  metadata: ExtensionMetadata & { type: "webhook" };
  provider: WebhookProvider;
}
```

**Example:**
```typescript
export const myWebhookExtension: WebhookExtension = {
  metadata: {
    name: "myservice",
    version: "1.0.0",
    description: "My Service webhook provider",
    type: "webhook",
    requiredCredentials: [
      { type: "myservice_webhook_secret", optional: true }
    ]
  },
  provider: new MyServiceWebhookProvider(),
  async init() {
    // Initialize the provider
  },
  async shutdown() {
    // Clean up resources
  }
};
```

### Telemetry Extensions

Telemetry extensions send observability data to different backends.

```typescript
interface TelemetryExtension extends Extension {
  metadata: ExtensionMetadata & { type: "telemetry" };
  provider: TelemetryProvider;
}
```

**Example:**
```typescript
export const myTelemetryExtension: TelemetryExtension = {
  metadata: {
    name: "datadog",
    version: "1.0.0",
    description: "Datadog telemetry provider",
    type: "telemetry",
    requiredCredentials: [
      { type: "datadog_api_key" }
    ]
  },
  provider: new DatadogProvider(),
  async init() {
    await this.provider.init();
  },
  async shutdown() {
    await this.provider.shutdown();
  }
};
```

### Runtime Extensions

Runtime extensions execute agents in different environments.

```typescript
interface RuntimeExtension extends Extension {
  metadata: ExtensionMetadata & { type: "runtime" };
  provider: ContainerRuntime;
}
```

**Example:**
```typescript
export const kubernetesRuntimeExtension: RuntimeExtension = {
  metadata: {
    name: "kubernetes",
    version: "1.0.0",
    description: "Kubernetes container runtime",
    type: "runtime",
    requiredCredentials: [
      { type: "kubeconfig" }
    ]
  },
  provider: new KubernetesRuntime(),
  async init() {
    await this.provider.init();
  },
  async shutdown() {
    await this.provider.shutdown();
  }
};
```

### Model Extensions

Model extensions provide LLM integration for different providers.

```typescript
interface ModelExtension extends Extension {
  metadata: ExtensionMetadata & { type: "model" };
  provider: ModelProvider;
}
```

**Example:**
```typescript
export const localModelExtension: ModelExtension = {
  metadata: {
    name: "ollama",
    version: "1.0.0",
    description: "Ollama local model provider",
    type: "model",
    requiredCredentials: []
  },
  provider: new OllamaProvider({ baseUrl: "http://localhost:11434" }),
  async init() {
    await this.provider.init();
  },
  async shutdown() {
    await this.provider.shutdown();
  }
};
```

### Credential Extensions

Credential extensions store and retrieve secrets from different backends.

```typescript
interface CredentialExtension extends Extension {
  metadata: ExtensionMetadata & { type: "credential" };
  provider: CredentialProvider;
}
```

**Example:**
```typescript
export const awsSecretsExtension: CredentialExtension = {
  metadata: {
    name: "aws-secrets",
    version: "1.0.0",
    description: "AWS Secrets Manager provider",
    type: "credential",
    requiredCredentials: [
      { type: "aws_access_key_id" },
      { type: "aws_secret_access_key" },
      { type: "aws_region" }
    ]
  },
  provider: new AWSSecretsProvider(),
  async init() {
    await this.provider.init();
  },
  async shutdown() {
    await this.provider.shutdown();
  }
};
```

## Using Extensions

### Loading Extensions

Extensions are automatically loaded at startup by calling `loadBuiltinExtensions()`. This should be done early in your application initialization:

```typescript
import { loadBuiltinExtensions } from "./extensions/loader.js";

// Create credential checker
const credentialChecker = async (type: string, instance?: string) => {
  // Check if credential exists in your credential system
  return credentialExists(type, instance);
};

// Load all built-in extensions
await loadBuiltinExtensions(credentialChecker);
```

### Getting Extensions

Use the global registry to get extensions by type and name:

```typescript
import { globalRegistry } from "./extensions/registry.js";

// Get a specific webhook extension
const githubExtension = globalRegistry.getWebhookExtension("github");

// Get all telemetry extensions
const telemetryExtensions = globalRegistry.getAllTelemetryExtensions();

// Get a runtime extension
const dockerRuntime = globalRegistry.getRuntimeExtension("local");
```

### Configuration

Extensions read their configuration from various sources:

1. **Environment variables** - Using the `envMapping` in credential type definitions
2. **Configuration files** - Passed to the `init()` method
3. **Credential stores** - Using the credential requirements

## CLI Integration

The `al doctor` command will show all registered extensions and their status:

```bash
al doctor
```

Output:
```
Extensions:
✓ webhook/github v1.0.0 - GitHub webhook provider
✓ webhook/linear v1.0.0 - Linear webhook provider  
✓ telemetry/otel v1.0.0 - OpenTelemetry provider
✓ runtime/local v1.0.0 - Local Docker runtime
✓ runtime/ssh v1.0.0 - SSH Docker runtime
✓ model/openai v1.0.0 - OpenAI model provider
✓ model/anthropic v1.0.0 - Anthropic model provider
✗ credential/vault v1.0.0 - HashiCorp Vault provider (missing vault_token)
```

## Built-in Extensions

### Webhook Extensions
- `github` - GitHub webhook events
- `linear` - Linear webhook events
- `sentry` - Sentry webhook events
- `mintlify` - Mintlify webhook events
- `test` - Test webhook provider for development

### Telemetry Extensions
- `otel` - OpenTelemetry with OTLP export

### Runtime Extensions
- `local` - Local Docker runtime
- `ssh` - SSH Docker runtime for remote deployments

### Model Extensions
- `openai` - OpenAI GPT models
- `anthropic` - Anthropic Claude models
- `custom` - Custom OpenAI-compatible endpoints

### Credential Extensions
- `file` - File-based credential storage (default)
- `vault` - HashiCorp Vault integration

## Migration Guide

### From Switch Statements

**Before:**
```typescript
switch (config.provider) {
  case "otel":
    const { OTelProvider } = await import("./providers/otel.js");
    provider = new OTelProvider(config);
    break;
  default:
    throw new Error(`Unknown provider: ${config.provider}`);
}
```

**After:**
```typescript
const extension = globalRegistry.getTelemetryExtension(config.provider);
if (!extension) {
  throw new Error(`Unknown provider: ${config.provider}`);
}
provider = extension.provider;
```

### From Hardcoded Providers

**Before:**
```typescript
const runtime = new LocalDockerRuntime();
```

**After:**
```typescript
const runtimeExtension = globalRegistry.getRuntimeExtension("local");
const runtime = runtimeExtension.provider;
```

## Future Enhancements

### Dynamic Extension Loading

Future versions will support loading extensions from:
- npm packages
- Local directories
- Remote URLs

```typescript
// Future API
await registry.loadExtension("@my-company/my-webhook-extension");
await registry.loadFromPath("./custom-extensions/");
```

### Extension Marketplace

A marketplace for sharing and discovering community-created extensions.

### Hot Reloading

Support for reloading extensions without restarting the application.

## Best Practices

1. **Error Handling**: Extensions should gracefully handle errors and not crash the application
2. **Credential Security**: Never log or expose credentials in extension code
3. **Resource Cleanup**: Always implement proper shutdown logic to clean up resources
4. **Validation**: Validate configuration and credentials during initialization
5. **Documentation**: Provide clear documentation for your extension's configuration and requirements
6. **Testing**: Write tests for your extension's functionality
7. **Versioning**: Follow semantic versioning for your extensions

## Troubleshooting

### Extension Not Found
Check that the extension is properly registered and that all required credentials are available.

### Credential Validation Errors
Ensure all required credentials are present and valid. Use `al doctor` to check credential status.

### Initialization Failures
Check the extension's logs for specific error messages. Common issues include:
- Missing credentials
- Invalid configuration
- Network connectivity problems
- Service dependencies not available