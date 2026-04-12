import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  hasLocalCredentials,
  loadCredentialsFromVolume,
  hasEnvCredentials,
  loadCredentialsFromEnv,
} from "../../src/agents/credential-setup.js";

// --- helpers ---

let tempDir: string;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "al-cred-test-"));
  savedEnv = { ...process.env };
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  // Restore env vars
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  for (const [key, val] of Object.entries(savedEnv)) {
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
});

function setCredPath(path: string) {
  process.env.AL_CREDENTIALS_PATH = path;
}

function clearCredPath() {
  delete process.env.AL_CREDENTIALS_PATH;
}

function makeCredVolume(base: string, entries: Record<string, Record<string, Record<string, string>>>) {
  for (const [type, instances] of Object.entries(entries)) {
    for (const [instance, fields] of Object.entries(instances)) {
      const dir = join(base, type, instance);
      mkdirSync(dir, { recursive: true });
      for (const [field, value] of Object.entries(fields)) {
        writeFileSync(join(dir, field), value);
      }
    }
  }
}

// --- hasLocalCredentials ---

describe("hasLocalCredentials", () => {
  it("returns true when credentials path has entries", () => {
    setCredPath(tempDir);
    mkdirSync(join(tempDir, "github_token"));
    expect(hasLocalCredentials()).toBe(true);
    clearCredPath();
  });

  it("returns false when credentials path is empty", () => {
    setCredPath(tempDir);
    expect(hasLocalCredentials()).toBe(false);
    clearCredPath();
  });

  it("returns false when credentials path does not exist", () => {
    setCredPath(join(tempDir, "nonexistent"));
    expect(hasLocalCredentials()).toBe(false);
    clearCredPath();
  });

  it("uses /credentials as default path when AL_CREDENTIALS_PATH is not set", () => {
    // /credentials does not exist in test env, so hasLocalCredentials() returns false
    clearCredPath();
    // We just verify it doesn't throw and returns a boolean
    const result = hasLocalCredentials();
    expect(typeof result).toBe("boolean");
  });
});

// --- loadCredentialsFromVolume ---

describe("loadCredentialsFromVolume", () => {
  it("loads credentials from a volume directory structure", () => {
    setCredPath(tempDir);
    makeCredVolume(tempDir, {
      github_token: {
        default: { token: "ghp_secret123" },
      },
    });

    const bundle = loadCredentialsFromVolume();
    expect(bundle.github_token?.default?.token).toBe("ghp_secret123");
    clearCredPath();
  });

  it("trims whitespace from credential values", () => {
    setCredPath(tempDir);
    makeCredVolume(tempDir, {
      anthropic_key: {
        default: { token: "  sk-ant-123  \n" },
      },
    });

    const bundle = loadCredentialsFromVolume();
    expect(bundle.anthropic_key?.default?.token).toBe("sk-ant-123");
    clearCredPath();
  });

  it("loads multiple credential types and instances", () => {
    setCredPath(tempDir);
    makeCredVolume(tempDir, {
      github_token: {
        default: { token: "ghp_123" },
        secondary: { token: "ghp_456" },
      },
      anthropic_key: {
        default: { token: "sk-ant-789" },
      },
    });

    const bundle = loadCredentialsFromVolume();
    expect(bundle.github_token?.default?.token).toBe("ghp_123");
    expect(bundle.github_token?.secondary?.token).toBe("ghp_456");
    expect(bundle.anthropic_key?.default?.token).toBe("sk-ant-789");
    clearCredPath();
  });

  it("skips non-directory entries at the type level", () => {
    setCredPath(tempDir);
    // Create a file (not a directory) at type level — should be skipped
    writeFileSync(join(tempDir, "not-a-type"), "some content");
    mkdirSync(join(tempDir, "github_token", "default"), { recursive: true });
    writeFileSync(join(tempDir, "github_token", "default", "token"), "ghp_123");

    const bundle = loadCredentialsFromVolume();
    expect(bundle["not-a-type"]).toBeUndefined();
    expect(bundle.github_token?.default?.token).toBe("ghp_123");
    clearCredPath();
  });

  it("returns empty bundle when credentials dir is empty", () => {
    setCredPath(tempDir);
    const bundle = loadCredentialsFromVolume();
    expect(Object.keys(bundle)).toHaveLength(0);
    clearCredPath();
  });

  it("skips dangling symlinks at type level via catch continue", () => {
    setCredPath(tempDir);
    // Dangling symlink → statSync throws ENOENT → catch { continue }
    symlinkSync(join(tempDir, "nonexistent-target"), join(tempDir, "dangling-type"));
    // Valid credential entry alongside it
    mkdirSync(join(tempDir, "github_token", "default"), { recursive: true });
    writeFileSync(join(tempDir, "github_token", "default", "token"), "valid-token");

    const bundle = loadCredentialsFromVolume();
    expect(bundle["dangling-type"]).toBeUndefined();
    expect(bundle.github_token?.default?.token).toBe("valid-token");
    clearCredPath();
  });

  it("skips dangling symlinks at instance level via catch continue", () => {
    setCredPath(tempDir);
    // Valid type directory, but with a dangling symlink for instance
    mkdirSync(join(tempDir, "github_token"), { recursive: true });
    symlinkSync(join(tempDir, "nonexistent-instance-target"), join(tempDir, "github_token", "dangling-instance"));
    // Valid instance alongside
    mkdirSync(join(tempDir, "github_token", "default"), { recursive: true });
    writeFileSync(join(tempDir, "github_token", "default", "token"), "valid-token");

    const bundle = loadCredentialsFromVolume();
    expect(bundle.github_token?.["dangling-instance"]).toBeUndefined();
    expect(bundle.github_token?.default?.token).toBe("valid-token");
    clearCredPath();
  });

  it("skips instance-level entries that are files (not directories) via !isDirectory() continue", () => {
    setCredPath(tempDir);
    // Create a type directory with a FILE at the instance level (not a directory)
    // statSync succeeds but isDirectory() returns false → continue is executed
    mkdirSync(join(tempDir, "github_token"), { recursive: true });
    writeFileSync(join(tempDir, "github_token", "not-a-dir"), "just a file");
    // Valid instance alongside
    mkdirSync(join(tempDir, "github_token", "default"), { recursive: true });
    writeFileSync(join(tempDir, "github_token", "default", "token"), "valid-token");

    const bundle = loadCredentialsFromVolume();
    // The file entry should be skipped (not treated as an instance)
    expect(bundle.github_token?.["not-a-dir"]).toBeUndefined();
    expect(bundle.github_token?.default?.token).toBe("valid-token");
    clearCredPath();
  });
});

// --- hasEnvCredentials ---

describe("hasEnvCredentials", () => {
  it("returns true when AL_SECRET_* env vars are present", () => {
    process.env.AL_SECRET_github_token__default__token = "ghp_123";
    expect(hasEnvCredentials()).toBe(true);
  });

  it("returns false when no AL_SECRET_* env vars are present", () => {
    // Remove any AL_SECRET_ vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("AL_SECRET_")) delete process.env[key];
    }
    expect(hasEnvCredentials()).toBe(false);
  });
});

// --- loadCredentialsFromEnv ---

describe("loadCredentialsFromEnv", () => {
  it("parses AL_SECRET_TYPE__INSTANCE__FIELD env vars into bundle", () => {
    // Parts are stored as-is (unsanitize only replaces _xHH sequences)
    process.env.AL_SECRET_github_token__default__token = "ghp_from_env";

    const bundle = loadCredentialsFromEnv();
    expect(bundle["github_token"]?.["default"]?.["token"]).toBe("ghp_from_env");
  });

  it("skips env vars that don't match TYPE__INSTANCE__FIELD (3 parts)", () => {
    // Single underscores → only 1 part when split by "__"
    process.env.AL_SECRET_ONLY_ONE_PART = "value";

    const bundle = loadCredentialsFromEnv();
    expect(bundle["ONLY_ONE_PART"]).toBeUndefined();
  });

  it("handles multiple credentials from env", () => {
    process.env.AL_SECRET_github_token__default__token = "ghp_abc";
    process.env.AL_SECRET_anthropic_key__default__token = "sk-ant-xyz";

    const bundle = loadCredentialsFromEnv();
    expect(bundle["github_token"]?.["default"]?.["token"]).toBe("ghp_abc");
    expect(bundle["anthropic_key"]?.["default"]?.["token"]).toBe("sk-ant-xyz");
  });

  it("returns empty bundle when no AL_SECRET_ vars exist", () => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("AL_SECRET_")) delete process.env[key];
    }

    const bundle = loadCredentialsFromEnv();
    expect(Object.keys(bundle)).toHaveLength(0);
  });

  it("unsanitizes env part names (hex-encoded characters)", () => {
    // _x2d = '-' (hyphen), so "my_x2dinstance" becomes "my-instance"
    process.env["AL_SECRET_github_token__my_x2dinstance__token"] = "ghp_encoded";

    const bundle = loadCredentialsFromEnv();
    expect(bundle["github_token"]?.["my-instance"]?.["token"]).toBe("ghp_encoded");
  });
});

