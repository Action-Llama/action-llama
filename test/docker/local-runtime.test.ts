import { describe, it, expect } from "vitest";
import { LocalDockerRuntime } from "../../src/docker/local-runtime.js";
import type { ContainerRuntime } from "../../src/docker/runtime.js";

describe("LocalDockerRuntime", () => {
  it("implements ContainerRuntime interface", () => {
    const runtime: ContainerRuntime = new LocalDockerRuntime();
    expect(typeof runtime.launch).toBe("function");
    expect(typeof runtime.streamLogs).toBe("function");
    expect(typeof runtime.waitForExit).toBe("function");
    expect(typeof runtime.kill).toBe("function");
    expect(typeof runtime.remove).toBe("function");
  });
});
