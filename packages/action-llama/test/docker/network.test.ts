import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExecFileSync } = vi.hoisted(() => {
  return { mockExecFileSync: vi.fn() };
});

// Mock child_process before importing the module under test
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, execFileSync: mockExecFileSync };
});

import { ensureNetwork, removeNetwork, NETWORK_NAME } from "../../src/docker/network.js";

describe("docker/network", () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  describe("NETWORK_NAME", () => {
    it("is a non-empty string", () => {
      expect(typeof NETWORK_NAME).toBe("string");
      expect(NETWORK_NAME.length).toBeGreaterThan(0);
    });

    it("equals 'al-net'", () => {
      expect(NETWORK_NAME).toBe("al-net");
    });
  });

  describe("ensureNetwork", () => {
    it("calls docker network inspect and does nothing else when network exists", () => {
      mockExecFileSync.mockReturnValue("");

      ensureNetwork();

      expect(mockExecFileSync).toHaveBeenCalledTimes(1);
      expect(mockExecFileSync).toHaveBeenCalledWith("docker", ["network", "inspect", NETWORK_NAME], expect.any(Object));
    });

    it("creates network when inspect throws (network does not exist)", () => {
      mockExecFileSync
        .mockImplementationOnce(() => { throw new Error("No such network"); })
        .mockReturnValueOnce("");

      ensureNetwork();

      expect(mockExecFileSync).toHaveBeenCalledTimes(2);
      expect(mockExecFileSync).toHaveBeenNthCalledWith(2, "docker", ["network", "create", NETWORK_NAME], expect.any(Object));
    });

    it("returns without error when network already exists race (already exists error via stderr)", () => {
      const alreadyExistsError: any = new Error("create network failed");
      alreadyExistsError.stderr = Buffer.from("network already exists");

      mockExecFileSync
        .mockImplementationOnce(() => { throw new Error("No such network"); })
        .mockImplementationOnce(() => { throw alreadyExistsError; });

      expect(() => ensureNetwork()).not.toThrow();
    });

    it("rethrows error when create fails with unexpected error", () => {
      const unexpectedError: any = new Error("permission denied");
      unexpectedError.stderr = Buffer.from("permission denied");

      mockExecFileSync
        .mockImplementationOnce(() => { throw new Error("No such network"); })
        .mockImplementationOnce(() => { throw unexpectedError; });

      expect(() => ensureNetwork()).toThrow("permission denied");
    });

    it("handles error with message (no stderr) containing 'already exists'", () => {
      const alreadyExistsError: any = new Error("network already exists");
      alreadyExistsError.stderr = undefined;

      mockExecFileSync
        .mockImplementationOnce(() => { throw new Error("No such network"); })
        .mockImplementationOnce(() => { throw alreadyExistsError; });

      expect(() => ensureNetwork()).not.toThrow();
    });
  });

  describe("removeNetwork", () => {
    it("calls docker network rm", () => {
      mockExecFileSync.mockReturnValue("");

      removeNetwork();

      expect(mockExecFileSync).toHaveBeenCalledTimes(1);
      expect(mockExecFileSync).toHaveBeenCalledWith("docker", ["network", "rm", NETWORK_NAME], expect.any(Object));
    });

    it("does not throw when network does not exist", () => {
      mockExecFileSync.mockImplementationOnce(() => { throw new Error("No such network"); });

      expect(() => removeNetwork()).not.toThrow();
    });

    it("does not throw when network has active containers", () => {
      mockExecFileSync.mockImplementationOnce(() => { throw new Error("active containers"); });

      expect(() => removeNetwork()).not.toThrow();
    });
  });
});
