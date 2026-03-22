import type { 
  Extension, 
  ExtensionType, 
  CredentialTypeDefinition,
  WebhookExtension,
  TelemetryExtension,
  RuntimeExtension,
  ModelExtension,
  CredentialExtension
} from "./types.js";

export class ExtensionRegistry {
  private extensions = new Map<string, Map<string, Extension>>();
  private credentialTypes = new Map<string, CredentialTypeDefinition>();
  private credentialChecker?: (type: string, instance?: string) => Promise<boolean>;

  constructor(credentialChecker?: (type: string, instance?: string) => Promise<boolean>) {
    this.credentialChecker = credentialChecker;
    // Initialize maps for each extension type
    for (const type of ["webhook", "telemetry", "runtime", "model", "credential"] as ExtensionType[]) {
      this.extensions.set(type, new Map());
    }
  }

  async register(extension: Extension): Promise<void> {
    const { type, name } = extension.metadata;

    // Validate required credentials if checker provided
    if (this.credentialChecker && extension.metadata.requiredCredentials) {
      for (const cred of extension.metadata.requiredCredentials) {
        if (!cred.optional && !(await this.credentialChecker(cred.type, cred.instance))) {
          throw new Error(
            `Missing required credential: ${cred.type}${cred.instance ? `:${cred.instance}` : ""}`
          );
        }
      }
    }

    // Register any credential types this extension provides
    if (extension.metadata.providesCredentialTypes) {
      for (const credType of extension.metadata.providesCredentialTypes) {
        this.credentialTypes.set(credType.type, credType);
      }
    }

    // Check for duplicate registrations
    const typeMap = this.extensions.get(type);
    if (!typeMap) {
      throw new Error(`Invalid extension type: ${type}`);
    }
    
    if (typeMap.has(name)) {
      throw new Error(`Extension ${type}/${name} already registered`);
    }

    // Register the extension
    typeMap.set(name, extension);

    // Initialize the extension
    await extension.init();
  }

  get<T extends Extension>(type: ExtensionType, name: string): T | undefined {
    return this.extensions.get(type)?.get(name) as T | undefined;
  }

  getAll<T extends Extension>(type: ExtensionType): T[] {
    return Array.from(this.extensions.get(type)?.values() || []) as T[];
  }

  getWebhookExtension(name: string): WebhookExtension | undefined {
    return this.get<WebhookExtension>("webhook", name);
  }

  getTelemetryExtension(name: string): TelemetryExtension | undefined {
    return this.get<TelemetryExtension>("telemetry", name);
  }

  getRuntimeExtension(name: string): RuntimeExtension | undefined {
    return this.get<RuntimeExtension>("runtime", name);
  }

  getModelExtension(name: string): ModelExtension | undefined {
    return this.get<ModelExtension>("model", name);
  }

  getCredentialExtension(name: string): CredentialExtension | undefined {
    return this.get<CredentialExtension>("credential", name);
  }

  getAllWebhookExtensions(): WebhookExtension[] {
    return this.getAll<WebhookExtension>("webhook");
  }

  getAllTelemetryExtensions(): TelemetryExtension[] {
    return this.getAll<TelemetryExtension>("telemetry");
  }

  getAllRuntimeExtensions(): RuntimeExtension[] {
    return this.getAll<RuntimeExtension>("runtime");
  }

  getAllModelExtensions(): ModelExtension[] {
    return this.getAll<ModelExtension>("model");
  }

  getAllCredentialExtensions(): CredentialExtension[] {
    return this.getAll<CredentialExtension>("credential");
  }

  getCredentialType(type: string): CredentialTypeDefinition | undefined {
    return this.credentialTypes.get(type);
  }

  getAllCredentialTypes(): CredentialTypeDefinition[] {
    return Array.from(this.credentialTypes.values());
  }

  async unregister(type: ExtensionType, name: string): Promise<void> {
    const typeMap = this.extensions.get(type);
    if (!typeMap) {
      return;
    }

    const extension = typeMap.get(name);
    if (extension) {
      await extension.shutdown();
      typeMap.delete(name);
    }
  }

  async shutdown(): Promise<void> {
    const shutdownPromises: Promise<void>[] = [];

    for (const typeMap of this.extensions.values()) {
      for (const extension of typeMap.values()) {
        shutdownPromises.push(extension.shutdown().catch(error => {
          console.warn(`Error shutting down extension ${extension.metadata.name}:`, error);
        }));
      }
    }

    await Promise.all(shutdownPromises);
  }

  // List all registered extensions
  list(): Array<{ type: ExtensionType; name: string; version: string; description: string }> {
    const result: Array<{ type: ExtensionType; name: string; version: string; description: string }> = [];
    
    for (const [type, typeMap] of this.extensions.entries()) {
      for (const extension of typeMap.values()) {
        result.push({
          type: type as ExtensionType,
          name: extension.metadata.name,
          version: extension.metadata.version,
          description: extension.metadata.description
        });
      }
    }

    return result;
  }
}

// Global extension registry instance
export const globalRegistry = new ExtensionRegistry();