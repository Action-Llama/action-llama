/**
 * HashiCorp Vault credential provider implementation
 */

import type { CredentialProvider } from "../../extensions/types.js";

export class VaultCredentialProvider implements CredentialProvider {
  name = "vault";
  private vaultAddr: string;
  private vaultToken: string;

  constructor(config: { vaultAddr: string; vaultToken: string }) {
    this.vaultAddr = config.vaultAddr;
    this.vaultToken = config.vaultToken;
  }

  async list(type: string): Promise<string[]> {
    // List all secret instances for a given type from Vault KV store
    const url = `${this.vaultAddr}/v1/secret/metadata/${type}`;
    
    try {
      const response = await fetch(url, {
        headers: {
          'X-Vault-Token': this.vaultToken
        }
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return data.data?.keys || [];
    } catch {
      return [];
    }
  }

  async get(type: string, instance?: string): Promise<Record<string, string> | null> {
    const path = instance ? `${type}/${instance}` : type;
    const url = `${this.vaultAddr}/v1/secret/data/${path}`;
    
    try {
      const response = await fetch(url, {
        headers: {
          'X-Vault-Token': this.vaultToken
        }
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.data?.data || null;
    } catch {
      return null;
    }
  }

  async store(type: string, instance: string, values: Record<string, string>): Promise<void> {
    const path = `${type}/${instance}`;
    const url = `${this.vaultAddr}/v1/secret/data/${path}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Vault-Token': this.vaultToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ data: values })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to store credential in Vault: ${error}`);
    }
  }

  async remove(type: string, instance: string): Promise<void> {
    const path = `${type}/${instance}`;
    const url = `${this.vaultAddr}/v1/secret/data/${path}`;
    
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'X-Vault-Token': this.vaultToken
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to remove credential from Vault: ${error}`);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.vaultAddr}/v1/sys/health`, {
        headers: {
          'X-Vault-Token': this.vaultToken
        }
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}