import { describe, it, expect } from "vitest";
import {
  localDockerExtension,
  sshDockerExtension,
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
