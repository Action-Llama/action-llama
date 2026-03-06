import { describe, it, expect } from "vitest";
import { createBackendFromCloudConfig, createLocalBackend } from "../../src/shared/remote.js";
import type { CloudConfig } from "../../src/shared/config.js";

describe("createBackendFromCloudConfig", () => {
  it("throws for cloud-run without gcpProject", async () => {
    const cloud: CloudConfig = { provider: "cloud-run" };
    await expect(createBackendFromCloudConfig(cloud)).rejects.toThrow("gcpProject");
  });

  it("throws for ecs without awsRegion", async () => {
    const cloud: CloudConfig = { provider: "ecs" };
    await expect(createBackendFromCloudConfig(cloud)).rejects.toThrow("awsRegion");
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
