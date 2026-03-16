import { describe, it, expect, vi, afterEach } from "vitest";
import { gitCloneProvider } from "../../../src/preflight/providers/git-clone.js";
import type { PreflightContext } from "../../../src/preflight/schema.js";
import * as childProcess from "child_process";

vi.mock("child_process", async () => {
  const actual = await vi.importActual<typeof childProcess>("child_process");
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

const mockedExecSync = vi.mocked(childProcess.execSync);

function makeCtx(env?: Record<string, string>): PreflightContext {
  return {
    env: { ...env } as Record<string, string>,
    logger: () => {},
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("git-clone provider", () => {
  it("expands short repo name to SSH URL", async () => {
    mockedExecSync.mockReturnValueOnce(Buffer.from(""));
    await gitCloneProvider.run(
      { repo: "acme/app", dest: "/tmp/repo" },
      makeCtx(),
    );
    expect(mockedExecSync).toHaveBeenCalledWith(
      "git clone git@github.com:acme/app.git /tmp/repo",
      expect.any(Object),
    );
  });

  it("passes full SSH URLs through", async () => {
    mockedExecSync.mockReturnValueOnce(Buffer.from(""));
    await gitCloneProvider.run(
      { repo: "git@github.com:acme/app.git", dest: "/tmp/repo" },
      makeCtx(),
    );
    expect(mockedExecSync).toHaveBeenCalledWith(
      "git clone git@github.com:acme/app.git /tmp/repo",
      expect.any(Object),
    );
  });

  it("passes full HTTPS URLs through", async () => {
    mockedExecSync.mockReturnValueOnce(Buffer.from(""));
    await gitCloneProvider.run(
      { repo: "https://github.com/acme/app.git", dest: "/tmp/repo" },
      makeCtx(),
    );
    expect(mockedExecSync).toHaveBeenCalledWith(
      "git clone https://github.com/acme/app.git /tmp/repo",
      expect.any(Object),
    );
  });

  it("adds --branch and --depth flags", async () => {
    mockedExecSync.mockReturnValueOnce(Buffer.from(""));
    await gitCloneProvider.run(
      { repo: "acme/app", dest: "/tmp/repo", branch: "develop", depth: 1 },
      makeCtx(),
    );
    expect(mockedExecSync).toHaveBeenCalledWith(
      "git clone --branch develop --depth 1 git@github.com:acme/app.git /tmp/repo",
      expect.any(Object),
    );
  });

  it("passes env to child process", async () => {
    mockedExecSync.mockReturnValueOnce(Buffer.from(""));
    const env = { GIT_SSH_COMMAND: "ssh -i /key" };
    await gitCloneProvider.run(
      { repo: "acme/app", dest: "/tmp/repo" },
      makeCtx(env),
    );
    expect(mockedExecSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ env: expect.objectContaining(env) }),
    );
  });

  it("throws on missing repo", async () => {
    await expect(
      gitCloneProvider.run({ dest: "/tmp/repo" }, makeCtx()),
    ).rejects.toThrow(/requires a 'repo' param/);
  });

  it("throws on missing dest", async () => {
    await expect(
      gitCloneProvider.run({ repo: "acme/app" }, makeCtx()),
    ).rejects.toThrow(/requires a 'dest' param/);
  });

  it("throws when git clone fails", async () => {
    mockedExecSync.mockImplementationOnce(() => {
      throw new Error("fatal: repo not found");
    });
    await expect(
      gitCloneProvider.run({ repo: "acme/bad", dest: "/tmp/repo" }, makeCtx()),
    ).rejects.toThrow(/repo not found/);
  });
});
