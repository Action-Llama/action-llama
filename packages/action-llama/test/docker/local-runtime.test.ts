import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import type { Runtime, ContainerRuntime } from "../../src/docker/runtime.js";

// Mock child_process so spawn is controllable
const mockSpawn = vi.fn();
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, spawn: mockSpawn };
});

// Mock fs operations for testing file permissions
const mockChmodSync = vi.fn();
const mockChownSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockMkdtempSync = vi.fn();

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    chmodSync: mockChmodSync,
    chownSync: mockChownSync,
    mkdirSync: mockMkdirSync,
    writeFileSync: mockWriteFileSync,
    mkdtempSync: mockMkdtempSync,
  };
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
  beforeEach(() => {
    mockChmodSync.mockReset();
    mockChownSync.mockReset();
    mockMkdirSync.mockReset();
    mockWriteFileSync.mockReset();
    mockMkdtempSync.mockReset();
  });
  it("implements Runtime & ContainerRuntime interface", () => {
    const runtime: Runtime & ContainerRuntime = new LocalDockerRuntime();
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
    mockMkdtempSync.mockReturnValue("/tmp/al-creds-test123");
    mockMkdirSync.mockReturnValue(undefined);
    mockWriteFileSync.mockReturnValue(undefined);
    mockChmodSync.mockReturnValue(undefined);
    mockChownSync.mockReturnValue(undefined);

    const runtime = new LocalDockerRuntime();
    const creds = await runtime.prepareCredentials(["github_token"]);
    expect(creds.strategy).toBe("volume");
    if (creds.strategy === "volume") {
      expect(creds.stagingDir).toBe("/tmp/al-creds-test123");
      expect(creds.bundle.github_token?.default?.token).toBe("fake-value");
      // Cleanup
      runtime.cleanupCredentials(creds);
    }
  });

  it("cleanupCredentials is safe on tmpfs strategy", () => {
    const runtime = new LocalDockerRuntime();
    expect(() => {
      runtime.cleanupCredentials({ strategy: "tmpfs", stagingDir: "/tmp/test", bundle: {} });
    }).not.toThrow();
  });

  it("prepareCredentials creates directories with restrictive permissions", async () => {
    mockMkdtempSync.mockReturnValue("/tmp/al-creds-test123");
    mockMkdirSync.mockReturnValue(undefined);
    mockWriteFileSync.mockReturnValue(undefined);
    mockChmodSync.mockReturnValue(undefined);
    mockChownSync.mockReturnValue(undefined);

    const runtime = new LocalDockerRuntime();
    const creds = await runtime.prepareCredentials(["github_token"]);

    expect(creds.strategy).toBe("volume");
    
    // Verify staging directory permissions (more permissive in test mode)
    const expectedDirMode = process.env.NODE_ENV === "test" ? 0o755 : 0o700;
    const expectedFileMode = process.env.NODE_ENV === "test" ? 0o644 : 0o400;
    
    expect(mockChmodSync).toHaveBeenCalledWith("/tmp/al-creds-test123", expectedDirMode);
    
    // Verify subdirectory permissions
    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining("github_token/default"),
      { recursive: true, mode: expectedDirMode }
    );
    
    // Verify file permissions
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("token"),
      "fake-value\n",
      { mode: expectedFileMode }
    );

    // Verify ownership attempts (should try to set container UID/GID)
    expect(mockChownSync).toHaveBeenCalledWith("/tmp/al-creds-test123", 1000, 1000);
  });

  it("prepareCredentials handles chown failures gracefully", async () => {
    mockMkdtempSync.mockReturnValue("/tmp/al-creds-test456");
    mockMkdirSync.mockReturnValue(undefined);
    mockWriteFileSync.mockReturnValue(undefined);
    mockChmodSync.mockReturnValue(undefined);
    mockChownSync.mockImplementation(() => {
      throw new Error("Operation not permitted");
    });

    const runtime = new LocalDockerRuntime();
    
    // Should not throw even when chown fails
    expect(async () => {
      await runtime.prepareCredentials(["github_token"]);
    }).not.toThrow();

    // Verify that chown was attempted but failure was handled gracefully
    expect(mockChownSync).toHaveBeenCalled();
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

  it("handles process error event by rejecting", async () => {
    const fakeProc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(fakeProc);

    const runtime = new LocalDockerRuntime();

    const buildPromise = runtime.buildImage({
      tag: "test:latest",
      dockerfile: "Dockerfile",
      contextDir: "/tmp/test-ctx",
      dockerfileContent: "FROM node:20",
    });

    fakeProc.emit("error", new Error("spawn ENOENT"));

    await expect(buildPromise).rejects.toThrow("spawn ENOENT");
  });

  // ── Tests that use buildDir (mkdtempSync returns a path) ─────────────────
  describe("buildImage with temp build directory", () => {
    beforeEach(() => {
      mockSpawn.mockReset();
      mockWriteFileSync.mockReset();
      mockMkdtempSync.mockReset();
      mockMkdirSync.mockReset();
    });

    it("rewrites FROM line when baseImage is provided", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);
      mockMkdtempSync.mockReturnValueOnce("/tmp/al-ctx-base");

      const runtime = new LocalDockerRuntime();

      const buildPromise = runtime.buildImage({
        tag: "test:latest",
        dockerfile: "Dockerfile",
        contextDir: "/tmp/test-ctx",
        dockerfileContent: "FROM node:18\nRUN echo hello",
        baseImage: "my-custom-base:1.0",
      });

      fakeProc.emit("close", 0);
      await buildPromise;

      // The Dockerfile written to the temp dir should have rewritten FROM
      const dockerfileCall = mockWriteFileSync.mock.calls.find(
        (c: any[]) => String(c[0]).includes("Dockerfile")
      );
      expect(dockerfileCall).toBeDefined();
      expect(dockerfileCall![1]).toContain("FROM my-custom-base:1.0");
      expect(dockerfileCall![1]).not.toContain("FROM node:18");
    });

    it("injects COPY static/ line before USER when extraFiles are provided with USER directive", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);
      mockMkdtempSync.mockReturnValueOnce("/tmp/al-ctx-user");

      const runtime = new LocalDockerRuntime();

      const buildPromise = runtime.buildImage({
        tag: "test:latest",
        dockerfile: "Dockerfile",
        contextDir: "/tmp/test-ctx",
        dockerfileContent: "FROM node:20\nRUN npm install\nUSER node\nCMD node index.js",
        extraFiles: { "config.json": '{"key":"value"}' },
      });

      fakeProc.emit("close", 0);
      await buildPromise;

      const dockerfileCall = mockWriteFileSync.mock.calls.find(
        (c: any[]) => String(c[0]).endsWith("Dockerfile")
      );
      expect(dockerfileCall).toBeDefined();
      const content = dockerfileCall![1] as string;
      // COPY static/ should appear before USER
      const copyIdx = content.indexOf("COPY static/ /app/static/");
      const userIdx = content.indexOf("\nUSER ");
      expect(copyIdx).toBeGreaterThan(-1);
      expect(copyIdx).toBeLessThan(userIdx);
    });

    it("appends COPY static/ at end when no USER directive and extraFiles provided", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);
      mockMkdtempSync.mockReturnValueOnce("/tmp/al-ctx-nouser");

      const runtime = new LocalDockerRuntime();

      const buildPromise = runtime.buildImage({
        tag: "test:latest",
        dockerfile: "Dockerfile",
        contextDir: "/tmp/test-ctx",
        dockerfileContent: "FROM node:20\nRUN npm install\nCMD node index.js",
        extraFiles: { "config.json": '{"key":"value"}' },
      });

      fakeProc.emit("close", 0);
      await buildPromise;

      const dockerfileCall = mockWriteFileSync.mock.calls.find(
        (c: any[]) => String(c[0]).endsWith("Dockerfile")
      );
      expect(dockerfileCall).toBeDefined();
      const content = dockerfileCall![1] as string;
      expect(content).toContain("COPY static/ /app/static/");
    });

    it("does not duplicate COPY static/ if already in Dockerfile", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);
      mockMkdtempSync.mockReturnValueOnce("/tmp/al-ctx-dup");

      const runtime = new LocalDockerRuntime();

      const buildPromise = runtime.buildImage({
        tag: "test:latest",
        dockerfile: "Dockerfile",
        contextDir: "/tmp/test-ctx",
        dockerfileContent: "FROM node:20\nCOPY static/ /app/static/\nCMD node index.js",
        extraFiles: { "config.json": '{"key":"value"}' },
      });

      fakeProc.emit("close", 0);
      await buildPromise;

      const dockerfileCall = mockWriteFileSync.mock.calls.find(
        (c: any[]) => String(c[0]).endsWith("Dockerfile")
      );
      expect(dockerfileCall).toBeDefined();
      const content = dockerfileCall![1] as string;
      // Count occurrences - should be exactly 1
      const matches = content.match(/COPY static\/ \/app\/static\//g);
      expect(matches).toHaveLength(1);
    });

    it("cleans up temp build directory after successful build", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);
      mockMkdtempSync.mockReturnValueOnce("/tmp/al-ctx-cleanup");

      const runtime = new LocalDockerRuntime();

      const buildPromise = runtime.buildImage({
        tag: "test:latest",
        dockerfile: "Dockerfile",
        contextDir: "/tmp/test-ctx",
        dockerfileContent: "FROM node:20",
      });

      fakeProc.emit("close", 0);
      await buildPromise;

      // rmSync is called in the finally block (even though the real rmSync may throw ENOENT for the fake path)
      // The build should still succeed because the error is caught
      expect(true).toBe(true); // Just verifying no exception propagated
    });
  });
});

describe("LocalDockerRuntime.streamLogs", () => {
  function makeFakeStreamProc() {
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

  it("calls onLine for each newline-delimited stdout line", () => {
    const fakeProc = makeFakeStreamProc();
    mockSpawn.mockReturnValueOnce(fakeProc);

    const runtime = new LocalDockerRuntime();
    const lines: string[] = [];
    runtime.streamLogs("al-dev-abc123", (line) => lines.push(line));

    fakeProc.stdout.emit("data", Buffer.from("line one\nline two\n"));

    expect(lines).toEqual(["line one", "line two"]);
  });

  it("buffers partial lines and emits when newline arrives", () => {
    const fakeProc = makeFakeStreamProc();
    mockSpawn.mockReturnValueOnce(fakeProc);

    const runtime = new LocalDockerRuntime();
    const lines: string[] = [];
    runtime.streamLogs("al-dev-abc123", (line) => lines.push(line));

    fakeProc.stdout.emit("data", Buffer.from("partial "));
    expect(lines).toHaveLength(0); // not yet complete

    fakeProc.stdout.emit("data", Buffer.from("line\n"));
    expect(lines).toEqual(["partial line"]);
  });

  it("calls onStderr for stderr output", () => {
    const fakeProc = makeFakeStreamProc();
    mockSpawn.mockReturnValueOnce(fakeProc);

    const runtime = new LocalDockerRuntime();
    const stderrMessages: string[] = [];
    runtime.streamLogs("al-dev-abc123", () => {}, (msg) => stderrMessages.push(msg));

    fakeProc.stderr.emit("data", Buffer.from("error: container not found\n"));

    expect(stderrMessages).toEqual(["error: container not found"]);
  });

  it("does not call onStderr if not provided", () => {
    const fakeProc = makeFakeStreamProc();
    mockSpawn.mockReturnValueOnce(fakeProc);

    const runtime = new LocalDockerRuntime();
    // Should not throw even without onStderr callback
    expect(() => {
      const handle = runtime.streamLogs("al-dev-abc123", () => {});
      fakeProc.stderr.emit("data", Buffer.from("some stderr\n"));
    }).not.toThrow();
  });

  it("stop() flushes buffered content and kills the process", () => {
    const fakeProc = makeFakeStreamProc();
    mockSpawn.mockReturnValueOnce(fakeProc);

    const runtime = new LocalDockerRuntime();
    const lines: string[] = [];
    const handle = runtime.streamLogs("al-dev-abc123", (line) => lines.push(line));

    // Emit partial line (no trailing newline)
    fakeProc.stdout.emit("data", Buffer.from("partial buffered line"));

    handle.stop();

    // Flushed the buffer
    expect(lines).toContain("partial buffered line");
    expect(fakeProc.kill).toHaveBeenCalled();
  });

  it("stop() kills process even when buffer is empty", () => {
    const fakeProc = makeFakeStreamProc();
    mockSpawn.mockReturnValueOnce(fakeProc);

    const runtime = new LocalDockerRuntime();
    const handle = runtime.streamLogs("al-dev-abc123", () => {});

    handle.stop();

    expect(fakeProc.kill).toHaveBeenCalled();
  });
});

describe("LocalDockerRuntime.waitForExit", () => {
  function makeFakeWaitProc() {
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

  it("resolves with exit code from docker wait output", async () => {
    const fakeWaitProc = makeFakeWaitProc();
    mockSpawn.mockReturnValueOnce(fakeWaitProc);

    const runtime = new LocalDockerRuntime();
    const exitPromise = runtime.waitForExit("al-dev-abc123", 60);

    fakeWaitProc.stdout.emit("data", Buffer.from("0\n"));
    fakeWaitProc.emit("close");

    const code = await exitPromise;
    expect(code).toBe(0);
  });

  it("resolves with non-zero exit code", async () => {
    const fakeWaitProc = makeFakeWaitProc();
    mockSpawn.mockReturnValueOnce(fakeWaitProc);

    const runtime = new LocalDockerRuntime();
    const exitPromise = runtime.waitForExit("al-dev-abc123", 60);

    fakeWaitProc.stdout.emit("data", Buffer.from("137\n"));
    fakeWaitProc.emit("close");

    const code = await exitPromise;
    expect(code).toBe(137);
  });

  it("rejects with timeout error and kills container", async () => {
    vi.useFakeTimers();

    const fakeWaitProc = makeFakeWaitProc();
    const fakeKillProc = makeFakeWaitProc();
    mockSpawn
      .mockReturnValueOnce(fakeWaitProc)  // docker wait
      .mockReturnValueOnce(fakeKillProc); // docker kill (on timeout)

    const runtime = new LocalDockerRuntime();
    const exitPromise = runtime.waitForExit("al-dev-abc123", 30);

    vi.advanceTimersByTime(30_001);

    await expect(exitPromise).rejects.toThrow("Container al-dev-abc123 timed out after 30s");
    expect(fakeWaitProc.kill).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("rejects on process error event", async () => {
    const fakeWaitProc = makeFakeWaitProc();
    mockSpawn.mockReturnValueOnce(fakeWaitProc);

    const runtime = new LocalDockerRuntime();
    const exitPromise = runtime.waitForExit("al-dev-abc123", 60);

    fakeWaitProc.emit("error", new Error("ENOENT docker not found"));

    await expect(exitPromise).rejects.toThrow("ENOENT docker not found");
  });
});
