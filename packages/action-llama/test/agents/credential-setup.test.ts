import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  hasLocalCredentials,
  loadCredentialsFromVolume,
  hasEnvCredentials,
  loadCredentialsFromEnv,
  loadContainerCredentials,
} from "../../src/agents/credential-setup.js";
import { makeAgentConfig } from "../helpers.js";

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

// --- loadContainerCredentials ---

describe("loadContainerCredentials", () => {
  it("loads credentials from volume and resolves provider API key", () => {
    setCredPath(tempDir);
    makeCredVolume(tempDir, {
      anthropic_key: {
        default: { token: "sk-ant-test" },
      },
    });

    const agentConfig = makeAgentConfig({
      models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" }],
      credentials: [],
    });

    const result = loadContainerCredentials(agentConfig);
    expect(result.providerKeys.get("anthropic")).toBe("sk-ant-test");
    clearCredPath();
  });

  it("loads credentials from env vars when no volume is present", () => {
    setCredPath(join(tempDir, "nonexistent")); // no volume
    // AL_SECRET_ format: type__instance__field (parts split by __)
    process.env.AL_SECRET_anthropic_key__default__token = "sk-ant-env";

    const agentConfig = makeAgentConfig({
      models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" }],
      credentials: [],
    });

    const result = loadContainerCredentials(agentConfig);
    expect(result.providerKeys.get("anthropic")).toBe("sk-ant-env");
    clearCredPath();
  });

  it("throws when no credentials are available", () => {
    setCredPath(join(tempDir, "nonexistent")); // no volume
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("AL_SECRET_")) delete process.env[key];
    }

    const agentConfig = makeAgentConfig({
      models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" }],
      credentials: [],
    });

    expect(() => loadContainerCredentials(agentConfig)).toThrow("no credentials available");
    clearCredPath();
  });

  it("throws when provider API key is missing from bundle", () => {
    setCredPath(tempDir);
    // No anthropic_key in the volume
    makeCredVolume(tempDir, {
      github_token: { default: { token: "ghp_123" } },
    });

    const agentConfig = makeAgentConfig({
      models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" }],
      credentials: [],
    });

    expect(() => loadContainerCredentials(agentConfig)).toThrow("missing provider API key credentials");
    clearCredPath();
  });

  it("skips provider key resolution for pi_auth models", () => {
    setCredPath(tempDir);
    // Empty volume but model uses pi_auth
    makeCredVolume(tempDir, {
      placeholder: { default: { value: "x" } },
    });

    const agentConfig = makeAgentConfig({
      models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "pi_auth" }],
      credentials: [],
    });

    const result = loadContainerCredentials(agentConfig);
    expect(result.providerKeys.size).toBe(0);
    clearCredPath();
  });

  it("injects env vars from credential definitions via envVars", () => {
    setCredPath(tempDir);
    makeCredVolume(tempDir, {
      anthropic_key: { default: { token: "sk-ant-123" } },
      github_token: { default: { token: "ghp_from_vol" } },
    });

    const agentConfig = makeAgentConfig({
      models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" }],
      credentials: ["github_token"],
    });

    loadContainerCredentials(agentConfig);
    // github_token should set GITHUB_TOKEN env var
    expect(process.env.GITHUB_TOKEN).toBe("ghp_from_vol");
    clearCredPath();
  });

  it("sets GH_TOKEN alias when github_token credential is loaded", () => {
    setCredPath(tempDir);
    makeCredVolume(tempDir, {
      anthropic_key: { default: { token: "sk-ant-123" } },
      github_token: { default: { token: "ghp_alias_test" } },
    });

    const agentConfig = makeAgentConfig({
      models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" }],
      credentials: ["github_token"],
    });

    loadContainerCredentials(agentConfig);
    expect(process.env.GH_TOKEN).toBe("ghp_alias_test");
    clearCredPath();
  });

  it("does not deduplicate provider keys across multiple models with different providers", () => {
    setCredPath(tempDir);
    makeCredVolume(tempDir, {
      anthropic_key: { default: { token: "sk-ant-abc" } },
      openai_key: { default: { token: "sk-openai-def" } },
    });

    const agentConfig = makeAgentConfig({
      models: [
        { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" },
        { provider: "openai", model: "gpt-4o", thinkingLevel: "none" as any, authType: "api_key" },
      ],
      credentials: [],
    });

    const result = loadContainerCredentials(agentConfig);
    expect(result.providerKeys.get("anthropic")).toBe("sk-ant-abc");
    expect(result.providerKeys.get("openai")).toBe("sk-openai-def");
    clearCredPath();
  });

  it("deduplicates when the same provider appears multiple times in models", () => {
    setCredPath(tempDir);
    makeCredVolume(tempDir, {
      anthropic_key: { default: { token: "sk-ant-single" } },
    });

    const agentConfig = makeAgentConfig({
      models: [
        { provider: "anthropic", model: "claude-3-haiku", thinkingLevel: "none" as any, authType: "api_key" },
        { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" },
      ],
      credentials: [],
    });

    const result = loadContainerCredentials(agentConfig);
    // Only one entry for anthropic even though it appeared twice
    expect(result.providerKeys.size).toBe(1);
    expect(result.providerKeys.get("anthropic")).toBe("sk-ant-single");
    clearCredPath();
  });

  it("skips credential type with no envVars definition", () => {
    setCredPath(tempDir);
    makeCredVolume(tempDir, {
      anthropic_key: { default: { token: "sk-ant-123" } },
      // "unknown_cred" has no built-in definition, so no envVars
      unknown_cred: { default: { some_field: "some_value" } },
    });

    const agentConfig = makeAgentConfig({
      models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" }],
      credentials: ["unknown_cred"],
    });

    // Should not throw — unknown credential types are skipped
    const result = loadContainerCredentials(agentConfig);
    expect(result.providerKeys.get("anthropic")).toBe("sk-ant-123");
    clearCredPath();
  });

  it("sets up SSH key from git_ssh credential", () => {
    setCredPath(tempDir);
    // Preserve any real SSH key that may be at /tmp/.ssh/id_rsa
    const realKeyPath = "/tmp/.ssh/id_rsa";
    let originalKey: string | undefined;
    try { originalKey = readFileSync(realKeyPath, "utf-8"); } catch { /* no existing key */ }

    makeCredVolume(tempDir, {
      anthropic_key: { default: { token: "sk-ant-ssh-test" } },
      git_ssh: { default: { id_rsa: "-----BEGIN OPENSSH PRIVATE KEY-----\nfake-key\n-----END OPENSSH PRIVATE KEY-----" } },
    });

    const agentConfig = makeAgentConfig({
      models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" }],
      credentials: ["git_ssh"],
    });

    try {
      loadContainerCredentials(agentConfig);
      expect(process.env.GIT_SSH_COMMAND).toContain("ssh -i");
      expect(process.env.GIT_SSH_COMMAND).toContain("StrictHostKeyChecking=accept-new");
    } finally {
      // Restore the original SSH key if it existed
      if (originalKey !== undefined) {
        writeFileSync(realKeyPath, originalKey, { mode: 0o600 });
      }
    }
    clearCredPath();
  });

  it("sets git identity from git_ssh credential username and email", () => {
    setCredPath(tempDir);
    const realKeyPath = "/tmp/.ssh/id_rsa";
    let originalKey: string | undefined;
    try { originalKey = readFileSync(realKeyPath, "utf-8"); } catch { /* no existing key */ }

    makeCredVolume(tempDir, {
      anthropic_key: { default: { token: "sk-ant-id-test" } },
      git_ssh: {
        default: {
          id_rsa: "-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----",
          username: "Test Bot",
          email: "bot@example.com",
        },
      },
    });

    const agentConfig = makeAgentConfig({
      models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" }],
      credentials: ["git_ssh"],
    });

    try {
      loadContainerCredentials(agentConfig);
      expect(process.env.GIT_AUTHOR_NAME).toBe("Test Bot");
      expect(process.env.GIT_COMMITTER_NAME).toBe("Test Bot");
      expect(process.env.GIT_AUTHOR_EMAIL).toBe("bot@example.com");
      expect(process.env.GIT_COMMITTER_EMAIL).toBe("bot@example.com");
    } finally {
      if (originalKey !== undefined) {
        writeFileSync(realKeyPath, originalKey, { mode: 0o600 });
      }
    }
    clearCredPath();
  });

  it("configures git credential helper when GITHUB_TOKEN is set", () => {
    setCredPath(tempDir);
    makeCredVolume(tempDir, {
      anthropic_key: { default: { token: "sk-ant-git-https" } },
      github_token: { default: { token: "ghp_https_token" } },
    });
    process.env.GITHUB_TOKEN = "ghp_https_token";

    const agentConfig = makeAgentConfig({
      models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" }],
      credentials: ["github_token"],
    });

    loadContainerCredentials(agentConfig);
    expect(process.env.GIT_TERMINAL_PROMPT).toBe("0");
    const count = parseInt(process.env.GIT_CONFIG_COUNT || "0", 10);
    expect(count).toBeGreaterThan(0);
    clearCredPath();
  });
});
