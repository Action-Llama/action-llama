import { describe, it, expect, vi } from "vitest";

// Mock GCP auth module for cloudRunDockerExtension.init tests
vi.mock("../../src/cloud/gcp/auth.js", () => ({
  GcpAuth: class MockGcpAuth {
    constructor(public key: any) {}
    async getAccessToken() { return "mock-token"; }
  },
  parseServiceAccountKey: (json: string) => JSON.parse(json),
}));
import {
  localDockerExtension,
  sshDockerExtension,
  cloudRunDockerExtension,
} from "../../../src/docker/providers/index.js";

describe("localDockerExtension", () => {
  describe("metadata", () => {
    it("has name 'local'", () => {
      expect(localDockerExtension.metadata.name).toBe("local");
    });

    it("has version '1.0.0'", () => {
      expect(localDockerExtension.metadata.version).toBe("1.0.0");
    });

    it("has type 'runtime'", () => {
      expect(localDockerExtension.metadata.type).toBe("runtime");
    });

    it("has an empty requiredCredentials array", () => {
      expect(localDockerExtension.metadata.requiredCredentials).toEqual([]);
    });

    it("has a non-empty description", () => {
      expect(typeof localDockerExtension.metadata.description).toBe("string");
      expect(localDockerExtension.metadata.description.length).toBeGreaterThan(0);
    });
  });

  describe("provider", () => {
    it("provider exists", () => {
      expect(localDockerExtension.provider).toBeDefined();
    });
  });

  describe("init", () => {
    it("resolves without error", async () => {
      await expect(localDockerExtension.init()).resolves.toBeUndefined();
    });
  });

  describe("shutdown", () => {
    it("resolves without error", async () => {
      await expect(localDockerExtension.shutdown()).resolves.toBeUndefined();
    });
  });
});

describe("sshDockerExtension", () => {
  describe("metadata", () => {
    it("has name 'ssh'", () => {
      expect(sshDockerExtension.metadata.name).toBe("ssh");
    });

    it("has version '1.0.0'", () => {
      expect(sshDockerExtension.metadata.version).toBe("1.0.0");
    });

    it("has type 'runtime'", () => {
      expect(sshDockerExtension.metadata.type).toBe("runtime");
    });

    it("requires ssh_host credential", () => {
      const types = sshDockerExtension.metadata.requiredCredentials!.map((c) => c.type);
      expect(types).toContain("ssh_host");
    });

    it("has ssh_key as optional credential", () => {
      const sshKey = sshDockerExtension.metadata.requiredCredentials!.find(
        (c) => c.type === "ssh_key"
      );
      expect(sshKey).toBeDefined();
      expect(sshKey!.optional).toBe(true);
    });

    it("has a non-empty description", () => {
      expect(typeof sshDockerExtension.metadata.description).toBe("string");
      expect(sshDockerExtension.metadata.description.length).toBeGreaterThan(0);
    });
  });

  describe("provider", () => {
    it("provider exists", () => {
      expect(sshDockerExtension.provider).toBeDefined();
    });
  });

  describe("init", () => {
    it("resolves without error", async () => {
      await expect(sshDockerExtension.init()).resolves.toBeUndefined();
    });
  });

  describe("shutdown", () => {
    it("resolves without error", async () => {
      await expect(sshDockerExtension.shutdown()).resolves.toBeUndefined();
    });
  });

  describe("providesCredentialTypes", () => {
    const providesTypes = sshDockerExtension.metadata.providesCredentialTypes!;

    describe("ssh_host", () => {
      const sshHostType = providesTypes.find((t) => t.type === "ssh_host")!;

      it("has fields [host, port, username]", () => {
        expect(sshHostType.fields).toEqual(["host", "port", "username"]);
      });

      it("has a description", () => {
        expect(typeof sshHostType.description).toBe("string");
        expect(sshHostType.description.length).toBeGreaterThan(0);
      });

      it("validation resolves for valid host and username", async () => {
        await expect(
          sshHostType.validation!({ host: "192.168.1.1", username: "root", port: "22" })
        ).resolves.toBeUndefined();
      });

      it("validation throws when host is missing", async () => {
        await expect(
          sshHostType.validation!({ host: "", username: "root", port: "22" })
        ).rejects.toThrow("SSH host and username are required");
      });

      it("validation throws when username is missing", async () => {
        await expect(
          sshHostType.validation!({ host: "192.168.1.1", username: "", port: "22" })
        ).rejects.toThrow("SSH host and username are required");
      });

      it("validation throws when port is not a number", async () => {
        await expect(
          sshHostType.validation!({ host: "192.168.1.1", username: "root", port: "not-a-port" })
        ).rejects.toThrow("SSH port must be a number");
      });

      it("validation resolves when port is not provided", async () => {
        await expect(
          sshHostType.validation!({ host: "192.168.1.1", username: "root" })
        ).resolves.toBeUndefined();
      });
    });

    describe("ssh_key", () => {
      const sshKeyType = providesTypes.find((t) => t.type === "ssh_key")!;

      it("has fields [private_key]", () => {
        expect(sshKeyType.fields).toEqual(["private_key"]);
      });

      it("has envMapping for private_key", () => {
        expect(sshKeyType.envMapping).toEqual({ private_key: "SSH_PRIVATE_KEY" });
      });
    });
  });
});

describe("cloudRunDockerExtension", () => {
  describe("metadata", () => {
    it("has name 'cloud-run'", () => {
      expect(cloudRunDockerExtension.metadata.name).toBe("cloud-run");
    });

    it("has version '1.0.0'", () => {
      expect(cloudRunDockerExtension.metadata.version).toBe("1.0.0");
    });

    it("has type 'runtime'", () => {
      expect(cloudRunDockerExtension.metadata.type).toBe("runtime");
    });

    it("requires gcp_service_account credential", () => {
      const types = cloudRunDockerExtension.metadata.requiredCredentials!.map((c) => c.type);
      expect(types).toContain("gcp_service_account");
    });

    it("has a non-empty description", () => {
      expect(typeof cloudRunDockerExtension.metadata.description).toBe("string");
      expect(cloudRunDockerExtension.metadata.description.length).toBeGreaterThan(0);
    });
  });

  describe("init", () => {
    it("resolves without error when no config is provided", async () => {
      await expect(cloudRunDockerExtension.init()).resolves.toBeUndefined();
    });

    it("initializes provider when all required config is provided", async () => {
      const keyJson = JSON.stringify({
        type: "service_account",
        project_id: "my-project",
        private_key_id: "key-id",
        private_key: "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----\n",
        client_email: "sa@my-project.iam.gserviceaccount.com",
        client_id: "123",
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
      });

      await cloudRunDockerExtension.init({
        keyJson,
        project: "my-project",
        region: "us-central1",
        artifactRegistry: "my-repo",
        serviceAccount: "sa@my-project.iam.gserviceaccount.com",
      });

      // Provider should now be set (not null)
      expect(cloudRunDockerExtension.provider).toBeDefined();
      expect(cloudRunDockerExtension.provider).not.toBeNull();
    });
  });

  describe("shutdown", () => {
    it("resolves without error", async () => {
      await expect(cloudRunDockerExtension.shutdown()).resolves.toBeUndefined();
    });
  });
});
