/**
 * Integration tests: cloud/provider.ts createCloudProvider() — no Docker required.
 *
 * createCloudProvider() is a simple async factory that dispatches on the
 * `provider` field of the CloudConfig. It creates a VpsProvider for
 * "vps" configs and throws for unknown provider types. The factory does
 * not make network calls during construction.
 *
 * The VpsProvider constructor accepts a VpsConfig and stores it, creating
 * an SshConfig via the sshConfigFromVps() helper. The constructor itself
 * does not make SSH or network connections.
 *
 * Covers:
 *   - cloud/provider.ts: createCloudProvider({ provider: "vps" }) returns a VpsProvider
 *   - cloud/provider.ts: createCloudProvider({ provider: "vps" }) result.providerName === "vps"
 *   - cloud/provider.ts: createCloudProvider({ provider: "vps" }) has expected CloudProvider methods
 *   - cloud/provider.ts: createCloudProvider({ provider: "unknown" }) throws Error with "Unknown cloud provider"
 *   - cloud/provider.ts: createCloudProvider({ provider: "unknown" }) error message includes the provider name
 *   - cloud/vps/provider.ts: VpsProvider constructor accepts VpsConfig with all optional fields
 *   - cloud/vps/provider.ts: VpsProvider.providerName === "vps"
 *   - cloud/vps/provider.ts: VpsProvider.createRuntime() returns a SshDockerRuntime
 *   - cloud/vps/provider.ts: VpsProvider.createRuntime() return is an object (Runtime)
 *   - cloud/vps/provider.ts: VpsProvider.createCredentialBackend() returns a SshFilesystemBackend
 *   - cloud/vps/provider.ts: reconcileAgents() is a no-op (returns undefined)
 *   - cloud/vps/provider.ts: reconcileInfraPolicy() is a no-op (returns undefined)
 *   - cloud/vps/provider.ts: two VpsProvider instances with different configs are independent
 */

import { describe, it, expect } from "vitest";

const { createCloudProvider } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cloud/provider.js"
);

const { VpsProvider } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cloud/vps/provider.js"
);

/** Minimal VpsConfig for testing — only 'provider' and 'host' are required. */
function makeVpsConfig(overrides: Record<string, any> = {}): any {
  return {
    provider: "vps" as const,
    host: "192.168.1.100",
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// createCloudProvider() tests
// ══════════════════════════════════════════════════════════════════════════════

describe("integration: cloud/provider.ts createCloudProvider() (no Docker required)", { timeout: 30_000 }, () => {

  it("createCloudProvider({ provider: 'vps' }) returns a VpsProvider instance", async () => {
    const provider = await createCloudProvider(makeVpsConfig());
    expect(provider).toBeInstanceOf(VpsProvider);
  });

  it("createCloudProvider({ provider: 'vps' }) result.providerName === 'vps'", async () => {
    const provider = await createCloudProvider(makeVpsConfig());
    expect(provider.providerName).toBe("vps");
  });

  it("createCloudProvider({ provider: 'vps' }) has expected CloudProvider interface methods", async () => {
    const provider = await createCloudProvider(makeVpsConfig());
    expect(typeof provider.provision).toBe("function");
    expect(typeof provider.teardown).toBe("function");
    expect(typeof provider.reconcileAgents).toBe("function");
    expect(typeof provider.reconcileInfraPolicy).toBe("function");
    expect(typeof provider.createRuntime).toBe("function");
    expect(typeof provider.createCredentialBackend).toBe("function");
  });

  it("createCloudProvider with unknown provider throws Error", async () => {
    await expect(
      createCloudProvider({ provider: "unknown-provider" } as any)
    ).rejects.toThrow(Error);
  });

  it("createCloudProvider with unknown provider error message includes 'Unknown cloud provider'", async () => {
    await expect(
      createCloudProvider({ provider: "unknown-provider" } as any)
    ).rejects.toThrow("Unknown cloud provider");
  });

  it("createCloudProvider with unknown provider error message includes the provider name", async () => {
    await expect(
      createCloudProvider({ provider: "my-custom-provider" } as any)
    ).rejects.toThrow("my-custom-provider");
  });

  it("createCloudProvider with 'cloud-run' provider throws (not yet implemented in factory)", async () => {
    await expect(
      createCloudProvider({ provider: "cloud-run", project: "my-proj", region: "us-central1", artifactRegistry: "repo" } as any)
    ).rejects.toThrow(Error);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// VpsProvider constructor + no-SSH methods tests
// ══════════════════════════════════════════════════════════════════════════════

describe("integration: cloud/vps/provider.ts VpsProvider (no Docker/SSH required)", { timeout: 30_000 }, () => {

  it("constructor accepts minimal VpsConfig (host only)", () => {
    expect(() => new VpsProvider({ provider: "vps", host: "example.com" })).not.toThrow();
  });

  it("constructor accepts VpsConfig with all optional fields", () => {
    expect(() => new VpsProvider({
      provider: "vps",
      host: "10.0.0.1",
      sshUser: "admin",
      sshPort: 2222,
      sshKeyPath: "/home/user/.ssh/id_ed25519",
      vultrInstanceId: "abc-123",
      vultrRegion: "ewr",
      hetznerServerId: 42,
      hetznerLocation: "nbg1",
      cloudflareZoneId: "zone-id",
      cloudflareDnsRecordId: "rec-id",
      cloudflareHostname: "api.example.com",
    })).not.toThrow();
  });

  it("providerName is 'vps'", () => {
    const provider = new VpsProvider({ provider: "vps", host: "example.com" });
    expect(provider.providerName).toBe("vps");
  });

  it("createRuntime() returns an object without SSH", () => {
    const provider = new VpsProvider({ provider: "vps", host: "example.com" });
    const runtime = provider.createRuntime();
    expect(runtime).toBeDefined();
    expect(typeof runtime).toBe("object");
  });

  it("createRuntime() result has launch method (Runtime interface)", () => {
    const provider = new VpsProvider({ provider: "vps", host: "example.com" });
    const runtime = provider.createRuntime();
    expect(typeof (runtime as any).launch).toBe("function");
  });

  it("reconcileAgents() is async and resolves without SSH/network", async () => {
    const provider = new VpsProvider({ provider: "vps", host: "example.com" });
    await expect(provider.reconcileAgents("/tmp/project")).resolves.toBeUndefined();
  });

  it("reconcileInfraPolicy() is async and resolves without SSH/network", async () => {
    const provider = new VpsProvider({ provider: "vps", host: "example.com" });
    await expect(provider.reconcileInfraPolicy()).resolves.toBeUndefined();
  });

  it("createCredentialBackend() returns an object with credential backend methods", async () => {
    const provider = new VpsProvider({ provider: "vps", host: "example.com" });
    const backend = await provider.createCredentialBackend();
    expect(backend).toBeDefined();
    // SshFilesystemBackend implements CredentialBackend: read/write/list
    expect(typeof (backend as any).read).toBe("function");
    expect(typeof (backend as any).write).toBe("function");
    expect(typeof (backend as any).list).toBe("function");
  });

  it("two VpsProvider instances with different hosts are independent", () => {
    const p1 = new VpsProvider({ provider: "vps", host: "host-a.example.com" });
    const p2 = new VpsProvider({ provider: "vps", host: "host-b.example.com" });
    expect(p1.providerName).toBe("vps");
    expect(p2.providerName).toBe("vps");
    // Both return a runtime, independently
    const r1 = p1.createRuntime();
    const r2 = p2.createRuntime();
    expect(r1).toBeDefined();
    expect(r2).toBeDefined();
  });

  it("createRuntimes() returns { runtime, agentRuntimeOverrides } shape", () => {
    const provider = new VpsProvider({ provider: "vps", host: "example.com" });
    const result = provider.createRuntimes([], {});
    expect(result).toHaveProperty("runtime");
    expect(result).toHaveProperty("agentRuntimeOverrides");
    expect(typeof result.agentRuntimeOverrides).toBe("object");
  });

  it("createRuntimes() with empty agentConfigs returns empty agentRuntimeOverrides", () => {
    const provider = new VpsProvider({ provider: "vps", host: "example.com" });
    const result = provider.createRuntimes([], {});
    expect(Object.keys(result.agentRuntimeOverrides)).toHaveLength(0);
  });
});
