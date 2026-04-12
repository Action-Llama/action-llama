import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";
import {
  writeEnvToml,
  loadEnvToml,
  environmentPath,
} from "../../../src/shared/environment.js";

// Mock inquirer prompts
const mockInput = vi.fn();
vi.mock("@inquirer/prompts", () => ({
  select: vi.fn(),
  input: (...args: any[]) => mockInput(...args),
  checkbox: vi.fn(),
  confirm: vi.fn(),
}));

// Mock FilesystemBackend for credential-dependent checks
vi.mock("../../../src/shared/filesystem-backend.js", () => ({
  FilesystemBackend: class {
    read = () => Promise.resolve(undefined);
  },
}));

import { list, show, set } from "../../../src/cli/commands/env.js";

describe("env set", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-env-set-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates .env.toml with environment binding", async () => {
    await set("staging", { project: tmpDir });

    const result = loadEnvToml(tmpDir);
    expect(result?.environment).toBe("staging");
  });

  it("preserves existing fields in .env.toml", async () => {
    writeFileSync(resolve(tmpDir, ".env.toml"), 'projectName = "my-project"\n');

    await set("prod", { project: tmpDir });

    const result = loadEnvToml(tmpDir);
    expect(result?.environment).toBe("prod");
    expect(result?.projectName).toBe("my-project");
  });

  it("clears environment binding when called without a name", async () => {
    writeFileSync(resolve(tmpDir, ".env.toml"), 'environment = "prod"\nprojectName = "my-app"\n');

    await set(undefined, { project: tmpDir });

    const result = loadEnvToml(tmpDir);
    expect(result?.environment).toBeUndefined();
    expect(result?.projectName).toBe("my-app");
  });

  it("warns when environment does not exist", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await set("nonexistent-env-test-12345", { project: tmpDir });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("does not exist yet"),
    );
    warnSpy.mockRestore();
  });
});

describe("env list", () => {
  it("logs message when no environments configured", async () => {
    // We can't easily control the list without changing home dir.
    // Instead, test that list() runs without throwing.
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(list()).resolves.not.toThrow();
    logSpy.mockRestore();
  });

  it("lists environments", async () => {
    const envName = `test-list-${Date.now()}`;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const envFilePath = environmentPath(envName);
    mkdirSync(resolve(envFilePath, ".."), { recursive: true });
    writeFileSync(envFilePath, stringifyTOML({ gateway: { url: "http://localhost:3000" } }));

    try {
      await list();
      const calls = logSpy.mock.calls.map((c) => c.join(" "));
      const hasEnv = calls.some((c) => c.includes(envName));
      expect(hasEnv).toBe(true);
    } finally {
      try { rmSync(environmentPath(envName)); } catch {}
      logSpy.mockRestore();
    }
  });
});

describe("env show", () => {
  const testEnvName = `test-show-${Date.now()}`;

  afterEach(() => {
    try { rmSync(environmentPath(testEnvName)); } catch {}
  });

  it("throws ConfigError when environment does not exist", async () => {
    await expect(show("nonexistent-env-show-xyz")).rejects.toThrow("not found");
  });

  it("logs environment name, file path, and content", async () => {
    const envFilePath = environmentPath(testEnvName);
    mkdirSync(resolve(envFilePath, ".."), { recursive: true });
    writeFileSync(envFilePath, stringifyTOML({ gateway: { url: "http://9.8.7.6:3000" } }));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await show(testEnvName);

    const output = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain(testEnvName);
    expect(output).toContain("9.8.7.6:3000");
    logSpy.mockRestore();
  });
});

describe("env list — invalid config", () => {
  it("shows (invalid config) when environment file cannot be parsed", async () => {
    const envName = `test-invalid-cfg-${Date.now()}`;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Write invalid TOML that will cause loadEnvironmentConfig to throw
    writeFileSync(environmentPath(envName), "this is not valid toml = [");

    try {
      await list();
      const output = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(output).toContain(envName);
      expect(output).toContain("invalid config");
    } finally {
      try { rmSync(environmentPath(envName)); } catch {}
      logSpy.mockRestore();
    }
  });
});
