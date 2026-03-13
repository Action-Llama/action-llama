import { describe, it, expect, vi } from "vitest";
import { createBackendFromCloudConfig, createLocalBackend } from "../../src/shared/remote.js";

// Mock the provider factory to avoid real cloud SDK imports
vi.mock("../../src/cloud/provider.js", () => ({
  createCloudProvider: vi.fn().mockImplementation(async (config: any) => {
    if (config.provider === "ecs") {
      return {
        createCredentialBackend: async () => ({
          read: vi.fn(), write: vi.fn(), list: vi.fn().mockResolvedValue([]),
          exists: vi.fn(), readAll: vi.fn(), writeAll: vi.fn(), listInstances: vi.fn(),
        }),
      };
    }
    if (config.provider === "cloud-run") {
      return {
        createCredentialBackend: async () => ({
          read: vi.fn(), write: vi.fn(), list: vi.fn().mockResolvedValue([]),
          exists: vi.fn(), readAll: vi.fn(), writeAll: vi.fn(), listInstances: vi.fn(),
        }),
      };
    }
    throw new Error(`Unknown cloud provider: "${config.provider}"`);
  }),
}));

describe("createBackendFromCloudConfig", () => {
  it("returns a backend for ecs provider", async () => {
    const cloud = {
      provider: "ecs" as const,
      awsRegion: "us-east-1",
      ecsCluster: "al-cluster",
      ecrRepository: "123456789012.dkr.ecr.us-east-1.amazonaws.com/al-images",
      executionRoleArn: "arn:aws:iam::123456789012:role/exec",
      taskRoleArn: "arn:aws:iam::123456789012:role/task",
      subnets: ["subnet-abc"],
    };
    const backend = await createBackendFromCloudConfig(cloud);
    expect(backend).toBeDefined();
    expect(backend.read).toBeDefined();
  });

  it("returns a backend for cloud-run provider", async () => {
    const cloud = {
      provider: "cloud-run" as const,
      gcpProject: "my-proj",
      region: "us-central1",
      artifactRegistry: "us-central1-docker.pkg.dev/my-proj/al-images",
      serviceAccount: "runner@my-proj.iam.gserviceaccount.com",
    };
    const backend = await createBackendFromCloudConfig(cloud);
    expect(backend).toBeDefined();
    expect(backend.read).toBeDefined();
  });

  it("throws for unknown provider", async () => {
    const cloud = { provider: "unknown" } as any;
    await expect(createBackendFromCloudConfig(cloud)).rejects.toThrow("Unknown cloud provider");
  });
});

describe("createLocalBackend", () => {
  it("returns a filesystem backend", () => {
    const backend = createLocalBackend();
    expect(backend).toBeDefined();
  });
});
