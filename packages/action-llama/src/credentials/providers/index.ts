/**
 * Credential provider extensions
 */

import type { CredentialExtension } from "../../extensions/types.js";
import { FileCredentialProvider } from "./file.js";
import { VaultCredentialProvider } from "./vault.js";

/**
 * File-based credential provider extension
 */
export const fileCredentialExtension: CredentialExtension = {
  metadata: {
    name: "file",
    version: "1.0.0",
    description: "File-based credential provider",
    type: "credential",
    requiredCredentials: [] // No credentials required for file-based provider
  },
  provider: new FileCredentialProvider(),
  async init() {
    // File provider doesn't need initialization
  },
  async shutdown() {
    // File provider doesn't need cleanup
  }
};

/**
 * HashiCorp Vault credential provider extension
 */
export const vaultCredentialExtension: CredentialExtension = {
  metadata: {
    name: "vault",
    version: "1.0.0",
    description: "HashiCorp Vault credential provider",
    type: "credential",
    requiredCredentials: [
      { type: "vault_addr", description: "Vault server address" },
      { type: "vault_token", description: "Vault authentication token" }
    ],
    providesCredentialTypes: [
      {
        type: "vault_addr",
        fields: ["addr"],
        description: "HashiCorp Vault server address",
        validation: async (values) => {
          new URL(values.addr); // Validate URL format
        },
        envMapping: { addr: "VAULT_ADDR" }
      },
      {
        type: "vault_token",
        fields: ["token"],
        description: "HashiCorp Vault authentication token",
        envMapping: { token: "VAULT_TOKEN" }
      }
    ]
  },
  provider: new VaultCredentialProvider({
    vaultAddr: process.env.VAULT_ADDR || "",
    vaultToken: process.env.VAULT_TOKEN || ""
  }),
  async init() {
    const isAvailable = await this.provider.isAvailable();
    if (!isAvailable) {
      throw new Error("Vault server is not available or token is invalid");
    }
  },
  async shutdown() {
    // Vault provider doesn't need cleanup
  }
};