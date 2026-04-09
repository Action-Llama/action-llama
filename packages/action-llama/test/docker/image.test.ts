import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────

const mockExecFileSync = vi.fn();
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    execFileSync: (...args: any[]) => mockExecFileSync(...args),
    spawn: vi.fn(),
  };
});

const mockExistsSync = vi.fn(() => false);
const mockReadFileSync = vi.fn(() => "");
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: (...args: any[]) => mockExistsSync(...args),
    readFileSync: (...args: any[]) => mockReadFileSync(...args),
    mkdtempSync: vi.fn(() => "/tmp/al-ctx-test"),
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

vi.mock("../../src/shared/constants.js", () => ({
  CONSTANTS: {
    PROJECT_BASE_IMAGE: "al-project-base:test123",
    agentImage: (name: string) => `al-${name}:test123`,
  },
}));

const mockBuildImage = vi.fn(async () => "built-image:tag");
vi.mock("../../src/docker/local-runtime.js", () => {
  return {
    LocalDockerRuntime: class {
      buildImage = mockBuildImage;
    },
  };
});

// Import after mocks
const { imageExists, isProjectDockerfileCustomized, ensureProjectBaseImage, ensureAgentImage } =
  await import("../../src/docker/image.js");

// ── Tests ──────────────────────────────────────────────────────

describe("docker/image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("imageExists()", () => {
    it("returns true when docker image inspect succeeds", () => {
      mockExecFileSync.mockReturnValue("");
      expect(imageExists("my-image:latest")).toBe(true);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "docker",
        ["image", "inspect", "my-image:latest"],
        expect.any(Object),
      );
    });

    it("returns false when docker image inspect fails", () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error("No such image");
      });
      expect(imageExists("missing:latest")).toBe(false);
    });
  });

  describe("isProjectDockerfileCustomized()", () => {
    it("returns false for a bare FROM line", () => {
      expect(isProjectDockerfileCustomized("FROM node:20-alpine")).toBe(false);
    });

    it("returns false for FROM with comments only", () => {
      expect(isProjectDockerfileCustomized("# comment\nFROM node:20-alpine\n# another comment")).toBe(false);
    });

    it("returns true when RUN instruction is present", () => {
      expect(isProjectDockerfileCustomized("FROM node:20-alpine\nRUN apk add --no-cache git")).toBe(true);
    });

    it("returns true when COPY instruction is present", () => {
      expect(isProjectDockerfileCustomized("FROM node:20-alpine\nCOPY . /app")).toBe(true);
    });

    it("returns false for empty content", () => {
      expect(isProjectDockerfileCustomized("")).toBe(false);
    });
  });

  describe("ensureProjectBaseImage()", () => {
    it("returns baseImage when no Dockerfile exists", async () => {
      mockExistsSync.mockReturnValue(false);
      const result = await ensureProjectBaseImage("/project", "node:20-alpine");
      expect(result).toBe("node:20-alpine");
      expect(mockBuildImage).not.toHaveBeenCalled();
    });

    it("returns baseImage when Dockerfile has only FROM", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("FROM node:20-alpine\n");
      const result = await ensureProjectBaseImage("/project", "node:20-alpine");
      expect(result).toBe("node:20-alpine");
      expect(mockBuildImage).not.toHaveBeenCalled();
    });

    it("builds and returns project base image when Dockerfile is customized", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("FROM node:20-alpine\nRUN apk add --no-cache git");
      // imageExists returns false (image not yet built)
      mockExecFileSync.mockImplementation(() => { throw new Error("not found"); });

      const result = await ensureProjectBaseImage("/project", "node:20-alpine");

      expect(mockBuildImage).toHaveBeenCalledWith(
        expect.objectContaining({
          dockerfile: "Dockerfile",
          contextDir: "/project",
          baseImage: "node:20-alpine",
        }),
      );
      expect(result).toMatch(/^al-project-base:/);
    });

    it("skips build when image already exists", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("FROM node:20-alpine\nRUN apk add --no-cache git");
      // imageExists returns true
      mockExecFileSync.mockReturnValue("");

      const result = await ensureProjectBaseImage("/project", "node:20-alpine");

      expect(mockBuildImage).not.toHaveBeenCalled();
      expect(result).toMatch(/^al-project-base:/);
    });
  });

  describe("ensureAgentImage()", () => {
    it("returns baseImage when no agent Dockerfile exists", async () => {
      mockExistsSync.mockReturnValue(false);
      const result = await ensureAgentImage("planner", "/project", "node:20-alpine");
      expect(result).toBe("node:20-alpine");
      expect(mockBuildImage).not.toHaveBeenCalled();
    });

    it("builds and returns agent image when Dockerfile exists", async () => {
      mockExistsSync.mockReturnValue(true);
      // imageExists returns false
      mockExecFileSync.mockImplementation(() => { throw new Error("not found"); });

      const result = await ensureAgentImage("planner", "/project", "al-project-base:abc");

      expect(mockBuildImage).toHaveBeenCalledWith(
        expect.objectContaining({
          dockerfile: "Dockerfile",
          contextDir: "/project/agents/planner",
          baseImage: "al-project-base:abc",
        }),
      );
      expect(result).toMatch(/^al-planner:/);
    });

    it("skips build when agent image already exists", async () => {
      mockExistsSync.mockReturnValue(true);
      // imageExists returns true
      mockExecFileSync.mockReturnValue("");

      const result = await ensureAgentImage("planner", "/project", "al-project-base:abc");

      expect(mockBuildImage).not.toHaveBeenCalled();
      expect(result).toMatch(/^al-planner:/);
    });
  });
});
