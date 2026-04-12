import type { Extension } from "./types.js";
import { ExtensionRegistry, globalRegistry } from "./registry.js";

/**
 * Load all built-in extensions into the global registry
 */
export async function loadBuiltinExtensions(
  credentialChecker?: (type: string, instance?: string) => Promise<boolean>,
): Promise<void> {
  // Create a new registry with credential checking
  const registry = new ExtensionRegistry(credentialChecker);

  try {
    // Load webhook provider extensions
    await loadWebhookExtensions(registry);

    // Load credential provider extensions
    await loadCredentialExtensions(registry);

    // Replace the global registry's internals with the new one
    // This is a temporary approach until we refactor the singleton pattern
    Object.assign(globalRegistry, registry);

  } catch (error) {
    console.error("Failed to load built-in extensions:", error);
    throw error;
  }
}

async function loadWebhookExtensions(registry: ExtensionRegistry): Promise<void> {
  try {
    const {
      githubWebhookExtension,
      linearWebhookExtension,
      mintlifyWebhookExtension,
      sentryWebhookExtension,
      slackWebhookExtension,
      testWebhookExtension
    } = await import("../webhooks/providers/index.js");

    await registry.register(githubWebhookExtension);
    await registry.register(linearWebhookExtension);
    await registry.register(mintlifyWebhookExtension);
    await registry.register(sentryWebhookExtension);
    await registry.register(slackWebhookExtension);
    await registry.register(testWebhookExtension);
  } catch (error) {
    console.warn("Failed to load webhook extensions:", error);
    // Don't fail the entire loading process for webhook extensions
  }
}

async function loadCredentialExtensions(registry: ExtensionRegistry): Promise<void> {
  try {
    const {
      fileCredentialExtension,
      vaultCredentialExtension
    } = await import("../credentials/providers/index.js");

    await registry.register(fileCredentialExtension);

    // Only register Vault extension if Vault is configured
    if (process.env.VAULT_ADDR) {
      try {
        await registry.register(vaultCredentialExtension);
      } catch (error) {
        console.warn("Vault credential provider not available:", (error as Error).message);
      }
    }
  } catch (error) {
    console.warn("Failed to load credential extensions:", error);
    // Don't fail the entire loading process for credential extensions
  }
}

/**
 * Check if an object is a valid extension
 */
export function isExtension(obj: any): obj is Extension {
  return (
    obj !== null &&
    obj !== undefined &&
    typeof obj === "object" &&
    "metadata" in obj &&
    "init" in obj &&
    "shutdown" in obj &&
    typeof obj.init === "function" &&
    typeof obj.shutdown === "function" &&
    obj.metadata &&
    typeof obj.metadata.name === "string" &&
    typeof obj.metadata.type === "string"
  );
}

/**
 * Get the global extension registry
 */
export function getGlobalRegistry(): ExtensionRegistry {
  return globalRegistry;
}
