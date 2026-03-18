import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import {
  writeEnvToml,
  loadEnvToml,
  writeEnvironmentConfig,
  environmentExists,
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

import { set, prov, deprov } from "../../../src/cli/commands/env.js";

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

describe("env prov", () => {
  const testEnvName = `test-prov-${Date.now()}`;

  afterEach(() => {
    try { rmSync(environmentPath(testEnvName)); } catch {}
  });

  it("skips if environment already has a real host", async () => {
    writeEnvironmentConfig(testEnvName, {
      server: { host: "1.2.3.4", user: "root" },
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await prov(testEnvName);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("already has a server"),
    );
    logSpy.mockRestore();
  });
});

describe("env deprov", () => {
  let tmpDir: string;
  const testEnvName = `test-deprov-${Date.now()}`;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-env-deprov-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    try { rmSync(environmentPath(testEnvName)); } catch {}
  });

  it("throws if environment does not exist", async () => {
    await expect(deprov("nonexistent-env-xyz-12345", { project: tmpDir })).rejects.toThrow("not found");
  });

  it("throws if environment has no server config", async () => {
    writeEnvironmentConfig(testEnvName, {
      gateway: { url: "http://localhost:3000" },
    });

    await expect(deprov(testEnvName, { project: tmpDir })).rejects.toThrow("no [server] config");
  });
});
