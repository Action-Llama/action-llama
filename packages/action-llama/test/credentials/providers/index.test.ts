import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fileCredentialExtension,
  vaultCredentialExtension,
} from "../../../src/credentials/providers/index.js";

describe("fileCredentialExtension", () => {
  describe("metadata", () => {
    it("has name 'file'", () => {
      expect(fileCredentialExtension.metadata.name).toBe("file");
    });

    it("has version '1.0.0'", () => {
      expect(fileCredentialExtension.metadata.version).toBe("1.0.0");
    });

    it("has type 'credential'", () => {
      expect(fileCredentialExtension.metadata.type).toBe("credential");
    });

    it("has an empty requiredCredentials array", () => {
      expect(fileCredentialExtension.metadata.requiredCredentials).toEqual([]);
    });

    it("has a description", () => {
      expect(typeof fileCredentialExtension.metadata.description).toBe("string");
      expect(fileCredentialExtension.metadata.description.length).toBeGreaterThan(0);
    });
  });

  describe("provider", () => {
    it("provider name is 'file'", () => {
      expect(fileCredentialExtension.provider.name).toBe("file");
    });
  });

  describe("init", () => {
    it("resolves without error", async () => {
      await expect(fileCredentialExtension.init()).resolves.toBeUndefined();
    });
  });

  describe("shutdown", () => {
    it("resolves without error", async () => {
      await expect(fileCredentialExtension.shutdown()).resolves.toBeUndefined();
    });
  });
});

describe("vaultCredentialExtension", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("metadata", () => {
    it("has name 'vault'", () => {
      expect(vaultCredentialExtension.metadata.name).toBe("vault");
    });

    it("has version '1.0.0'", () => {
      expect(vaultCredentialExtension.metadata.version).toBe("1.0.0");
    });

    it("has type 'credential'", () => {
      expect(vaultCredentialExtension.metadata.type).toBe("credential");
    });

    it("requires vault_addr and vault_token credentials", () => {
      const types = vaultCredentialExtension.metadata.requiredCredentials!.map((c) => c.type);
      expect(types).toContain("vault_addr");
      expect(types).toContain("vault_token");
    });

    it("has a description", () => {
      expect(typeof vaultCredentialExtension.metadata.description).toBe("string");
      expect(vaultCredentialExtension.metadata.description.length).toBeGreaterThan(0);
    });
  });

  describe("provider", () => {
    it("provider name is 'vault'", () => {
      expect(vaultCredentialExtension.provider.name).toBe("vault");
    });
  });

  describe("init", () => {
    it("resolves when vault is available", async () => {
      vi.spyOn(vaultCredentialExtension.provider, "isAvailable").mockResolvedValue(true);
      await expect(vaultCredentialExtension.init()).resolves.toBeUndefined();
    });

    it("throws when vault is not available", async () => {
      vi.spyOn(vaultCredentialExtension.provider, "isAvailable").mockResolvedValue(false);
      await expect(vaultCredentialExtension.init()).rejects.toThrow(
        "Vault server is not available or token is invalid"
      );
    });
  });

  describe("shutdown", () => {
    it("resolves without error", async () => {
      await expect(vaultCredentialExtension.shutdown()).resolves.toBeUndefined();
    });
  });

  describe("providesCredentialTypes", () => {
    const providesTypes = vaultCredentialExtension.metadata.providesCredentialTypes!;

    describe("vault_addr", () => {
      const vaultAddrType = providesTypes.find((t) => t.type === "vault_addr")!;

      it("has fields [addr]", () => {
        expect(vaultAddrType.fields).toEqual(["addr"]);
      });

      it("has envMapping for addr", () => {
        expect(vaultAddrType.envMapping).toEqual({ addr: "VAULT_ADDR" });
      });

      it("validation resolves for a valid URL", async () => {
        await expect(
          vaultAddrType.validation!({ addr: "https://vault.example.com:8200" })
        ).resolves.toBeUndefined();
      });

      it("validation throws for an invalid URL", async () => {
        await expect(
          vaultAddrType.validation!({ addr: "not-a-valid-url" })
        ).rejects.toThrow();
      });
    });

    describe("vault_token", () => {
      const vaultTokenType = providesTypes.find((t) => t.type === "vault_token")!;

      it("has fields [token]", () => {
        expect(vaultTokenType.fields).toEqual(["token"]);
      });

      it("has envMapping for token", () => {
        expect(vaultTokenType.envMapping).toEqual({ token: "VAULT_TOKEN" });
      });
    });
  });
});
