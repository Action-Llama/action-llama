/**
 * Tests for scaffold.ts — covers npm init failure catch block
 * and the `|| projectName || "al-project"` fallback branches.
 * Uses vi.mock("child_process") at module level.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

// Mock child_process.execSync to throw — simulates npm not being available
vi.mock("child_process", () => ({
  execSync: vi.fn(() => {
    throw new Error("npm not available in this environment");
  }),
  spawn: vi.fn(),
}));

// Import scaffold AFTER the mock so it picks up the mocked execSync
import { scaffoldProject } from "../../src/setup/scaffold.js";

describe("scaffoldProject — npm init failure catch block", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("falls back to 'al-project' when npm init fails and no projectName is provided", () => {
    // Covers the `catch {}` block in scaffoldProject and the
    // `|| projectName || "al-project"` FALSE final fallback branch on line 77.
    // Also covers `|| "1.0.0"` on line 78 (basePkg.version is undefined when npm init fails).
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-npm-fail-"));
    const projDir = resolve(tmpDir, "fallback-project");

    scaffoldProject(projDir, {});

    const pkgPath = resolve(projDir, "package.json");
    expect(existsSync(pkgPath)).toBe(true);
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    // name falls back to "al-project" (basePkg.name=undefined, projectName=undefined)
    expect(pkg.name).toBe("al-project");
    // version falls back to "1.0.0" (basePkg.version=undefined)
    expect(pkg.version).toBe("1.0.0");
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe("module");
  });

  it("falls back to projectName when npm init fails and projectName is provided", () => {
    // Covers the `|| projectName` branch (second fallback on line 77).
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-npm-fail-"));
    const projDir = resolve(tmpDir, "named-project");

    scaffoldProject(projDir, {}, [], "my-named-project");

    const pkgPath = resolve(projDir, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    // name falls back to projectName="my-named-project" (basePkg.name=undefined)
    expect(pkg.name).toBe("my-named-project");
    expect(pkg.version).toBe("1.0.0");
  });
});
