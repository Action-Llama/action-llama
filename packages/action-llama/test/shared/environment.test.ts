import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";
import {
  loadEnvToml,
  loadEnvironmentConfig,
  resolveEnvironmentName,
  listEnvironments,
  environmentExists,
  writeEnvironmentConfig,
  writeEnvToml,
  updateAgentRuntimeOverride,
  environmentPath,
  deepMerge,
} from "../../src/shared/environment.js";
import { ENVIRONMENTS_DIR } from "../../src/shared/paths.js";

describe("deepMerge", () => {
  it("merges flat objects", () => {
    expect(deepMerge({ a: 1, b: 2 }, { b: 3, c: 4 })).toEqual({ a: 1, b: 3, c: 4 });
  });

  it("deep merges nested objects", () => {
    const base = { gateway: { port: 8080, url: "http://old" } };
    const override = { gateway: { url: "http://new" } };
    expect(deepMerge(base, override)).toEqual({
      gateway: { port: 8080, url: "http://new" },
    });
  });

  it("replaces arrays instead of merging", () => {
    const base = { subnets: ["a", "b"] };
    const override = { subnets: ["c"] };
    expect(deepMerge(base, override)).toEqual({ subnets: ["c"] });
  });

  it("skips undefined values in override", () => {
    const base = { a: 1, b: 2 };
    const override = { a: undefined, c: 3 };
    expect(deepMerge(base, override)).toEqual({ a: 1, b: 2, c: 3 });
  });

  it("replaces primitives with objects", () => {
    const base = { a: "string" } as any;
    const override = { a: { nested: true } };
    expect(deepMerge(base, override)).toEqual({ a: { nested: true } });
  });
});

describe("loadEnvToml", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns undefined when .env.toml does not exist", () => {
    expect(loadEnvToml(tmpDir)).toBeUndefined();
  });

  it("loads .env.toml with environment field", () => {
    writeFileSync(resolve(tmpDir, ".env.toml"), 'environment = "prod-aws"\n');
    const result = loadEnvToml(tmpDir);
    expect(result?.environment).toBe("prod-aws");
  });

  it("loads .env.toml with projectName field", () => {
    writeFileSync(resolve(tmpDir, ".env.toml"), 'projectName = "my-project"\n');
    const result = loadEnvToml(tmpDir);
    expect(result?.projectName).toBe("my-project");
  });

  it("includes file path in TOML parse error", () => {
    writeFileSync(resolve(tmpDir, ".env.toml"), "environment = {bad toml");
    expect(() => loadEnvToml(tmpDir)).toThrow(/\.env\.toml/);
  });

  it("loads .env.toml with config overrides", () => {
    const content = `
environment = "staging"

[gateway]
port = 9090
`;
    writeFileSync(resolve(tmpDir, ".env.toml"), content);
    const result = loadEnvToml(tmpDir);
    expect(result?.environment).toBe("staging");
    expect((result as any).gateway.port).toBe(9090);
  });
});

describe("loadEnvironmentConfig", () => {
  const testEnvName = `test-env-${Date.now()}`;
  const testEnvPath = resolve(ENVIRONMENTS_DIR, `${testEnvName}.toml`);

  afterEach(() => {
    try { rmSync(testEnvPath); } catch {}
  });

  it("throws for non-existent environment", () => {
    expect(() => loadEnvironmentConfig("nonexistent-env-12345")).toThrow("not found");
  });

  it("loads environment config file", () => {
    mkdirSync(ENVIRONMENTS_DIR, { recursive: true });
    const config = {
      server: {
        host: "deploy.example.com",
        user: "deployer",
      },
    };
    writeFileSync(testEnvPath, stringifyTOML(config as Record<string, unknown>));

    const loaded = loadEnvironmentConfig(testEnvName);
    expect(loaded.server?.host).toBe("deploy.example.com");
  });
});

describe("resolveEnvironmentName", () => {
  let tmpDir: string;
  const savedAlEnv = process.env.AL_ENV;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-test-"));
    delete process.env.AL_ENV;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (savedAlEnv !== undefined) {
      process.env.AL_ENV = savedAlEnv;
    } else {
      delete process.env.AL_ENV;
    }
  });

  it("returns CLI flag value first", () => {
    expect(resolveEnvironmentName("cli-env", tmpDir)).toBe("cli-env");
  });

  it("returns AL_ENV when no CLI flag", () => {
    process.env.AL_ENV = "env-var";
    expect(resolveEnvironmentName(undefined, tmpDir)).toBe("env-var");
  });

  it("returns .env.toml environment when no flag or env var", () => {
    writeFileSync(resolve(tmpDir, ".env.toml"), 'environment = "from-file"\n');
    expect(resolveEnvironmentName(undefined, tmpDir)).toBe("from-file");
  });

  it("returns undefined when nothing set", () => {
    expect(resolveEnvironmentName(undefined, tmpDir)).toBeUndefined();
  });

  it("CLI flag takes precedence over AL_ENV", () => {
    process.env.AL_ENV = "env-var";
    expect(resolveEnvironmentName("cli-env", tmpDir)).toBe("cli-env");
  });

  it("AL_ENV takes precedence over .env.toml", () => {
    process.env.AL_ENV = "env-var";
    writeFileSync(resolve(tmpDir, ".env.toml"), 'environment = "from-file"\n');
    expect(resolveEnvironmentName(undefined, tmpDir)).toBe("env-var");
  });
});

describe("listEnvironments", () => {
  it("returns list of environment names", () => {
    const envs = listEnvironments();
    // Just verify it returns an array (may or may not have entries depending on state)
    expect(Array.isArray(envs)).toBe(true);
  });
});

describe("writeEnvironmentConfig / environmentExists", () => {
  const testEnvName = `test-write-env-${Date.now()}`;

  afterEach(() => {
    try { rmSync(environmentPath(testEnvName)); } catch {}
  });

  it("creates and verifies environment", () => {
    expect(environmentExists(testEnvName)).toBe(false);

    writeEnvironmentConfig(testEnvName, {
      server: { host: "deploy.example.com", user: "deployer" },
    });

    expect(environmentExists(testEnvName)).toBe(true);

    const loaded = loadEnvironmentConfig(testEnvName);
    expect(loaded.server?.host).toBe("deploy.example.com");
  });
});

describe("writeEnvToml", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates .env.toml when it does not exist", () => {
    writeEnvToml(tmpDir, { environment: "prod" });
    const result = loadEnvToml(tmpDir);
    expect(result?.environment).toBe("prod");
  });

  it("preserves existing fields when updating", () => {
    writeFileSync(resolve(tmpDir, ".env.toml"), 'projectName = "my-app"\n');
    writeEnvToml(tmpDir, { environment: "staging" });
    const result = loadEnvToml(tmpDir);
    expect(result?.environment).toBe("staging");
    expect(result?.projectName).toBe("my-app");
  });

  it("deletes keys when value is undefined", () => {
    writeFileSync(resolve(tmpDir, ".env.toml"), 'environment = "prod"\nprojectName = "my-app"\n');
    writeEnvToml(tmpDir, { environment: undefined });
    const result = loadEnvToml(tmpDir);
    expect(result?.environment).toBeUndefined();
    expect(result?.projectName).toBe("my-app");
  });

  it("overwrites existing values", () => {
    writeFileSync(resolve(tmpDir, ".env.toml"), 'environment = "old"\n');
    writeEnvToml(tmpDir, { environment: "new" });
    const result = loadEnvToml(tmpDir);
    expect(result?.environment).toBe("new");
  });
});

describe("updateAgentRuntimeOverride", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates .env.toml with agent section when file does not exist", () => {
    updateAgentRuntimeOverride(tmpDir, "dev", { scale: 5 });
    const result = loadEnvToml(tmpDir);
    expect((result as any).agents.dev.scale).toBe(5);
  });

  it("updates existing agent section", () => {
    writeFileSync(resolve(tmpDir, ".env.toml"), stringifyTOML({
      agents: { dev: { scale: 1 } },
    }) + "\n");
    updateAgentRuntimeOverride(tmpDir, "dev", { scale: 3, timeout: 600 });
    const result = loadEnvToml(tmpDir);
    expect((result as any).agents.dev.scale).toBe(3);
    expect((result as any).agents.dev.timeout).toBe(600);
  });

  it("preserves other agents when updating one", () => {
    writeFileSync(resolve(tmpDir, ".env.toml"), stringifyTOML({
      agents: { dev: { scale: 2 }, reviewer: { timeout: 900 } },
    }) + "\n");
    updateAgentRuntimeOverride(tmpDir, "dev", { scale: 5 });
    const result = loadEnvToml(tmpDir);
    expect((result as any).agents.dev.scale).toBe(5);
    expect((result as any).agents.reviewer.timeout).toBe(900);
  });

  it("preserves non-agents fields in .env.toml", () => {
    writeFileSync(resolve(tmpDir, ".env.toml"), 'environment = "prod"\n');
    updateAgentRuntimeOverride(tmpDir, "dev", { feedback: false });
    const result = loadEnvToml(tmpDir);
    expect(result?.environment).toBe("prod");
    expect((result as any).agents.dev.feedback).toBe(false);
  });

  it("round-trips agents section through writeEnvToml", () => {
    writeEnvToml(tmpDir, { agents: { dev: { scale: 3 }, reviewer: { timeout: 600 } } } as any);
    const result = loadEnvToml(tmpDir);
    expect((result as any).agents.dev.scale).toBe(3);
    expect((result as any).agents.reviewer.timeout).toBe(600);
  });
});
