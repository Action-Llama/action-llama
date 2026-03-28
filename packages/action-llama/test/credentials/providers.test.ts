import { describe, it, expect, vi, beforeEach } from "vitest";
import { FileCredentialProvider } from "../../src/credentials/providers/file.js";
import { VaultCredentialProvider } from "../../src/credentials/providers/vault.js";

// Mock fetch for Vault tests
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("FileCredentialProvider", () => {
  let provider: FileCredentialProvider;

  beforeEach(() => {
    provider = new FileCredentialProvider();
    vi.unstubAllEnvs();
  });

  it("has name 'file'", () => {
    expect(provider.name).toBe("file");
  });

  describe("list()", () => {
    it("returns empty array for any type", async () => {
      const result = await provider.list("github_token");
      expect(result).toEqual([]);
    });
  });

  describe("get()", () => {
    it("returns null when environment variable not set", async () => {
      delete process.env["GITHUB_TOKEN"];
      const result = await provider.get("github_token");
      expect(result).toBeNull();
    });

    it("returns value from environment variable when set", async () => {
      process.env["GITHUB_TOKEN"] = "ghp_test123";
      const result = await provider.get("github_token");
      expect(result).toEqual({ github_token: "ghp_test123" });
      delete process.env["GITHUB_TOKEN"];
    });

    it("includes instance in env var name when instance provided", async () => {
      process.env["GITHUB_TOKEN_MYORG"] = "ghp_org_token";
      const result = await provider.get("github_token", "myorg");
      expect(result).toEqual({ github_token: "ghp_org_token" });
      delete process.env["GITHUB_TOKEN_MYORG"];
    });
  });

  describe("store()", () => {
    it("throws 'not yet implemented' error", async () => {
      await expect(provider.store("github_token", "default", { token: "abc" })).rejects.toThrow(
        "File credential provider storage not yet implemented"
      );
    });
  });

  describe("remove()", () => {
    it("throws 'not yet implemented' error", async () => {
      await expect(provider.remove("github_token", "default")).rejects.toThrow(
        "File credential provider removal not yet implemented"
      );
    });
  });

  describe("isAvailable()", () => {
    it("returns true", async () => {
      const result = await provider.isAvailable();
      expect(result).toBe(true);
    });
  });
});

describe("VaultCredentialProvider", () => {
  let provider: VaultCredentialProvider;
  const config = { vaultAddr: "http://vault:8200", vaultToken: "test-token" };

  beforeEach(() => {
    provider = new VaultCredentialProvider(config);
    mockFetch.mockReset();
  });

  it("has name 'vault'", () => {
    expect(provider.name).toBe("vault");
  });

  describe("list()", () => {
    it("returns keys from vault KV metadata response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { keys: ["default", "prod"] } }),
      });

      const result = await provider.list("github_token");
      expect(result).toEqual(["default", "prod"]);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://vault:8200/v1/secret/metadata/github_token",
        { headers: { "X-Vault-Token": "test-token" } }
      );
    });

    it("returns empty array when vault responds with non-ok status", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const result = await provider.list("github_token");
      expect(result).toEqual([]);
    });

    it("returns empty array on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("network error"));

      const result = await provider.list("github_token");
      expect(result).toEqual([]);
    });

    it("returns empty array when data.keys is missing", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {} }),
      });

      const result = await provider.list("github_token");
      expect(result).toEqual([]);
    });
  });

  describe("get()", () => {
    it("returns credential data from vault KV response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { data: { token: "ghp_abc" } } }),
      });

      const result = await provider.get("github_token", "default");
      expect(result).toEqual({ token: "ghp_abc" });
      expect(mockFetch).toHaveBeenCalledWith(
        "http://vault:8200/v1/secret/data/github_token/default",
        { headers: { "X-Vault-Token": "test-token" } }
      );
    });

    it("uses type-only path when no instance provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { data: { token: "key" } } }),
      });

      await provider.get("anthropic_key");
      expect(mockFetch).toHaveBeenCalledWith(
        "http://vault:8200/v1/secret/data/anthropic_key",
        expect.any(Object)
      );
    });

    it("returns null when vault responds with non-ok status", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const result = await provider.get("github_token", "default");
      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("network error"));

      const result = await provider.get("github_token", "default");
      expect(result).toBeNull();
    });

    it("returns null when data.data is missing", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {} }),
      });

      const result = await provider.get("github_token");
      expect(result).toBeNull();
    });
  });

  describe("store()", () => {
    it("stores credential in vault successfully", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await expect(provider.store("github_token", "default", { token: "ghp_abc" })).resolves.toBeUndefined();
      expect(mockFetch).toHaveBeenCalledWith(
        "http://vault:8200/v1/secret/data/github_token/default",
        {
          method: "POST",
          headers: { "X-Vault-Token": "test-token", "Content-Type": "application/json" },
          body: JSON.stringify({ data: { token: "ghp_abc" } }),
        }
      );
    });

    it("throws error when vault returns non-ok status", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => "permission denied",
      });

      await expect(provider.store("github_token", "default", { token: "abc" })).rejects.toThrow(
        "Failed to store credential in Vault: permission denied"
      );
    });
  });

  describe("remove()", () => {
    it("removes credential from vault successfully", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await expect(provider.remove("github_token", "default")).resolves.toBeUndefined();
      expect(mockFetch).toHaveBeenCalledWith(
        "http://vault:8200/v1/secret/data/github_token/default",
        {
          method: "DELETE",
          headers: { "X-Vault-Token": "test-token" },
        }
      );
    });

    it("throws error when vault returns non-ok status", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => "not found",
      });

      await expect(provider.remove("github_token", "default")).rejects.toThrow(
        "Failed to remove credential from Vault: not found"
      );
    });
  });

  describe("isAvailable()", () => {
    it("returns true when vault health endpoint responds ok", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const result = await provider.isAvailable();
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://vault:8200/v1/sys/health",
        { headers: { "X-Vault-Token": "test-token" } }
      );
    });

    it("returns false when vault health endpoint responds non-ok", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const result = await provider.isAvailable();
      expect(result).toBe(false);
    });

    it("returns false when vault is unreachable", async () => {
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const result = await provider.isAvailable();
      expect(result).toBe(false);
    });
  });
});
