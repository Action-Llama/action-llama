/**
 * Integration tests: docker/image.ts utility functions — no Docker required.
 *
 * Several functions in docker/image.ts have branches that are testable without
 * a running Docker daemon:
 *
 *   imageExists(image):
 *     - Returns false when Docker is not available (docker image inspect throws)
 *     - Returns false for a non-existent image name
 *     - Default image parameter fallback works (no throw with no args)
 *
 *   ensureProjectBaseImage(projectPath, baseImage):
 *     - Returns baseImage unchanged when no Dockerfile exists at projectPath/Dockerfile
 *     - Returns baseImage unchanged when Dockerfile is empty (0 instructions)
 *     - Returns baseImage unchanged when Dockerfile has only a single FROM line
 *       (isCustomized check: instructions.length <= 1 → no extra build needed)
 *
 *   ensureAgentImage(agentName, projectPath, baseImage):
 *     - Returns baseImage unchanged when no agent-specific Dockerfile exists
 *       at projectPath/agents/agentName/Dockerfile
 *
 * Covers:
 *   - docker/image.ts: imageExists() → catch block returns false (Docker unavailable)
 *   - docker/image.ts: ensureProjectBaseImage() → no Dockerfile → returns baseImage
 *   - docker/image.ts: ensureProjectBaseImage() → empty Dockerfile (0 instructions) → returns baseImage
 *   - docker/image.ts: ensureProjectBaseImage() → single FROM line → returns baseImage (length <= 1)
 *   - docker/image.ts: ensureProjectBaseImage() → comment-only Dockerfile → returns baseImage
 *   - docker/image.ts: ensureAgentImage() → no agent Dockerfile → returns baseImage
 *   - docker/image.ts: ensureAgentImage() → nested agent dir exists but no Dockerfile → returns baseImage
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const {
  imageExists,
  ensureProjectBaseImage,
  ensureAgentImage,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/docker/image.js"
);

const BASE_IMAGE = "al-test-base:fake";

describe(
  "integration: docker/image.ts utility functions (no Docker required)",
  { timeout: 30_000 },
  () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), "al-docker-image-test-"));
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
    });

    // ── imageExists ────────────────────────────────────────────────────��─────

    describe("imageExists()", () => {
      it("returns false for a non-existent image name (Docker unavailable returns false)", () => {
        // When Docker is not available OR image does not exist, imageExists() catches the error
        // and returns false. Both cases should return false here.
        const result = imageExists("definitely-nonexistent-image-abc123:latest");
        expect(result).toBe(false);
      });

      it("returns a boolean (not throws) for any image name", () => {
        const result = imageExists("any-image-name:tag");
        expect(typeof result).toBe("boolean");
      });

      it("works with no arguments (uses default image)", () => {
        // Should not throw — uses CONSTANTS.DEFAULT_IMAGE as default
        let threw = false;
        let result: boolean | undefined;
        try {
          result = imageExists();
        } catch {
          threw = true;
        }
        expect(threw).toBe(false);
        // Result is boolean (true if Docker and image available, false otherwise)
        expect(typeof result).toBe("boolean");
      });

      it("returns false for empty string image name", () => {
        // Docker won't find an image with empty name, should return false
        const result = imageExists("");
        expect(result).toBe(false);
      });
    });

    // ── ensureProjectBaseImage ───────────────────────────────────────────────

    describe("ensureProjectBaseImage()", () => {
      it("returns baseImage unchanged when no Dockerfile exists at project root", () => {
        // No Dockerfile at projectDir/Dockerfile → early return baseImage
        const result = ensureProjectBaseImage(projectDir, BASE_IMAGE);
        expect(result).toBe(BASE_IMAGE);
      });

      it("returns baseImage when Dockerfile exists but is empty (0 instructions)", () => {
        // Empty Dockerfile → instructions.length === 0 → <= 1 → returns baseImage
        writeFileSync(join(projectDir, "Dockerfile"), "");
        const result = ensureProjectBaseImage(projectDir, BASE_IMAGE);
        expect(result).toBe(BASE_IMAGE);
      });

      it("returns baseImage when Dockerfile has only a FROM line (instructions.length === 1)", () => {
        // Single FROM line is treated as unmodified → returns baseImage unchanged
        writeFileSync(join(projectDir, "Dockerfile"), "FROM node:20-alpine\n");
        const result = ensureProjectBaseImage(projectDir, BASE_IMAGE);
        expect(result).toBe(BASE_IMAGE);
      });

      it("returns baseImage when Dockerfile has only comments (0 effective instructions)", () => {
        // Comments are stripped out → 0 effective instructions → returns baseImage
        writeFileSync(
          join(projectDir, "Dockerfile"),
          "# This is a comment\n# Another comment\n",
        );
        const result = ensureProjectBaseImage(projectDir, BASE_IMAGE);
        expect(result).toBe(BASE_IMAGE);
      });

      it("returns baseImage when Dockerfile has FROM + blank lines but only 1 instruction", () => {
        // Blank lines are filtered → only FROM remains → length === 1 → returns baseImage
        writeFileSync(
          join(projectDir, "Dockerfile"),
          "\n\nFROM node:20-alpine\n\n",
        );
        const result = ensureProjectBaseImage(projectDir, BASE_IMAGE);
        expect(result).toBe(BASE_IMAGE);
      });
    });

    // ── ensureAgentImage ─────────────────────────────────────────────────────

    describe("ensureAgentImage()", () => {
      it("returns baseImage unchanged when no agent Dockerfile exists", () => {
        // No agents/myagent/Dockerfile → returns baseImage immediately
        mkdirSync(join(projectDir, "agents", "myagent"), { recursive: true });
        const result = ensureAgentImage("myagent", projectDir, BASE_IMAGE);
        expect(result).toBe(BASE_IMAGE);
      });

      it("returns baseImage when agent directory does not exist at all", () => {
        // No agents/ directory at all → no Dockerfile → returns baseImage
        const result = ensureAgentImage("nonexistent-agent", projectDir, BASE_IMAGE);
        expect(result).toBe(BASE_IMAGE);
      });

      it("returns baseImage for different agent names (no Dockerfile in any)", () => {
        mkdirSync(join(projectDir, "agents", "agent-a"), { recursive: true });
        mkdirSync(join(projectDir, "agents", "agent-b"), { recursive: true });

        expect(ensureAgentImage("agent-a", projectDir, BASE_IMAGE)).toBe(BASE_IMAGE);
        expect(ensureAgentImage("agent-b", projectDir, BASE_IMAGE)).toBe(BASE_IMAGE);
      });

      it("returns the passed baseImage string exactly (no modification)", () => {
        const customBase = "my-custom-image:v1.2.3";
        const result = ensureAgentImage("no-dockerfile-agent", projectDir, customBase);
        expect(result).toBe(customBase);
      });
    });
  },
);
