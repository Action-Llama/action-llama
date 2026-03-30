import { describe, it, expect, afterEach } from "vitest";
import { ensureBinDir, BASH_COMMAND_PREFIX } from "../../src/agents/bash-prefix.js";

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
    });

    it("adds docker/bin directory to PATH when it exists and is not already present", () => {
      // Remove any existing docker/bin from PATH to ensure a clean state
      const pathParts = (process.env.PATH || "").split(":").filter((p) => !p.includes("docker/bin"));
      process.env.PATH = pathParts.join(":");

      ensureBinDir();

      // After calling ensureBinDir, the bin dir should be on PATH
      expect(process.env.PATH).toContain("docker/bin");
    });

    it("is idempotent — does not add docker/bin twice", () => {
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
  });
});
