import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML, parse as parseTOML } from "smol-toml";
import { executeAdd, executeList, executeRemove } from "../../../src/cli/commands/remote.js";

describe("remote commands", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-remote-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("add", () => {
    it("adds a remote to config.toml", async () => {
      // Start with an empty config
      writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({ docker: { enabled: false } }));

      await executeAdd("production", {
        project: tmpDir,
        provider: "gsm",
        gcpProject: "my-gcp-project",
      });

      const config = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
      expect(config.remotes.production.provider).toBe("gsm");
      expect(config.remotes.production.gcpProject).toBe("my-gcp-project");
    });

    it("adds a remote with secretPrefix", async () => {
      writeFileSync(resolve(tmpDir, "config.toml"), "");

      await executeAdd("staging", {
        project: tmpDir,
        provider: "gsm",
        gcpProject: "staging-project",
        secretPrefix: "al-staging",
      });

      const config = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
      expect(config.remotes.staging.secretPrefix).toBe("al-staging");
    });

    it("throws if remote already exists", async () => {
      const config = { remotes: { prod: { provider: "gsm", gcpProject: "p" } } };
      writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML(config as any));

      await expect(
        executeAdd("prod", { project: tmpDir, provider: "gsm", gcpProject: "p" })
      ).rejects.toThrow("already exists");
    });

    it("throws if gsm provider missing gcpProject", async () => {
      writeFileSync(resolve(tmpDir, "config.toml"), "");

      await expect(
        executeAdd("prod", { project: tmpDir, provider: "gsm" })
      ).rejects.toThrow("--gcp-project is required");
    });

    it("adds an asm remote with awsRegion", async () => {
      writeFileSync(resolve(tmpDir, "config.toml"), "");

      await executeAdd("aws-prod", {
        project: tmpDir,
        provider: "asm",
        awsRegion: "us-east-1",
      });

      const config = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
      expect(config.remotes["aws-prod"].provider).toBe("asm");
      expect(config.remotes["aws-prod"].awsRegion).toBe("us-east-1");
    });

    it("throws if asm provider missing awsRegion", async () => {
      writeFileSync(resolve(tmpDir, "config.toml"), "");

      await expect(
        executeAdd("prod", { project: tmpDir, provider: "asm" })
      ).rejects.toThrow("--aws-region is required");
    });

    it("creates config.toml if it does not exist", async () => {
      await executeAdd("production", {
        project: tmpDir,
        provider: "gsm",
        gcpProject: "my-project",
      });

      const config = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
      expect(config.remotes.production.provider).toBe("gsm");
    });
  });

  describe("list", () => {
    it("shows message when no remotes", async () => {
      writeFileSync(resolve(tmpDir, "config.toml"), "");
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await executeList({ project: tmpDir });
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("No remotes configured"));
      logSpy.mockRestore();
    });

    it("lists configured remotes", async () => {
      const config = { remotes: { prod: { provider: "gsm", gcpProject: "my-proj" } } };
      writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML(config as any));
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await executeList({ project: tmpDir });
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("prod"));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("gsm"));
      logSpy.mockRestore();
    });
  });

  describe("remove", () => {
    it("removes a remote", async () => {
      const config = {
        docker: { enabled: false },
        remotes: { prod: { provider: "gsm", gcpProject: "p" }, staging: { provider: "gsm", gcpProject: "s" } },
      };
      writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML(config as any));

      await executeRemove("prod", { project: tmpDir });

      const updated = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
      expect(updated.remotes.prod).toBeUndefined();
      expect(updated.remotes.staging).toBeDefined();
    });

    it("throws if remote does not exist", async () => {
      writeFileSync(resolve(tmpDir, "config.toml"), "");
      await expect(executeRemove("nope", { project: tmpDir })).rejects.toThrow("not found");
    });

    it("removes remotes key when last remote is removed", async () => {
      const config = { remotes: { prod: { provider: "gsm", gcpProject: "p" } } };
      writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML(config as any));

      await executeRemove("prod", { project: tmpDir });

      const updated = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
      expect(updated.remotes).toBeUndefined();
    });
  });
});

// Import vi for spy usage
import { vi } from "vitest";
