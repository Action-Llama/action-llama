import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/remote/ssh.js", () => ({
  sshExec: vi.fn(),
}));

import { bootstrapServer } from "../../src/remote/bootstrap.js";
import { sshExec } from "../../src/remote/ssh.js";

const mockedSshExec = vi.mocked(sshExec);

const TEST_SSH = { host: "example.com", user: "root", port: 22, keyPath: "/tmp/key" };

describe("bootstrapServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("successful bootstrap", () => {
    it("returns node path, node version and docker version when all checks pass", async () => {
      mockedSshExec
        .mockResolvedValueOnce("v22.0.0\n/usr/bin/node\n") // node --version && which node
        .mockResolvedValueOnce("27.1.1\n"); // docker info

      const result = await bootstrapServer(TEST_SSH);

      expect(result.nodePath).toBe("/usr/bin/node");
      expect(result.nodeVersion).toBe("v22.0.0");
      expect(result.dockerVersion).toBe("27.1.1");
    });

    it("accepts Node.js exactly at version 20", async () => {
      mockedSshExec
        .mockResolvedValueOnce("v20.0.0\n/usr/local/bin/node\n")
        .mockResolvedValueOnce("26.0.0");

      const result = await bootstrapServer(TEST_SSH);

      expect(result.nodeVersion).toBe("v20.0.0");
      expect(result.nodePath).toBe("/usr/local/bin/node");
    });

    it("trims whitespace from docker version", async () => {
      mockedSshExec
        .mockResolvedValueOnce("v22.0.0\n/usr/bin/node\n")
        .mockResolvedValueOnce("  27.1.1  \n");

      const result = await bootstrapServer(TEST_SSH);

      expect(result.dockerVersion).toBe("27.1.1");
    });
  });

  describe("node check failures", () => {
    it("throws when node is not found", async () => {
      mockedSshExec
        .mockRejectedValueOnce(new Error("command not found: node"))
        .mockResolvedValueOnce("27.1.1");

      await expect(bootstrapServer(TEST_SSH)).rejects.toThrow("Server prerequisites not met");
    });

    it("includes 'Node.js not found' in error when node command fails", async () => {
      mockedSshExec
        .mockRejectedValueOnce(new Error("command not found: node"))
        .mockResolvedValueOnce("27.1.1");

      await expect(bootstrapServer(TEST_SSH)).rejects.toThrow("Node.js not found on the server");
    });

    it("throws when node version is below 20", async () => {
      mockedSshExec
        .mockResolvedValueOnce("v18.19.0\n/usr/bin/node\n")
        .mockResolvedValueOnce("27.1.1");

      await expect(bootstrapServer(TEST_SSH)).rejects.toThrow("Node.js >= 20 required");
    });

    it("includes node version in error when it's too old", async () => {
      mockedSshExec
        .mockResolvedValueOnce("v16.0.0\n/usr/bin/node\n")
        .mockResolvedValueOnce("27.1.1");

      await expect(bootstrapServer(TEST_SSH)).rejects.toThrow("v16.0.0");
    });
  });

  describe("docker check failures", () => {
    it("throws when docker is not running", async () => {
      mockedSshExec
        .mockResolvedValueOnce("v22.0.0\n/usr/bin/node\n")
        .mockRejectedValueOnce(new Error("Cannot connect to Docker daemon"));

      await expect(bootstrapServer(TEST_SSH)).rejects.toThrow("Server prerequisites not met");
    });

    it("includes 'Docker is not running' in error", async () => {
      mockedSshExec
        .mockResolvedValueOnce("v22.0.0\n/usr/bin/node\n")
        .mockRejectedValueOnce(new Error("Cannot connect to Docker daemon"));

      await expect(bootstrapServer(TEST_SSH)).rejects.toThrow("Docker is not running on the server");
    });
  });

  describe("multiple failures", () => {
    it("collects both node and docker errors when both fail", async () => {
      mockedSshExec
        .mockRejectedValueOnce(new Error("command not found: node"))
        .mockRejectedValueOnce(new Error("Docker not running"));

      const err = await bootstrapServer(TEST_SSH).catch((e) => e);

      expect(err.message).toContain("Server prerequisites not met");
      expect(err.message).toContain("Node.js not found");
      expect(err.message).toContain("Docker is not running");
    });

    it("error message lists each failure on its own line with dash prefix", async () => {
      mockedSshExec
        .mockRejectedValueOnce(new Error("no node"))
        .mockRejectedValueOnce(new Error("no docker"));

      const err = await bootstrapServer(TEST_SSH).catch((e) => e);

      expect(err.message).toContain("  -");
    });
  });
});
