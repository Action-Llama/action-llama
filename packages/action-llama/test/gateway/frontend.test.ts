/**
 * Unit tests for gateway/frontend.ts
 * Covers resolveFrontendDist() bundled-path and null-return branches.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

// Controllable mocks for fs functions used by resolveFrontendDist
const mockExistsSync = vi.fn();
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    existsSync: (...args: any[]) => mockExistsSync(...args),
  };
});

import { resolveFrontendDist } from "../../src/gateway/frontend.js";

describe("resolveFrontendDist", () => {
  afterEach(() => {
    mockExistsSync.mockReset();
  });

  it("returns the bundled frontend path when its index.html exists", () => {
    // First existsSync call (for bundled path) returns true
    mockExistsSync.mockReturnValueOnce(true);

    const result = resolveFrontendDist();

    expect(result).not.toBeNull();
    expect(result).toContain("frontend");
    // Only one existsSync call (short-circuited after finding bundled)
    expect(mockExistsSync).toHaveBeenCalledTimes(1);
  });

  it("returns null when neither bundled nor linked frontend exists", () => {
    // All existsSync calls return false (bundled not found, dist not found)
    mockExistsSync.mockReturnValue(false);

    const result = resolveFrontendDist();

    expect(result).toBeNull();
  });

  it("returns null when the workspace-linked package is not installed (require.resolve throws)", () => {
    // Bundled index.html: not found; require.resolve throws (package not installed)
    mockExistsSync.mockReturnValueOnce(false);
    // createRequire().resolve will throw since @action-llama/frontend is not resolvable
    // → the catch block fires and returns null

    const result = resolveFrontendDist();

    expect(result).toBeNull();
  });
});
