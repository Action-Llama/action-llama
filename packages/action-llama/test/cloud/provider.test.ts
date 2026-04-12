import { describe, it, expect } from "vitest";

import { createCloudProvider } from "../../src/cloud/provider.js";

describe("createCloudProvider", () => {
  it("throws an error for unknown provider type", async () => {
    const cloudConfig = {
      provider: "unknown-provider" as any,
    };

    await expect(createCloudProvider(cloudConfig)).rejects.toThrow(
      'Unknown cloud provider: "unknown-provider"',
    );
  });
});
