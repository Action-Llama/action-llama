import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process execFileSync (used by docker() helper)
const { mockExecFileSync } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, execFileSync: mockExecFileSync };
});

// Mock fs so existsSync and readFileSync are controllable
// Only intercept calls for Dockerfiles (not package.json reads done by constants.ts)
const { mockExistsSync, mockReadFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: (...args: any[]) => {
      const path = args[0] as string;
      if (typeof path === "string" && path.includes("Dockerfile")) {
        return mockExistsSync(...args);
      }
      return actual.existsSync(...args);
    },
    readFileSync: (...args: any[]) => {
      const path = args[0] as string;
      if (typeof path === "string" && path.includes("Dockerfile")) {
        return mockReadFileSync(...args);
      }
      return actual.readFileSync(...args);
    },
  };
});

// Import after mocks
const { imageExists, buildImage, ensureImage, ensureProjectBaseImage, ensureAgentImage } =
  await import("../../src/docker/image.js");

describe("docker image helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecFileSync.mockReturnValue("");
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue("");
  });

  describe("imageExists", () => {
    it("returns true when docker image inspect succeeds", () => {
      mockExecFileSync.mockReturnValue("image info");

      expect(imageExists("al-agent:abc123")).toBe(true);
    });

    it("returns false when docker image inspect throws", () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error("No such image");
      });

      expect(imageExists("al-agent:nonexistent")).toBe(false);
    });

    it("calls docker image inspect with the correct image name", () => {
      mockExecFileSync.mockReturnValue("");

      imageExists("custom-image:tag");

      expect(mockExecFileSync).toHaveBeenCalledWith(
        "docker",
        expect.arrayContaining(["image", "inspect", "custom-image:tag"]),
        expect.any(Object)
      );
    });

    it("uses DEFAULT_IMAGE when no argument provided", () => {
      mockExecFileSync.mockReturnValue("info");

      const result = imageExists();

      expect(result).toBe(true);
      // Should call docker image inspect with some image (the default)
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "docker",
        expect.arrayContaining(["image", "inspect"]),
        expect.any(Object)
      );
    });
  });

  describe("buildImage", () => {
    it("calls docker build with correct arguments", () => {
      buildImage("al-agent:abc123");

      expect(mockExecFileSync).toHaveBeenCalledWith(
        "docker",
        expect.arrayContaining(["build", "-t", "al-agent:abc123", "-f", "docker/Dockerfile"]),
        expect.any(Object)
      );
    });

    it("passes GIT_SHA and VERSION build args", () => {
      buildImage("al-agent:sha123");

      const call = mockExecFileSync.mock.calls[0];
      const args: string[] = call[1];
      expect(args).toContain("--build-arg");
      // Should have GIT_SHA and VERSION build args
      const buildArgValues = args
        .map((a: string, i: number) => args[i - 1] === "--build-arg" ? a : null)
        .filter(Boolean);
      expect(buildArgValues.some((v: string | null) => v?.startsWith("GIT_SHA="))).toBe(true);
      expect(buildArgValues.some((v: string | null) => v?.startsWith("VERSION="))).toBe(true);
    });

    it("tags aliases after building the primary image (using default image)", () => {
      // Use default image so name matches the primary tag (includes actual GIT_SHA)
      buildImage();

      // First call is the build, subsequent calls are tags
      const tagCalls = mockExecFileSync.mock.calls.filter(
        (c: any[]) => c[1][0] === "tag"
      );
      // Should have at least 1 tag call (for version and latest aliases)
      expect(tagCalls.length).toBeGreaterThan(0);
    });

    it("uses DEFAULT_IMAGE when no argument provided", () => {
      buildImage();

      expect(mockExecFileSync).toHaveBeenCalledWith(
        "docker",
        expect.arrayContaining(["build"]),
        expect.any(Object)
      );
    });
  });

  describe("ensureImage", () => {
    it("does not build if image already exists", () => {
      mockExecFileSync.mockReturnValue("image info"); // image inspect succeeds

      ensureImage("al-agent:abc123");

      // Only the inspect call, no build call
      const buildCalls = mockExecFileSync.mock.calls.filter(
        (c: any[]) => c[1][0] === "build"
      );
      expect(buildCalls).toHaveLength(0);
    });

    it("builds image when it does not exist", () => {
      mockExecFileSync
        .mockImplementationOnce(() => { throw new Error("No such image"); }) // inspect fails
        .mockReturnValue(""); // build and tag succeed

      ensureImage("al-agent:abc123");

      const buildCalls = mockExecFileSync.mock.calls.filter(
        (c: any[]) => c[1][0] === "build"
      );
      expect(buildCalls).toHaveLength(1);
    });

    it("uses DEFAULT_IMAGE when no argument provided", () => {
      mockExecFileSync.mockReturnValue("image info");

      ensureImage();

      expect(mockExecFileSync).toHaveBeenCalledWith(
        "docker",
        expect.arrayContaining(["image", "inspect"]),
        expect.any(Object)
      );
    });
  });

  describe("ensureProjectBaseImage", () => {
    it("returns baseImage when no project Dockerfile exists", () => {
      mockExistsSync.mockReturnValue(false);

      const result = ensureProjectBaseImage("/project", "al-agent:sha");

      expect(result).toBe("al-agent:sha");
      expect(mockExecFileSync).not.toHaveBeenCalled();
    });

    it("returns baseImage when project Dockerfile is empty", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("");

      const result = ensureProjectBaseImage("/project", "al-agent:sha");

      expect(result).toBe("al-agent:sha");
      expect(mockExecFileSync).not.toHaveBeenCalled();
    });

    it("returns baseImage when project Dockerfile has only a single FROM line", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("FROM al-agent:sha\n");

      const result = ensureProjectBaseImage("/project", "al-agent:sha");

      expect(result).toBe("al-agent:sha");
      expect(mockExecFileSync).not.toHaveBeenCalled();
    });

    it("returns baseImage when Dockerfile has only comments", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("# This is a comment\n# Another comment\n");

      const result = ensureProjectBaseImage("/project", "al-agent:sha");

      expect(result).toBe("al-agent:sha");
      expect(mockExecFileSync).not.toHaveBeenCalled();
    });

    it("builds project base image when Dockerfile has multiple instructions", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("FROM al-agent:sha\nRUN apt-get update\nRUN apt-get install -y git\n");

      const result = ensureProjectBaseImage("/project", "al-agent:sha");

      // Should return the project base image, not the original
      expect(result).not.toBe("al-agent:sha");
      expect(result).toContain("al-project-base");

      const buildCalls = mockExecFileSync.mock.calls.filter(
        (c: any[]) => c[1][0] === "build"
      );
      expect(buildCalls).toHaveLength(1);
    });

    it("tags aliases for the project base image", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("FROM base\nRUN echo extra\n");

      ensureProjectBaseImage("/project", "al-agent:sha");

      const tagCalls = mockExecFileSync.mock.calls.filter(
        (c: any[]) => c[1][0] === "tag"
      );
      expect(tagCalls.length).toBeGreaterThan(0);
    });

    it("uses DEFAULT_IMAGE when no baseImage provided", () => {
      mockExistsSync.mockReturnValue(false);

      const result = ensureProjectBaseImage("/project");

      // Should return DEFAULT_IMAGE
      expect(result).toContain("al-agent");
    });
  });

  describe("ensureAgentImage", () => {
    it("returns baseImage when no agent-specific Dockerfile exists", () => {
      mockExistsSync.mockReturnValue(false);

      const result = ensureAgentImage("myagent", "/project", "al-agent:sha");

      expect(result).toBe("al-agent:sha");
      expect(mockExecFileSync).not.toHaveBeenCalled();
    });

    it("builds agent image when agent Dockerfile exists", () => {
      mockExistsSync.mockReturnValue(true);

      const result = ensureAgentImage("myagent", "/project", "al-agent:sha");

      expect(result).toContain("al-myagent");

      const buildCalls = mockExecFileSync.mock.calls.filter(
        (c: any[]) => c[1][0] === "build"
      );
      expect(buildCalls).toHaveLength(1);
    });

    it("passes correct Dockerfile path when building agent image", () => {
      mockExistsSync.mockReturnValue(true);

      ensureAgentImage("myagent", "/project", "al-agent:sha");

      const buildCall = mockExecFileSync.mock.calls.find(
        (c: any[]) => c[1][0] === "build"
      );
      expect(buildCall).toBeDefined();
      expect(buildCall[1]).toContain("-f");
      const dfIndex = buildCall[1].indexOf("-f");
      expect(buildCall[1][dfIndex + 1]).toContain("myagent");
      expect(buildCall[1][dfIndex + 1]).toContain("Dockerfile");
    });

    it("tags aliases for agent image", () => {
      mockExistsSync.mockReturnValue(true);

      ensureAgentImage("myagent", "/project", "al-agent:sha");

      const tagCalls = mockExecFileSync.mock.calls.filter(
        (c: any[]) => c[1][0] === "tag"
      );
      expect(tagCalls.length).toBeGreaterThan(0);
    });

    it("uses DEFAULT_IMAGE as baseImage when not provided", () => {
      mockExistsSync.mockReturnValue(false);

      const result = ensureAgentImage("myagent", "/project");

      expect(result).toContain("al-agent");
    });

    it("returns the agent image tag for correct agent name", () => {
      mockExistsSync.mockReturnValue(true);

      const result = ensureAgentImage("agent-alpha", "/project", "al-agent:sha");

      expect(result).toContain("agent-alpha");
    });
  });
});
