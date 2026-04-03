/**
 * Integration tests: agents/credential-setup.ts and shared/git.ts — no Docker required.
 *
 * Tests pure and filesystem-based functions in credential-setup.ts and git.ts:
 *
 *   agents/credential-setup.ts:
 *     - hasEnvCredentials(): returns false when no AL_SECRET_* vars, true when present
 *     - loadCredentialsFromEnv(): parses AL_SECRET_type__instance__field env vars;
 *       handles multiple entries; skips malformed keys; strips wrong number of parts
 *     - hasLocalCredentials(): checks AL_CREDENTIALS_PATH directory for entries
 *     - loadCredentialsFromVolume(): reads credential bundle from a temp filesystem tree
 *
 *   agents/git-environment.ts:
 *     - GitEnvironment constructor
 *     - setup() with empty credentials: saves current env, returns savedEnv, no changes
 *     - setup() with git_ssh credential: loads username/email, sets GIT_AUTHOR_NAME etc.
 *     - restore() with undefined saved value: deletes the key
 *     - restore() with defined saved value: restores the original value
 *
 *   shared/git.ts:
 *     - sshUrl(): pure function returns correct SSH URL format
 *     - gitExec(): wraps execFileSync; runs simple command and trims output
 *
 * Covers:
 *   - agents/credential-setup.ts: hasEnvCredentials() — false/true
 *   - agents/credential-setup.ts: loadCredentialsFromEnv() — single entry, multiple entries,
 *     malformed key skipped, wrong parts count skipped
 *   - agents/credential-setup.ts: hasLocalCredentials() — false (empty dir / missing),
 *     true (has files)
 *   - agents/credential-setup.ts: loadCredentialsFromVolume() — empty dir, single credential,
 *     multiple types/instances/fields, skips non-directory entries
 *   - agents/git-environment.ts: GitEnvironment constructor
 *   - agents/git-environment.ts: setup() empty credentials — saves env, no env mutation
 *   - agents/git-environment.ts: setup() with git_ssh credential — sets GIT_AUTHOR_NAME etc.
 *   - agents/git-environment.ts: restore() undefined value — deletes key
 *   - agents/git-environment.ts: restore() defined value — restores key
 *   - shared/git.ts: sshUrl() — correct SSH URL format
 *   - shared/git.ts: gitExec() — executes command, returns trimmed stdout
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  setDefaultBackend,
  resetDefaultBackend,
  writeCredentialField,
} from "@action-llama/action-llama/internals/credentials";
import { FilesystemBackend } from "@action-llama/action-llama/internals/filesystem-backend";

// Import modules under test via direct dist paths
const {
  hasEnvCredentials,
  loadCredentialsFromEnv,
  hasLocalCredentials,
  loadCredentialsFromVolume,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/agents/credential-setup.js"
);

const {
  GitEnvironment,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/agents/git-environment.js"
);

const {
  sshUrl,
  gitExec,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/git.js"
);

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "al-cred-setup-test-"));
}

// ─── hasEnvCredentials ───────────────────────────────────────────────────────

describe("credential-setup: hasEnvCredentials()", { timeout: 10_000 }, () => {
  let savedKeys: string[];

  beforeEach(() => {
    // Save and remove all AL_SECRET_* env vars before each test
    savedKeys = Object.keys(process.env).filter((k) => k.startsWith("AL_SECRET_"));
    for (const k of savedKeys) delete process.env[k];
  });

  afterEach(() => {
    // Clean up any AL_SECRET_* vars added during the test
    for (const k of Object.keys(process.env).filter((k) => k.startsWith("AL_SECRET_"))) {
      delete process.env[k];
    }
  });

  it("returns false when no AL_SECRET_* env vars are set", () => {
    expect(hasEnvCredentials()).toBe(false);
  });

  it("returns true when at least one AL_SECRET_* env var is set", () => {
    process.env.AL_SECRET_anthropic_key__default__token = "sk-test";
    expect(hasEnvCredentials()).toBe(true);
  });

  it("returns true for any AL_SECRET_ prefixed key regardless of format", () => {
    process.env.AL_SECRET_anything = "value";
    expect(hasEnvCredentials()).toBe(true);
  });
});

// ─── loadCredentialsFromEnv ──────────────────────────────────────────────────

describe("credential-setup: loadCredentialsFromEnv()", { timeout: 10_000 }, () => {
  beforeEach(() => {
    // Clean up all AL_SECRET_* env vars before each test
    for (const k of Object.keys(process.env).filter((k) => k.startsWith("AL_SECRET_"))) {
      delete process.env[k];
    }
  });

  afterEach(() => {
    // Clean up all AL_SECRET_* env vars after each test
    for (const k of Object.keys(process.env).filter((k) => k.startsWith("AL_SECRET_"))) {
      delete process.env[k];
    }
  });

  it("returns empty bundle when no AL_SECRET_* vars are set", () => {
    const bundle = loadCredentialsFromEnv();
    expect(bundle).toEqual({});
  });

  it("parses a single AL_SECRET_type__instance__field entry", () => {
    process.env.AL_SECRET_anthropic_key__default__token = "sk-test-value";
    const bundle = loadCredentialsFromEnv();
    expect(bundle).toHaveProperty("anthropic_key");
    expect(bundle.anthropic_key).toHaveProperty("default");
    expect(bundle.anthropic_key.default).toHaveProperty("token", "sk-test-value");
  });

  it("parses multiple entries into correct nested structure", () => {
    process.env.AL_SECRET_anthropic_key__default__token = "sk-ant-123";
    process.env.AL_SECRET_github_token__default__token = "ghp-abc";
    process.env.AL_SECRET_git_ssh__mybot__id_rsa = "-----BEGIN RSA-----";
    process.env.AL_SECRET_git_ssh__mybot__username = "bot-user";

    const bundle = loadCredentialsFromEnv();
    expect(bundle.anthropic_key.default.token).toBe("sk-ant-123");
    expect(bundle.github_token.default.token).toBe("ghp-abc");
    expect(bundle.git_ssh.mybot.id_rsa).toBe("-----BEGIN RSA-----");
    expect(bundle.git_ssh.mybot.username).toBe("bot-user");
  });

  it("skips entries with wrong number of parts (not exactly 3 after splitting by __)", () => {
    // only 2 parts (type__instance) — missing field
    process.env.AL_SECRET_type__instance = "value";
    // 4 parts
    process.env.AL_SECRET_a__b__c__d = "value2";

    const bundle = loadCredentialsFromEnv();
    expect(bundle).toEqual({});
  });

  it("skips entries with empty/undefined values", () => {
    // Set key with empty value
    process.env.AL_SECRET_anthropic_key__default__token = "";
    const bundle = loadCredentialsFromEnv();
    expect(bundle).toEqual({});
  });
});

// ─── hasLocalCredentials ─────────────────────────────────────────────────────

describe("credential-setup: hasLocalCredentials()", { timeout: 10_000 }, () => {
  let savedCredPath: string | undefined;

  beforeEach(() => {
    savedCredPath = process.env.AL_CREDENTIALS_PATH;
  });

  afterEach(() => {
    if (savedCredPath === undefined) {
      delete process.env.AL_CREDENTIALS_PATH;
    } else {
      process.env.AL_CREDENTIALS_PATH = savedCredPath;
    }
  });

  it("returns false when AL_CREDENTIALS_PATH points to a nonexistent directory", () => {
    process.env.AL_CREDENTIALS_PATH = "/tmp/nonexistent-credentials-dir-" + Date.now();
    expect(hasLocalCredentials()).toBe(false);
  });

  it("returns false when AL_CREDENTIALS_PATH points to an empty directory", () => {
    const dir = makeTempDir();
    process.env.AL_CREDENTIALS_PATH = dir;
    expect(hasLocalCredentials()).toBe(false);
  });

  it("returns true when AL_CREDENTIALS_PATH directory has at least one entry", () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "anthropic_key"), { recursive: true });
    process.env.AL_CREDENTIALS_PATH = dir;
    expect(hasLocalCredentials()).toBe(true);
  });
});

// ─── loadCredentialsFromVolume ────────────────────────────────────────────────

describe("credential-setup: loadCredentialsFromVolume()", { timeout: 10_000 }, () => {
  let savedCredPath: string | undefined;

  beforeEach(() => {
    savedCredPath = process.env.AL_CREDENTIALS_PATH;
  });

  afterEach(() => {
    if (savedCredPath === undefined) {
      delete process.env.AL_CREDENTIALS_PATH;
    } else {
      process.env.AL_CREDENTIALS_PATH = savedCredPath;
    }
  });

  it("returns empty bundle for an empty credential directory", () => {
    const dir = makeTempDir();
    process.env.AL_CREDENTIALS_PATH = dir;
    const bundle = loadCredentialsFromVolume();
    expect(bundle).toEqual({});
  });

  it("reads a single credential (type/instance/field)", () => {
    const dir = makeTempDir();
    const tokenPath = join(dir, "anthropic_key", "default");
    mkdirSync(tokenPath, { recursive: true });
    writeFileSync(join(tokenPath, "token"), "sk-ant-test\n");

    process.env.AL_CREDENTIALS_PATH = dir;
    const bundle = loadCredentialsFromVolume();
    expect(bundle.anthropic_key.default.token).toBe("sk-ant-test");
  });

  it("reads multiple types, instances, and fields", () => {
    const dir = makeTempDir();

    const antPath = join(dir, "anthropic_key", "default");
    mkdirSync(antPath, { recursive: true });
    writeFileSync(join(antPath, "token"), "sk-ant-value");

    const ghPath = join(dir, "github_token", "default");
    mkdirSync(ghPath, { recursive: true });
    writeFileSync(join(ghPath, "token"), "ghp-value");

    const sshPath = join(dir, "git_ssh", "mybot");
    mkdirSync(sshPath, { recursive: true });
    writeFileSync(join(sshPath, "id_rsa"), "-----BEGIN RSA-----\nkey\n-----END RSA-----");
    writeFileSync(join(sshPath, "username"), "bot");
    writeFileSync(join(sshPath, "email"), "bot@example.com");

    process.env.AL_CREDENTIALS_PATH = dir;
    const bundle = loadCredentialsFromVolume();

    expect(bundle.anthropic_key.default.token).toBe("sk-ant-value");
    expect(bundle.github_token.default.token).toBe("ghp-value");
    expect(bundle.git_ssh.mybot.id_rsa).toBe("-----BEGIN RSA-----\nkey\n-----END RSA-----");
    expect(bundle.git_ssh.mybot.username).toBe("bot");
    expect(bundle.git_ssh.mybot.email).toBe("bot@example.com");
  });

  it("skips non-directory entries at the type level", () => {
    const dir = makeTempDir();
    // Create a file (not a directory) at the type level — should be skipped
    writeFileSync(join(dir, "not-a-dir"), "file content");

    // Also add a real credential
    const antPath = join(dir, "anthropic_key", "default");
    mkdirSync(antPath, { recursive: true });
    writeFileSync(join(antPath, "token"), "sk-val");

    process.env.AL_CREDENTIALS_PATH = dir;
    const bundle = loadCredentialsFromVolume();

    // The file should not appear as a key
    expect(bundle).not.toHaveProperty("not-a-dir");
    // The real credential should be present
    expect(bundle.anthropic_key.default.token).toBe("sk-val");
  });
});

// ─── GitEnvironment ──────────────────────────────────────────────────────────

describe("GitEnvironment (agents/git-environment.ts)", { timeout: 10_000 }, () => {
  let savedGitEnv: Record<string, string | undefined> = {};
  const GIT_ENV_KEYS = ["GIT_AUTHOR_NAME", "GIT_COMMITTER_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL"];

  beforeEach(() => {
    // Save and clear git env vars before each test
    for (const key of GIT_ENV_KEYS) {
      savedGitEnv[key] = process.env[key];
      delete process.env[key];
    }
    resetDefaultBackend();
  });

  afterEach(() => {
    // Restore git env vars after each test
    for (const key of GIT_ENV_KEYS) {
      if (savedGitEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedGitEnv[key];
      }
    }
    resetDefaultBackend();
  });

  it("can be constructed with a logger", () => {
    const logger = { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() };
    const env = new GitEnvironment(logger);
    expect(env).toBeDefined();
  });

  it("setup() with empty credentials saves current env and does not mutate git vars", async () => {
    const logger = { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() };
    const gitEnv = new GitEnvironment(logger);

    const saved = await gitEnv.setup([]);

    // Should have saved each key (all undefined since we cleared them)
    for (const key of GIT_ENV_KEYS) {
      expect(saved[key]).toBeUndefined();
    }

    // No env vars should have been set
    for (const key of GIT_ENV_KEYS) {
      expect(process.env[key]).toBeUndefined();
    }
  });

  it("setup() with git_ssh credential sets GIT_AUTHOR_NAME/EMAIL from credential store", async () => {
    // Set up a real credential via FilesystemBackend
    const credDir = makeTempDir();
    setDefaultBackend(new FilesystemBackend(credDir));
    await writeCredentialField("git_ssh", "default", "username", "test-bot");
    await writeCredentialField("git_ssh", "default", "email", "test-bot@example.com");

    const logger = { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() };
    const gitEnv = new GitEnvironment(logger);

    const saved = await gitEnv.setup(["git_ssh"]);

    // Saved values should be undefined (we cleared them in beforeEach)
    expect(saved.GIT_AUTHOR_NAME).toBeUndefined();
    expect(saved.GIT_AUTHOR_EMAIL).toBeUndefined();

    // After setup, env vars should be set from credential
    expect(process.env.GIT_AUTHOR_NAME).toBe("test-bot");
    expect(process.env.GIT_COMMITTER_NAME).toBe("test-bot");
    expect(process.env.GIT_AUTHOR_EMAIL).toBe("test-bot@example.com");
    expect(process.env.GIT_COMMITTER_EMAIL).toBe("test-bot@example.com");
  });

  it("setup() with non-git_ssh credential does not set git env vars", async () => {
    const logger = { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() };
    const gitEnv = new GitEnvironment(logger);

    await gitEnv.setup(["anthropic_key", "github_token"]);

    for (const key of GIT_ENV_KEYS) {
      expect(process.env[key]).toBeUndefined();
    }
  });

  it("restore() deletes keys whose saved value was undefined", () => {
    const logger = { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() };
    const gitEnv = new GitEnvironment(logger);

    // Set some env vars
    process.env.GIT_AUTHOR_NAME = "current-value";
    process.env.GIT_AUTHOR_EMAIL = "current@example.com";

    // Restore with undefined saves (should delete the keys)
    gitEnv.restore({
      GIT_AUTHOR_NAME: undefined,
      GIT_COMMITTER_NAME: undefined,
      GIT_AUTHOR_EMAIL: undefined,
      GIT_COMMITTER_EMAIL: undefined,
    });

    expect(process.env.GIT_AUTHOR_NAME).toBeUndefined();
    expect(process.env.GIT_AUTHOR_EMAIL).toBeUndefined();
  });

  it("restore() restores keys whose saved value was defined", () => {
    const logger = { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() };
    const gitEnv = new GitEnvironment(logger);

    // Override env vars
    process.env.GIT_AUTHOR_NAME = "new-name";
    process.env.GIT_AUTHOR_EMAIL = "new@example.com";

    // Restore with original values
    gitEnv.restore({
      GIT_AUTHOR_NAME: "original-name",
      GIT_COMMITTER_NAME: "original-committer",
      GIT_AUTHOR_EMAIL: "original@example.com",
      GIT_COMMITTER_EMAIL: "original-committer@example.com",
    });

    expect(process.env.GIT_AUTHOR_NAME).toBe("original-name");
    expect(process.env.GIT_COMMITTER_NAME).toBe("original-committer");
    expect(process.env.GIT_AUTHOR_EMAIL).toBe("original@example.com");
    expect(process.env.GIT_COMMITTER_EMAIL).toBe("original-committer@example.com");
  });

  it("setup() then restore() is a complete roundtrip — leaves env unchanged", async () => {
    // Set some initial git env vars
    process.env.GIT_AUTHOR_NAME = "original-author";
    process.env.GIT_AUTHOR_EMAIL = "author@example.com";

    const logger = { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() };
    const gitEnv = new GitEnvironment(logger);

    // Setup with no credentials (but saves current values)
    const saved = await gitEnv.setup([]);

    // Simulate some change (as would happen with git_ssh cred)
    process.env.GIT_AUTHOR_NAME = "modified-author";

    // Restore should bring back originals
    gitEnv.restore(saved);

    expect(process.env.GIT_AUTHOR_NAME).toBe("original-author");
    expect(process.env.GIT_AUTHOR_EMAIL).toBe("author@example.com");
  });
});

// ─── shared/git.ts ───────────────────────────────────────────────────────────

describe("shared/git.ts utility functions", { timeout: 10_000 }, () => {
  describe("sshUrl()", () => {
    it("returns correct SSH URL for owner and repo", () => {
      const url = sshUrl("MyOrg", "my-repo");
      expect(url).toBe("git@github.com:MyOrg/my-repo.git");
    });

    it("handles owner with hyphens and underscores", () => {
      const url = sshUrl("my-org_2", "cool.repo");
      expect(url).toBe("git@github.com:my-org_2/cool.repo.git");
    });

    it("always uses github.com domain", () => {
      const url = sshUrl("x", "y");
      expect(url).toContain("git@github.com:");
      expect(url.endsWith(".git")).toBe(true);
    });
  });

  describe("gitExec()", () => {
    it("executes a simple command and returns trimmed stdout", () => {
      const result = gitExec("echo hello-world");
      expect(result).toBe("hello-world");
    });

    it("returns output with leading/trailing whitespace trimmed", () => {
      // printf includes trailing newline which should be trimmed
      const result = gitExec("printf   hello");
      expect(result).toBe("hello");
    });

    it("throws on non-zero exit code", () => {
      expect(() => gitExec("false")).toThrow();
    });

    it("runs command in the specified cwd", () => {
      // 'pwd' should return /tmp when cwd=/tmp
      const result = gitExec("pwd", "/tmp");
      expect(result).toBe("/tmp");
    });
  });
});
