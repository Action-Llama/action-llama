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
    const labels: Record<string, any> = {
      github_token: { label: "GitHub Token" },
      anthropic_key: { label: "Anthropic API Key" },
      github_webhook_secret: { label: "GitHub Webhook Secret" },
      git_ssh: { label: "Git SSH Key" },
    };
    return labels[id];
  },
  listBuiltinCredentialIds: () => ["github_token", "anthropic_key", "github_webhook_secret", "git_ssh"],
}));

// Mock the prompter
const mockPromptCredential = vi.fn();
vi.mock("../../../src/credentials/prompter.js", () => ({
  promptCredential: (...args: any[]) => mockPromptCredential(...args),
}));

import { list, add, rm } from "../../../src/cli/commands/creds.js";

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
