import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the runtime constructor as a class
const mockCloudRunRuntime = { launch: vi.fn(), buildImage: vi.fn() };

vi.mock("../../../src/docker/cloud-run-runtime.js", () => ({
  CloudRunJobRuntime: class { constructor() { return mockCloudRunRuntime; } },
}));

vi.mock("../../../src/shared/gsm-backend.js", () => ({
  GoogleSecretManagerBackend: class {
    read = vi.fn();
    write = vi.fn();
    list = vi.fn().mockResolvedValue([]);
  },
}));

import { GcpCloudProvider } from "../../../src/cloud/gcp/provider.js";
import type { CloudRunCloudConfig } from "../../../src/shared/config.js";

const testConfig: CloudRunCloudConfig = {
  provider: "cloud-run",
  gcpProject: "my-project",
  region: "us-central1",
  artifactRegistry: "us-central1-docker.pkg.dev/my-project/al-images",
  serviceAccount: "al-runner@my-project.iam.gserviceaccount.com",
};

describe("GcpCloudProvider", () => {
  let provider: GcpCloudProvider;

  beforeEach(() => {
    provider = new GcpCloudProvider(testConfig);
  });

  it("has correct providerName", () => {
    expect(provider.providerName).toBe("cloud-run");
  });

  it("createRuntime returns a Cloud Run runtime", () => {
    const runtime = provider.createRuntime();
    expect(runtime).toBe(mockCloudRunRuntime);
  });

  it("createAgentRuntime always returns Cloud Run runtime (no Lambda routing)", () => {
    const agentConfig = {
      name: "test-agent",
      credentials: [],
      model: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" as const },
      timeout: 300,
    };
    const globalConfig = {};

    const runtime = provider.createAgentRuntime(agentConfig, globalConfig);
    expect(runtime).toBe(mockCloudRunRuntime);
  });

  it("createRuntimes returns empty overrides", () => {
    const agents = [
      { name: "short", credentials: [], model: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" as const }, timeout: 300 },
      { name: "long", credentials: [], model: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" as const }, timeout: 1800 },
    ];

    const result = provider.createRuntimes(agents, {});
    expect(result.runtime).toBe(mockCloudRunRuntime);
    expect(Object.keys(result.agentRuntimeOverrides)).toHaveLength(0);
  });

  it("createCredentialBackend returns GSM backend", async () => {
    const backend = await provider.createCredentialBackend();
    expect(backend).toBeDefined();
    expect(backend.read).toBeDefined();
  });

  it("validateRoles is a no-op", async () => {
    await provider.validateRoles("/some/path");
  });
});
