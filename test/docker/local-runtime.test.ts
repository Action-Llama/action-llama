import { describe, it, expect, vi } from "vitest";
import { LocalDockerRuntime } from "../../src/docker/local-runtime.js";
import type { ContainerRuntime } from "../../src/docker/runtime.js";

// Mock credentials module so prepareCredentials doesn't hit the filesystem
vi.mock("../../src/shared/credentials.js", () => ({
  parseCredentialRef: (ref: string) => {
    const sep = ref.indexOf(":");
    if (sep === -1) return { type: ref, instance: "default" };
    return { type: ref.slice(0, sep).trim(), instance: ref.slice(sep + 1).trim() };
  },
  getDefaultBackend: () => ({
    readAll: () => Promise.resolve({ token: "fake-value" }),
  }),
}));

describe("LocalDockerRuntime", () => {
  it("implements ContainerRuntime interface", () => {
    const runtime: ContainerRuntime = new LocalDockerRuntime();
    expect(typeof runtime.launch).toBe("function");
    expect(typeof runtime.streamLogs).toBe("function");
    expect(typeof runtime.waitForExit).toBe("function");
    expect(typeof runtime.kill).toBe("function");
    expect(typeof runtime.remove).toBe("function");
    expect(typeof runtime.prepareCredentials).toBe("function");
    expect(typeof runtime.pushImage).toBe("function");
    expect(typeof runtime.buildImage).toBe("function");
    expect(typeof runtime.cleanupCredentials).toBe("function");
    expect(runtime.needsGateway).toBe(true);
  });

  it("pushImage returns the input unchanged for local runtime", async () => {
    const runtime = new LocalDockerRuntime();
    const result = await runtime.pushImage("al-agent:latest");
    expect(result).toBe("al-agent:latest");
  });

  it("prepareCredentials returns volume strategy with staging dir", async () => {
    const runtime = new LocalDockerRuntime();
    const creds = await runtime.prepareCredentials(["github_token:default"]);
    expect(creds.strategy).toBe("volume");
    if (creds.strategy === "volume") {
      expect(creds.stagingDir).toMatch(/al-creds-/);
      expect(creds.bundle.github_token?.default?.token).toBe("fake-value");
      // Cleanup
      runtime.cleanupCredentials(creds);
    }
  });

  it("cleanupCredentials is safe on secrets-manager strategy", () => {
    const runtime = new LocalDockerRuntime();
    // Should not throw
    runtime.cleanupCredentials({ strategy: "secrets-manager", mounts: [] });
  });
});
