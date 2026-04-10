import { describe, it, expect, vi, beforeEach } from "vitest";
import { RemoteBinding, TransportConnectionFailedError } from "../src/binding.js";
import type { RemotesConfig } from "../src/config.js";
import { UnknownRemoteError } from "../src/config.js";

// Mock child_process to prevent actual spawns
vi.mock("child_process", () => ({
  spawn: vi.fn(() => {
    throw new Error("Mocked spawn should not be called in binding tests");
  }),
  execFileSync: vi.fn(),
}));

describe("RemoteBinding", () => {
  describe("resolveRemoteName", () => {
    it("prefers flag value over config default", () => {
      const config: RemotesConfig = { defaultRemote: "default-one", remotes: {} };
      expect(RemoteBinding.resolveRemoteName("flag-value", config)).toBe("flag-value");
    });

    it("falls back to config defaultRemote", () => {
      const config: RemotesConfig = { defaultRemote: "default-one", remotes: {} };
      expect(RemoteBinding.resolveRemoteName(undefined, config)).toBe("default-one");
    });

    it("falls back to env var", () => {
      expect(RemoteBinding.resolveRemoteName(undefined, null, "env-remote")).toBe("env-remote");
    });

    it("returns null when nothing is set", () => {
      expect(RemoteBinding.resolveRemoteName(undefined, null)).toBeNull();
    });

    it("follows precedence: flag > config > env", () => {
      const config: RemotesConfig = { defaultRemote: "config-default", remotes: {} };
      expect(RemoteBinding.resolveRemoteName("flag", config, "env")).toBe("flag");
      expect(RemoteBinding.resolveRemoteName(undefined, config, "env")).toBe("config-default");
    });
  });

  describe("bind/unbind", () => {
    it("starts unbound", () => {
      const binding = new RemoteBinding();
      expect(binding.isBound).toBe(false);
      expect(binding.name).toBeNull();
      expect(binding.transport).toBeNull();
    });

    it("throws UnknownRemoteError for unknown remote name", async () => {
      const binding = new RemoteBinding();
      const config: RemotesConfig = { remotes: { a: { type: "host-user" } } };

      await expect(binding.bind("nonexistent", config)).rejects.toThrow(UnknownRemoteError);
    });

    it("unbind is safe when not bound", async () => {
      const binding = new RemoteBinding();
      await binding.unbind(); // should not throw
      expect(binding.isBound).toBe(false);
    });
  });
});
