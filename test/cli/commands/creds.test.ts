import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";
import { FilesystemBackend } from "../../../src/shared/filesystem-backend.js";
import { executePush, executePull } from "../../../src/cli/commands/creds.js";

// Mock resolveRemote to return a known remote config
vi.mock("../../../src/shared/config.js", async () => {
  const actual = await vi.importActual("../../../src/shared/config.js") as any;
  return {
    ...actual,
    resolveRemote: () => ({ provider: "test" }),
  };
});

// Track what the "remote" backend receives
let remoteBackend: FilesystemBackend;

vi.mock("../../../src/shared/remote.js", () => ({
  createBackendForRemote: () => remoteBackend,
  createLocalBackend: () => localBackend,
}));

let localBackend: FilesystemBackend;
let localDir: string;
let remoteDir: string;

describe("creds push/pull", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "al-creds-test-proj-"));
    localDir = mkdtempSync(join(tmpdir(), "al-creds-test-local-"));
    remoteDir = mkdtempSync(join(tmpdir(), "al-creds-test-remote-"));
    localBackend = new FilesystemBackend(localDir);
    remoteBackend = new FilesystemBackend(remoteDir);

    // Write a minimal config.toml (mock handles resolveRemote)
    writeFileSync(resolve(projectDir, "config.toml"), stringifyTOML({
      remotes: { production: { provider: "test" } },
    } as any));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(localDir, { recursive: true, force: true });
    rmSync(remoteDir, { recursive: true, force: true });
  });

  describe("push", () => {
    it("pushes local credentials to remote", async () => {
      await localBackend.write("github_token", "default", "token", "ghp_abc");
      await localBackend.write("git_ssh", "default", "id_rsa", "key-content");

      await executePush("production", { project: projectDir });

      expect(await remoteBackend.read("github_token", "default", "token")).toBe("ghp_abc");
      expect(await remoteBackend.read("git_ssh", "default", "id_rsa")).toBe("key-content");
    });

    it("reports nothing when no local credentials exist", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await executePush("production", { project: projectDir });
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("No local credentials"));
      logSpy.mockRestore();
    });
  });

  describe("pull", () => {
    it("pulls remote credentials to local", async () => {
      await remoteBackend.write("github_token", "default", "token", "ghp_remote");

      await executePull("production", { project: projectDir });

      expect(await localBackend.read("github_token", "default", "token")).toBe("ghp_remote");
    });

    it("reports nothing when no remote credentials exist", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await executePull("production", { project: projectDir });
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("No credentials found on remote"));
      logSpy.mockRestore();
    });
  });
});
