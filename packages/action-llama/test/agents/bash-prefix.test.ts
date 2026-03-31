import { describe, it, expect, afterEach, vi } from "vitest";
import { ensureBinDir, BASH_COMMAND_PREFIX } from "../../src/agents/bash-prefix.js";

// Controllable mock for existsSync — defaults to the real implementation
const mockExistsSync = vi.fn();
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    existsSync: (...args: any[]) => mockExistsSync(...args),
  };
});

describe("bash-prefix", () => {
  describe("BASH_COMMAND_PREFIX", () => {
    it("exports the expected bash command prefix", () => {
      expect(BASH_COMMAND_PREFIX).toBe(". al-bash-init.sh");
    });
  });

  describe("ensureBinDir", () => {
    const originalPath = process.env.PATH;

    afterEach(() => {
      // Restore original PATH after each test
      process.env.PATH = originalPath;
      mockExistsSync.mockRestore();
    });

    it("adds docker/bin directory to PATH when it exists and is not already present", () => {
      // Use real existsSync (default to true since the dir exists in the repo)
      mockExistsSync.mockImplementation((_path: string) => true);

      // Remove any existing docker/bin from PATH to ensure a clean state
      const pathParts = (process.env.PATH || "").split(":").filter((p) => !p.includes("docker/bin"));
      process.env.PATH = pathParts.join(":");

      ensureBinDir();

      // After calling ensureBinDir, the bin dir should be on PATH
      expect(process.env.PATH).toContain("docker/bin");
    });

    it("is idempotent — does not add docker/bin twice", () => {
      mockExistsSync.mockImplementation((_path: string) => true);

      // Remove from PATH first
      const pathParts = (process.env.PATH || "").split(":").filter((p) => !p.includes("docker/bin"));
      process.env.PATH = pathParts.join(":");

      ensureBinDir();
      const pathAfterFirst = process.env.PATH || "";

      // Call again — should be a no-op
      ensureBinDir();
      const pathAfterSecond = process.env.PATH || "";

      expect(pathAfterFirst).toBe(pathAfterSecond);
    });

    it("does nothing when the docker/bin directory does not exist", () => {
      // Make existsSync return false so ensureBinDir exits early
      mockExistsSync.mockReturnValue(false);

      const pathBefore = process.env.PATH || "";
      ensureBinDir();
      const pathAfter = process.env.PATH || "";

      // PATH should be unchanged when binDir doesn't exist
      expect(pathAfter).toBe(pathBefore);
      expect(mockExistsSync).toHaveBeenCalledOnce();
    });
  });
});
