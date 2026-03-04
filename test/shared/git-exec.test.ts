import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("child_process", () => ({
  execSync: vi.fn(() => "  output  "),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("fs");
  return {
    ...actual,
    existsSync: vi.fn((path: string) => {
      if (typeof path === "string" && path.includes("id_rsa")) return true;
      return actual.existsSync(path);
    }),
  };
});

import { gitExec } from "../../src/shared/git.js";
import { execSync } from "child_process";

describe("gitExec", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls execSync and trims output", () => {
    const result = gitExec("git status", "/tmp");
    expect(result).toBe("output");
    expect(execSync).toHaveBeenCalledWith(
      "git status",
      expect.objectContaining({
        cwd: "/tmp",
        encoding: "utf-8",
        timeout: 120000,
      })
    );
  });

  it("includes GIT_SSH_COMMAND when SSH key exists", () => {
    gitExec("git fetch", "/tmp");
    const call = vi.mocked(execSync).mock.calls[0];
    const env = (call[1] as any).env;
    expect(env.GIT_SSH_COMMAND).toContain("id_rsa");
  });

  it("works without cwd", () => {
    gitExec("git version");
    expect(execSync).toHaveBeenCalledWith(
      "git version",
      expect.objectContaining({ cwd: undefined })
    );
  });
});
