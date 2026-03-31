/**
 * Tests for scaffoldProject's symlink-to-copyFile fallback path.
 * Uses vi.mock('fs') to simulate platforms that don't support symlinks.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import type { ScaffoldAgent } from "../../src/setup/scaffold.js";
import type { GlobalConfig } from "../../src/shared/config.js";

// Track calls to specific fs functions
const mockSymlinkSync = vi.fn().mockImplementation(() => {
  throw new Error("EPERM: operation not permitted, symlink");
});
const mockCopyFileSync = vi.fn();

// Mock fs to intercept symlinkSync and copyFileSync, pass through everything else
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    symlinkSync: (...args: any[]) => mockSymlinkSync(...args),
    copyFileSync: (...args: any[]) => {
      mockCopyFileSync(...args);
      // Call the real copyFileSync for actual file copying to work
      return actual.copyFileSync(...args);
    },
  };
});

// Import scaffoldProject AFTER the mock is set up
import { scaffoldProject } from "../../src/setup/scaffold.js";

describe("scaffoldProject — symlink fallback to copyFileSync", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    mockSymlinkSync.mockClear();
    mockCopyFileSync.mockClear();
  });

  function makeGlobalConfig(): GlobalConfig {
    return {
      models: {
        sonnet: {
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          authType: "api_key",
        },
      },
    } as any;
  }

  function makeAgents(): ScaffoldAgent[] {
    return [
      {
        name: "dev",
        config: {
          name: "dev",
          credentials: [],
          models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
        } as any,
      },
    ];
  }

  it("falls back to copyFileSync for AGENTS.md and CLAUDE.md when symlinkSync throws", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-symlink-fallback-"));
    const projDir = resolve(tmpDir, "my-project");

    // symlinkSync is mocked to throw — triggers the copyFileSync fallback path
    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    // symlinkSync was attempted (for AGENTS.md and CLAUDE.md)
    expect(mockSymlinkSync).toHaveBeenCalled();

    // copyFileSync was called as fallback (statements 58-59 in scaffold.ts)
    const copyCalls = mockCopyFileSync.mock.calls.map((c) => String(c[1]));
    const agentsMdCopied = copyCalls.some((dest) => dest.endsWith("AGENTS.md"));
    const claudeMdCopied = copyCalls.some((dest) => dest.endsWith("CLAUDE.md"));
    expect(agentsMdCopied).toBe(true);
    expect(claudeMdCopied).toBe(true);

    // The destination files should exist (as copies, not symlinks)
    expect(existsSync(resolve(projDir, "AGENTS.md"))).toBe(true);
    expect(existsSync(resolve(projDir, "CLAUDE.md"))).toBe(true);
  });
});
