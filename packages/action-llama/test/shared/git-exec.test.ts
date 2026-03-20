import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("child_process", () => ({
  execFileSync: vi.fn(() => "  output  "),
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
import { execFileSync } from "child_process";

describe("gitExec", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls execFileSync with split args and trims output", () => {
    const result = gitExec("git status", "/tmp");
    expect(result).toBe("output");
    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      ["status"],
      expect.objectContaining({
        cwd: "/tmp",
        encoding: "utf-8",
        timeout: 120000,
      })
    );
  });

  it("includes GIT_SSH_COMMAND when SSH key exists", () => {
    gitExec("git fetch", "/tmp");
    const call = vi.mocked(execFileSync).mock.calls[0];
    const env = (call[2] as any).env;
    expect(env.GIT_SSH_COMMAND).toContain("id_rsa");
  });

  it("works without cwd", () => {
    gitExec("git version");
    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      ["version"],
      expect.objectContaining({ cwd: undefined })
    );
  });
});
