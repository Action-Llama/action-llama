import { describe, it, expect } from "vitest";
import { validateServerConfig } from "../../src/shared/server.js";

describe("validateServerConfig", () => {
  it("accepts minimal config with just host", () => {
    const config = validateServerConfig({ host: "192.168.1.1" });
    expect(config.host).toBe("192.168.1.1");
  });

  it("accepts full config", () => {
    const config = validateServerConfig({
      host: "my-server.example.com",
      user: "deploy",
      port: 2222,
      keyPath: "/home/me/.ssh/id_ed25519",
      basePath: "/srv/action-llama",
    });
    expect(config.host).toBe("my-server.example.com");
    expect(config.user).toBe("deploy");
    expect(config.port).toBe(2222);
    expect(config.keyPath).toBe("/home/me/.ssh/id_ed25519");
    expect(config.basePath).toBe("/srv/action-llama");
  });

  it("throws on null input", () => {
    expect(() => validateServerConfig(null)).toThrow("must be an object");
  });

  it("throws on missing host", () => {
    expect(() => validateServerConfig({ user: "root" })).toThrow("server.host is required");
  });

  it("throws on non-string host", () => {
    expect(() => validateServerConfig({ host: 123 })).toThrow("server.host is required");
  });

  it("throws on invalid port", () => {
    expect(() => validateServerConfig({ host: "h", port: 0 })).toThrow("server.port");
    expect(() => validateServerConfig({ host: "h", port: 70000 })).toThrow("server.port");
    expect(() => validateServerConfig({ host: "h", port: 1.5 })).toThrow("server.port");
  });

  it("throws on non-absolute basePath", () => {
    expect(() => validateServerConfig({ host: "h", basePath: "relative/path" })).toThrow("absolute path");
  });

  it("throws on non-string user", () => {
    expect(() => validateServerConfig({ host: "h", user: 42 })).toThrow("server.user must be a string");
  });

  it("throws on non-string keyPath", () => {
    expect(() => validateServerConfig({ host: "h", keyPath: true })).toThrow("server.keyPath must be a string");
  });

  it("ignores unknown fields", () => {
    const config = validateServerConfig({ host: "h", gatewayPort: 9090 });
    expect(config.host).toBe("h");
  });
});
