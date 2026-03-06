import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";
import { resolveRemote } from "../../src/shared/config.js";

describe("resolveRemote", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-remote-resolve-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves a configured remote", () => {
    const config = {
      remotes: {
        production: { provider: "gsm", gcpProject: "my-project" },
      },
    };
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML(config as any));

    const remote = resolveRemote(tmpDir, "production");
    expect(remote.provider).toBe("gsm");
    expect(remote.gcpProject).toBe("my-project");
  });

  it("throws for non-existent remote", () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({}));
    expect(() => resolveRemote(tmpDir, "nope")).toThrow("not found");
  });

  it("lists available remotes in error message", () => {
    const config = {
      remotes: { staging: { provider: "gsm", gcpProject: "s" } },
    };
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML(config as any));
    expect(() => resolveRemote(tmpDir, "prod")).toThrow("staging");
  });
});
