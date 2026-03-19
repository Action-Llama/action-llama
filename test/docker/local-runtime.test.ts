import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import type { ContainerRuntime } from "../../src/docker/runtime.js";

// Mock child_process so spawn is controllable
const mockSpawn = vi.fn();
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, spawn: mockSpawn };
});

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

// Import after mocks are set up
const { LocalDockerRuntime, parseBuildKitLine } = await import("../../src/docker/local-runtime.js");

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

describe("parseBuildKitLine", () => {
  it("extracts step from BuildKit output", () => {
    expect(parseBuildKitLine("#5 [1/3] FROM docker.io/library/node:20-alpine"))
      .toBe("Step 1/3: FROM docker.io/library/node:20-alpine");
  });

  it("extracts error from BuildKit output", () => {
    expect(parseBuildKitLine("#8 ERROR process '/bin/sh -c npm install' did not complete"))
      .toBe("Error: process '/bin/sh -c npm install' did not complete");
  });

  it("strips ANSI escape codes", () => {
    expect(parseBuildKitLine("\x1b[1m#5 [2/3] COPY . .\x1b[0m"))
      .toBe("Step 2/3: COPY . .");
  });

  it("returns undefined for blank lines", () => {
    expect(parseBuildKitLine("")).toBeUndefined();
    expect(parseBuildKitLine("   ")).toBeUndefined();
  });

  it("returns undefined for BuildKit progress/transfer lines", () => {
    expect(parseBuildKitLine("#5 sha256:abc123 2.1MB / 5.3MB")).toBeUndefined();
    expect(parseBuildKitLine("#5 DONE 0.3s")).toBeUndefined();
  });

  it("forwards unrecognized non-BuildKit lines (error details)", () => {
    expect(parseBuildKitLine("npm ERR! missing: lodash@^4.0.0"))
      .toBe("npm ERR! missing: lodash@^4.0.0");
    expect(parseBuildKitLine("  ERROR: Could not find module 'foo'"))
      .toBe("ERROR: Could not find module 'foo'");
  });
});

describe("LocalDockerRuntime.buildImage (async)", () => {
  function makeFakeProc() {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    return proc;
  }

  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("parses BuildKit stderr and calls onProgress", async () => {
    const fakeProc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(fakeProc);

    const runtime = new LocalDockerRuntime();
    const messages: string[] = [];

    const buildPromise = runtime.buildImage({
      tag: "test:latest",
      dockerfile: "Dockerfile",
      contextDir: "/tmp/test-ctx",
      dockerfileContent: "FROM node:20\nRUN echo hello",
      onProgress: (msg) => messages.push(msg),
    });

    // Emit BuildKit output on stderr
    fakeProc.stderr.emit("data", Buffer.from(
      "#4 [1/2] FROM docker.io/library/node:20\n" +
      "#5 [2/2] RUN echo hello\n"
    ));
    fakeProc.emit("close", 0);

    await buildPromise;

    expect(messages).toContain("Building image locally");
    expect(messages).toContain("Step 1/2: FROM docker.io/library/node:20");
    expect(messages).toContain("Step 2/2: RUN echo hello");
  });

  it("rejects with stderr on build failure", async () => {
    const fakeProc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(fakeProc);

    const runtime = new LocalDockerRuntime();

    const buildPromise = runtime.buildImage({
      tag: "test:latest",
      dockerfile: "Dockerfile",
      contextDir: "/tmp/test-ctx",
      dockerfileContent: "FROM node:20\nRUN exit 1",
    });

    fakeProc.stderr.emit("data", Buffer.from("error: something broke\n"));
    fakeProc.emit("close", 1);

    await expect(buildPromise).rejects.toThrow("Docker build failed (exit 1)");
    await expect(buildPromise).rejects.toThrow("something broke");
  });

  it("rejects on timeout", async () => {
    vi.useFakeTimers();

    const fakeProc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(fakeProc);

    const runtime = new LocalDockerRuntime();

    const buildPromise = runtime.buildImage({
      tag: "test:latest",
      dockerfile: "Dockerfile",
      contextDir: "/tmp/test-ctx",
      dockerfileContent: "FROM node:20",
    });

    vi.advanceTimersByTime(300_000);

    await expect(buildPromise).rejects.toThrow("Docker build timed out after 300s");
    expect(fakeProc.kill).toHaveBeenCalled();

    vi.useRealTimers();
  });
});
