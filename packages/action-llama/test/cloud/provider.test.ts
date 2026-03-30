import { describe, it, expect, vi } from "vitest";

// Mock child_process for SSH operations used by VpsProvider
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, execFile: vi.fn(), spawn: vi.fn() };
});

import { createCloudProvider } from "../../src/cloud/provider.js";

describe("createCloudProvider", () => {
  it("creates a VpsProvider for 'vps' cloud config", async () => {
    const cloudConfig = {
      provider: "vps" as const,
      host: "1.2.3.4",
    };

    const provider = await createCloudProvider(cloudConfig);

    expect(provider.providerName).toBe("vps");
    expect(typeof provider.provision).toBe("function");
    expect(typeof provider.createRuntime).toBe("function");
  });

  it("throws an error for unknown provider type", async () => {
    const cloudConfig = {
      provider: "unknown-provider" as any,
    };

    await expect(createCloudProvider(cloudConfig)).rejects.toThrow(
      'Unknown cloud provider: "unknown-provider"',
    );
  });
});
