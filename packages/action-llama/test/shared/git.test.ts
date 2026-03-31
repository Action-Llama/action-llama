import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so mocks are available inside factory functions
const { mockExecFileSync, mockExistsSync } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(() => "  result  "),
  mockExistsSync: vi.fn(() => false),
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, execFileSync: mockExecFileSync };
});

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, existsSync: mockExistsSync };
});

import { sshUrl, gitExec } from "../../src/shared/git.js";

describe("sshUrl", () => {
  it("returns ssh git URL", () => {
    expect(sshUrl("octocat", "hello-world")).toBe("git@github.com:octocat/hello-world.git");
  });
});

describe("gitExec", () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockExistsSync.mockReset();
    mockExecFileSync.mockReturnValue("  result  ");
  });

  it("runs git command and returns trimmed output when SSH key does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    mockExecFileSync.mockReturnValue("  main  ");

    const result = gitExec("git rev-parse --abbrev-ref HEAD", "/tmp/test-repo");

    expect(result).toBe("main");
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      expect.objectContaining({ cwd: "/tmp/test-repo", encoding: "utf-8" })
    );
    // When AL SSH key doesn't exist, env.GIT_SSH_COMMAND should NOT be overridden
    // with the AL key path (it may still exist from process.env ambient value)
    const callEnv = mockExecFileSync.mock.calls.at(-1)![2].env as Record<string, string>;
    // The key specifically used for AL auth should not appear
    expect(callEnv.GIT_SSH_COMMAND).not.toContain("git_ssh/default/id_rsa");
  });

  it("sets GIT_SSH_COMMAND with AL key path when SSH key exists", () => {
    mockExistsSync.mockReturnValue(true);
    mockExecFileSync.mockReturnValue("  abc123  ");

    const result = gitExec("git log --oneline -1");

    expect(result).toBe("abc123");
    // When AL SSH key exists, GIT_SSH_COMMAND should reference the AL key path
    const callEnv = mockExecFileSync.mock.calls.at(-1)![2].env as Record<string, string>;
    expect(callEnv.GIT_SSH_COMMAND).toContain("ssh -i");
    expect(callEnv.GIT_SSH_COMMAND).toContain("git_ssh/default/id_rsa");
    expect(callEnv.GIT_SSH_COMMAND).toContain("StrictHostKeyChecking=accept-new");
  });

  it("runs command without cwd when not provided", () => {
    mockExistsSync.mockReturnValue(false);
    mockExecFileSync.mockReturnValue("  output  ");

    const result = gitExec("git status");

    expect(result).toBe("output");
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "git",
      ["status"],
      expect.objectContaining({ encoding: "utf-8" })
    );
  });
});
