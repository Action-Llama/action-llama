import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

// Set up global state for temp directory
(globalThis as any).__AL_TEST_TMPDIR = "/tmp/al-test-fallback";

// Mock CREDENTIALS_DIR to use a temp directory
vi.mock("../../../src/shared/paths.js", () => ({
  get CREDENTIALS_DIR() {
    return (globalThis as any).__AL_TEST_TMPDIR;
  },
}));

let tmpDir: string;

// Import the real FilesystemBackend to use in tests
import { FilesystemBackend } from "../../../src/shared/filesystem-backend.js";
import { setDefaultBackend } from "../../../src/shared/credentials.js";

// Mock the credential registry
vi.mock("../../../src/credentials/registry.js", () => ({
  resolveCredential: (id: string) => {
    const defs: Record<string, any> = {
      github_token: { id: "github_token", label: "GitHub Token", fields: [{ name: "token", label: "Token", description: "PAT", secret: true }] },
      anthropic_key: { id: "anthropic_key", label: "Anthropic API Key", fields: [{ name: "token", label: "API Key", description: "Key", secret: true }] },
      github_webhook_secret: { id: "github_webhook_secret", label: "GitHub Webhook Secret", fields: [{ name: "secret", label: "Secret", description: "HMAC", secret: true }] },
      git_ssh: { id: "git_ssh", label: "Git SSH Key", fields: [{ name: "id_rsa", label: "Private Key", description: "SSH key", secret: true }, { name: "username", label: "Username", description: "Git author", secret: false }, { name: "email", label: "Email", description: "Git email", secret: false }] },
    };
    if (!defs[id]) throw new Error(`Unknown credential "${id}".`);
    return defs[id];
  },
  getBuiltinCredential: (id: string) => {
    const defs: Record<string, any> = {
      github_token: { id: "github_token", label: "GitHub Token", description: "PAT for repo access", fields: [{ name: "token", label: "Token", description: "PAT", secret: true }] },
      anthropic_key: { id: "anthropic_key", label: "Anthropic API Key", description: "API key for Anthropic", fields: [{ name: "token", label: "API Key", description: "Key", secret: true }] },
      github_webhook_secret: { id: "github_webhook_secret", label: "GitHub Webhook Secret", description: "HMAC secret", fields: [{ name: "secret", label: "Secret", description: "HMAC", secret: true }] },
      git_ssh: {
        id: "git_ssh",
        label: "Git SSH Key",
        description: "SSH key for git",
        helpUrl: "https://docs.github.com/authentication",
        fields: [{ name: "id_rsa", label: "Private Key", description: "SSH key", secret: true }],
        envVars: { id_rsa: "GIT_SSH_KEY" },
        agentContext: "GIT_SSH_KEY env var",
      },
    };
    return defs[id];
  },
  listBuiltinCredentialIds: () => ["github_token", "anthropic_key", "github_webhook_secret", "git_ssh"],
}));

// Mock inquirer prompts (needed by types())
const mockSearch = vi.fn();
const mockConfirm = vi.fn();
vi.mock("@inquirer/prompts", () => ({
  search: (...args: any[]) => mockSearch(...args),
  confirm: (...args: any[]) => mockConfirm(...args),
}));

// Mock the prompter
const mockPromptCredential = vi.fn();
vi.mock("../../../src/credentials/prompter.js", () => ({
  promptCredential: (...args: any[]) => mockPromptCredential(...args),
}));

import { list, add, rm, types } from "../../../src/cli/commands/creds.js";

describe("creds ls", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-creds-"));
    (globalThis as any).__AL_TEST_TMPDIR = tmpDir;
    setDefaultBackend(new FilesystemBackend(tmpDir));
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("shows message when no credentials exist", async () => {
    rmSync(tmpDir, { recursive: true, force: true });
    await list();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No credentials found"));
  });

  it("groups credentials by type with label header", async () => {
    const dir1 = resolve(tmpDir, "github_token", "default");
    mkdirSync(dir1, { recursive: true });
    writeFileSync(resolve(dir1, "token"), "secret-value");

    const dir2 = resolve(tmpDir, "github_webhook_secret", "myapp");
    mkdirSync(dir2, { recursive: true });
    writeFileSync(resolve(dir2, "secret"), "another-secret");

    await list();

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    // Type headers
    expect(output).toContain("GitHub Token (github_token)");
    expect(output).toContain("GitHub Webhook Secret (github_webhook_secret)");
    // Instances indented under headers
    expect(output).toContain("    github_token  (token)");
    expect(output).toContain("    github_webhook_secret:myapp  (secret)");
    // No actual values
    expect(output).not.toContain("secret-value");
    expect(output).not.toContain("another-secret");
  });

  it("shows default instances without the :default suffix", async () => {
    const dir = resolve(tmpDir, "anthropic_key", "default");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "token"), "sk-xxx");

    await list();

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("anthropic_key");
    expect(output).not.toContain("anthropic_key:default");
  });

  it("lists multiple instances of the same type under one header", async () => {
    for (const instance of ["default", "staging", "prod"]) {
      const dir = resolve(tmpDir, "github_webhook_secret", instance);
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, "secret"), "val");
    }

    await list();

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    // One header
    expect(output).toContain("GitHub Webhook Secret (github_webhook_secret)");
    // Three instances
    expect(output).toContain("    github_webhook_secret  (secret)");
    expect(output).toContain("    github_webhook_secret:staging  (secret)");
    expect(output).toContain("    github_webhook_secret:prod  (secret)");
  });
});

describe("creds add", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = mkdtempSync(join(tmpdir(), "al-creds-"));
    (globalThis as any).__AL_TEST_TMPDIR = tmpDir;
    setDefaultBackend(new FilesystemBackend(tmpDir));
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("adds a new credential via prompter", async () => {
    mockPromptCredential.mockResolvedValue({ values: { token: "ghp_new" } });

    await add("github_token:default");

    expect(mockPromptCredential).toHaveBeenCalledOnce();
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain('Credential "github_token:default" saved');
    // Verify file was written
    expect(existsSync(resolve(tmpDir, "github_token", "default", "token"))).toBe(true);
    expect(readFileSync(resolve(tmpDir, "github_token", "default", "token"), "utf-8").trim()).toBe("ghp_new");
  });

  it("handles named instances", async () => {
    mockPromptCredential.mockResolvedValue({ values: { secret: "hmac123" } });

    await add("github_webhook_secret:myapp");

    expect(existsSync(resolve(tmpDir, "github_webhook_secret", "myapp", "secret"))).toBe(true);
  });

  it("defaults instance to default when not specified", async () => {
    mockPromptCredential.mockResolvedValue({ values: { token: "sk-test" } });

    await add("anthropic_key");

    expect(existsSync(resolve(tmpDir, "anthropic_key", "default", "token"))).toBe(true);
  });

  it("prints aborted when prompter returns undefined", async () => {
    mockPromptCredential.mockResolvedValue(undefined);

    await add("github_token");

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Aborted");
    expect(existsSync(resolve(tmpDir, "github_token", "default"))).toBe(false);
  });

  it("warns when credential already exists", async () => {
    const dir = resolve(tmpDir, "github_token", "default");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "token"), "old-value");

    mockPromptCredential.mockResolvedValue({ values: { token: "new-value" } });

    await add("github_token");

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("already exists");
    expect(output).toContain("saved");
  });

  it("exits with error for unknown credential type", async () => {
    await expect(add("fake_cred")).rejects.toThrow('Unknown credential type "fake_cred"');
  });
});

describe("creds rm", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-creds-"));
    (globalThis as any).__AL_TEST_TMPDIR = tmpDir;
    setDefaultBackend(new FilesystemBackend(tmpDir));
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("removes an existing credential", async () => {
    const dir = resolve(tmpDir, "github_token", "default");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "token"), "secret");

    await rm("github_token");

    expect(existsSync(dir)).toBe(false);
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain('Credential "github_token" removed');
  });

  it("removes a named instance without affecting others", async () => {
    for (const inst of ["default", "staging"]) {
      const dir = resolve(tmpDir, "github_webhook_secret", inst);
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, "secret"), "val");
    }

    await rm("github_webhook_secret:staging");

    expect(existsSync(resolve(tmpDir, "github_webhook_secret", "staging"))).toBe(false);
    expect(existsSync(resolve(tmpDir, "github_webhook_secret", "default", "secret"))).toBe(true);
  });

  it("cleans up empty type directory", async () => {
    const dir = resolve(tmpDir, "anthropic_key", "default");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "token"), "sk-xxx");

    await rm("anthropic_key");

    expect(existsSync(resolve(tmpDir, "anthropic_key"))).toBe(false);
  });

  it("exits with error when credential does not exist", async () => {
    await expect(rm("github_token:nonexistent")).rejects.toThrow("not found");
  });
});

describe("creds types", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("shows credential details after search selection", async () => {
    mockSearch.mockResolvedValueOnce("github_token");
    mockConfirm.mockResolvedValueOnce(false);

    await types();

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("GitHub Token");
    expect(output).toContain("github_token");
    expect(output).toContain("Fields: token");
  });

  it("calls add when user confirms", async () => {
    mockSearch.mockResolvedValueOnce("anthropic_key");
    mockConfirm.mockResolvedValueOnce(true);
    mockPromptCredential.mockResolvedValueOnce({ values: { token: "sk-test" } });

    tmpDir = mkdtempSync(join(tmpdir(), "al-creds-types-"));
    (globalThis as any).__AL_TEST_TMPDIR = tmpDir;
    setDefaultBackend(new FilesystemBackend(tmpDir));

    await types();

    expect(mockPromptCredential).toHaveBeenCalledOnce();
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("saved");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("shows helpUrl, envVars and agentContext when present on the credential", async () => {
    mockSearch.mockResolvedValueOnce("git_ssh");
    mockConfirm.mockResolvedValueOnce(false);

    await types();

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Git SSH Key");
    expect(output).toContain("Help: https://docs.github.com/authentication");
    expect(output).toContain("Env vars:");
    expect(output).toContain("GIT_SSH_KEY");
    expect(output).toContain("Agent context:");
  });

  it("source callback returns all choices for empty input and filtered choices for non-empty input", async () => {
    // Use a mock that calls the source function so we exercise the filtering logic
    let capturedSource: ((input: string | undefined) => any[]) | undefined;
    mockSearch.mockImplementationOnce(async (opts: any) => {
      capturedSource = opts.source;
      // Call source with no input (should return all choices)
      const allChoices = opts.source(undefined);
      expect(Array.isArray(allChoices)).toBe(true);
      expect(allChoices.length).toBeGreaterThan(0);
      // Call source with a filter
      const filtered = opts.source("github");
      expect(Array.isArray(filtered)).toBe(true);
      return "github_token";
    });
    mockConfirm.mockResolvedValueOnce(false);

    await types();

    expect(capturedSource).toBeDefined();
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("GitHub Token");
  });
});

describe("creds ls — additional edge cases", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-creds-edge-"));
    (globalThis as any).__AL_TEST_TMPDIR = tmpDir;
    setDefaultBackend(new FilesystemBackend(tmpDir));
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("shows 'no credentials' when CREDENTIALS_DIR exists but has no subdirectories", async () => {
    // Put only files (not dirs) in CREDENTIALS_DIR so entries.length === 0 after filter
    writeFileSync(resolve(tmpDir, "some-file.txt"), "not a dir");

    await list();

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("No credentials found");
  });

  it("skips type entries with no instance subdirectories", async () => {
    // Create a type dir with only a file inside (no instance subdirs) — instances.length === 0
    const typeDir = resolve(tmpDir, "github_token");
    mkdirSync(typeDir, { recursive: true });
    writeFileSync(resolve(typeDir, "not-a-subdir.txt"), "file");

    await list();

    // No credential header should appear because instances is empty
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).not.toContain("GitHub Token (github_token)");
  });

  it("returns false for broken symlinks in CREDENTIALS_DIR (statSync throws)", async () => {
    const { symlinkSync } = await import("fs");
    // Create a valid type dir with a real instance dir
    const typeDir = resolve(tmpDir, "github_token");
    const instanceDir = resolve(typeDir, "default");
    mkdirSync(instanceDir, { recursive: true });
    writeFileSync(resolve(instanceDir, "token"), "val");
    // Also add a broken symlink in CREDENTIALS_DIR → statSync will throw for it
    symlinkSync(resolve(tmpDir, "nonexistent-target"), resolve(tmpDir, "broken-link"));

    await list();

    // github_token should still be listed (broken-link is filtered out)
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("github_token");
    // broken-link should not appear as a type
    expect(output).not.toContain("broken-link");
  });

  it("returns false for broken symlinks inside a type dir (statSync throws for instance entry)", async () => {
    const { symlinkSync } = await import("fs");
    // Create a valid type dir with one real instance and one broken symlink instance
    const typeDir = resolve(tmpDir, "github_token");
    const instanceDir = resolve(typeDir, "default");
    mkdirSync(instanceDir, { recursive: true });
    writeFileSync(resolve(instanceDir, "token"), "val");
    // Broken symlink inside typeDir → statSync throws → filtered out
    symlinkSync(resolve(typeDir, "nonexistent-instance"), resolve(typeDir, "broken-instance-link"));

    await list();

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    // "default" instance should be listed
    expect(output).toContain("github_token");
    // "broken-instance-link" should not appear as an instance
    expect(output).not.toContain("broken-instance-link");
  });

  it("skips type when readdirSync throws for its directory (chmod 000)", async () => {
    const { chmodSync } = await import("fs");
    // Create two type dirs: one readable with data, one unreadable
    const goodTypeDir = resolve(tmpDir, "github_token");
    const goodInstanceDir = resolve(goodTypeDir, "default");
    mkdirSync(goodInstanceDir, { recursive: true });
    writeFileSync(resolve(goodInstanceDir, "token"), "val");

    const badTypeDir = resolve(tmpDir, "anthropic_key");
    mkdirSync(badTypeDir, { recursive: true });
    // Make badTypeDir unreadable so readdirSync throws
    chmodSync(badTypeDir, 0o000);

    await list();

    // Restore permissions so cleanup works
    chmodSync(badTypeDir, 0o755);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    // github_token should still appear
    expect(output).toContain("github_token");
    // anthropic_key should be skipped (continue was hit)
    expect(output).not.toContain("anthropic_key");
  });

  it("lists instance with empty fields when readdirSync throws for instance dir (chmod 000)", async () => {
    const { chmodSync } = await import("fs");
    // Create a type dir and an unreadable instance dir
    const typeDir = resolve(tmpDir, "github_token");
    const instanceDir = resolve(typeDir, "default");
    mkdirSync(instanceDir, { recursive: true });
    // Make instanceDir unreadable so readdirSync throws → fields = []
    chmodSync(instanceDir, 0o000);

    await list();

    // Restore permissions
    chmodSync(instanceDir, 0o755);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    // Instance should still be listed but with no fields
    expect(output).toContain("github_token  ()");
  });

  it("returns false for broken symlinks inside instance dir (statSync throws for field entry)", async () => {
    const { symlinkSync } = await import("fs");
    // Create a type dir with an instance that has a real file and a broken symlink
    const typeDir = resolve(tmpDir, "github_token");
    const instanceDir = resolve(typeDir, "default");
    mkdirSync(instanceDir, { recursive: true });
    writeFileSync(resolve(instanceDir, "token"), "val");
    // Broken symlink inside instanceDir → statSync throws → filtered out
    symlinkSync(resolve(instanceDir, "nonexistent-field"), resolve(instanceDir, "broken-field-link"));

    await list();

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    // "token" should be listed, but "broken-field-link" should not
    expect(output).toContain("token");
    expect(output).not.toContain("broken-field-link");
  });
});
