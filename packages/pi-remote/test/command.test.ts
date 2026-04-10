import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { handleRemoteCommand } from "../src/command.js";
import { RemoteBinding } from "../src/binding.js";
import type { RemotesConfig } from "../src/config.js";

function createMockChildProcess() {
  const cp = new EventEmitter() as any;
  cp.stdin = { write: vi.fn(), end: vi.fn(), on: vi.fn() };
  cp.stdout = new EventEmitter();
  cp.stderr = new EventEmitter();
  cp.pid = 12345;
  cp.kill = vi.fn();
  return cp;
}

// Mock child_process with a working spawn for host-user transport
vi.mock("child_process", () => ({
  spawn: vi.fn(() => createMockChildProcess()),
  execFileSync: vi.fn(),
}));

describe("handleRemoteCommand", () => {
  let binding: RemoteBinding;
  let originalEnv: string | undefined;

  beforeEach(() => {
    binding = new RemoteBinding();
    originalEnv = process.env.PI_REMOTE;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.PI_REMOTE;
    } else {
      process.env.PI_REMOTE = originalEnv;
    }
  });

  it("shows 'not connected' when no args and unbound", async () => {
    const result = await handleRemoteCommand("", binding, null);
    expect(result.message).toContain("Not connected");
  });

  it("shows 'already running locally' for /remote local when unbound", async () => {
    const result = await handleRemoteCommand("local", binding, null);
    expect(result.message).toContain("Already running locally");
  });

  it("returns error when trying to switch without config", async () => {
    const result = await handleRemoteCommand("dev", binding, null);
    expect(result.error).toBe(true);
    expect(result.message).toContain("No remotes.json found");
  });

  it("returns error for unknown remote name", async () => {
    const config: RemotesConfig = {
      remotes: { dev: { type: "host-user" } },
    };
    const result = await handleRemoteCommand("staging", binding, config);
    expect(result.error).toBe(true);
    expect(result.message).toContain("Unknown remote");
    expect(result.message).toContain("dev");
  });

  describe("PI_REMOTE env var inheritance", () => {
    it("sets PI_REMOTE when binding succeeds", async () => {
      delete process.env.PI_REMOTE;
      const config: RemotesConfig = {
        remotes: { dev: { type: "host-user" } },
      };
      // Mock bind to succeed without actually connecting a transport
      vi.spyOn(binding, "bind").mockResolvedValue();
      // Mock isBound and entry for the success path
      Object.defineProperty(binding, "isBound", { get: () => true, configurable: true });
      Object.defineProperty(binding, "entry", { get: () => ({ type: "host-user" }), configurable: true });

      const result = await handleRemoteCommand("dev", binding, config);
      expect(result.error).toBeUndefined();
      expect(process.env.PI_REMOTE).toBe("dev");
    });

    it("clears PI_REMOTE when switching to local", async () => {
      process.env.PI_REMOTE = "dev";
      // Mock as currently bound
      Object.defineProperty(binding, "isBound", { get: () => true, configurable: true });
      Object.defineProperty(binding, "name", { get: () => "dev", configurable: true });
      vi.spyOn(binding, "unbind").mockImplementation(async () => {
        Object.defineProperty(binding, "isBound", { get: () => false, configurable: true });
      });

      const result = await handleRemoteCommand("local", binding, null);
      expect(result.error).toBeUndefined();
      expect(process.env.PI_REMOTE).toBeUndefined();
    });

    it("does not set PI_REMOTE on connection failure", async () => {
      delete process.env.PI_REMOTE;
      const config: RemotesConfig = {
        remotes: { broken: { type: "ssh", host: "nonexistent.invalid" } },
      };
      vi.spyOn(binding, "bind").mockRejectedValue(new Error("Connection refused"));

      const result = await handleRemoteCommand("broken", binding, config);
      expect(result.error).toBe(true);
      expect(process.env.PI_REMOTE).toBeUndefined();
    });
  });
});
