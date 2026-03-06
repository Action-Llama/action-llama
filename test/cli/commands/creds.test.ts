import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

// Mock CREDENTIALS_DIR to use a temp directory
let tmpDir: string;
vi.mock("../../../src/shared/paths.js", () => ({
  get CREDENTIALS_DIR() {
    return tmpDir;
  },
}));

import { list } from "../../../src/cli/commands/creds.js";

describe("creds ls", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-creds-"));
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

  it("lists credential types, instances, and field names", async () => {
    // Create github_token/default/token
    const dir1 = resolve(tmpDir, "github_token", "default");
    mkdirSync(dir1, { recursive: true });
    writeFileSync(resolve(dir1, "token"), "secret-value");

    // Create github_webhook_secret/myapp/secret
    const dir2 = resolve(tmpDir, "github_webhook_secret", "myapp");
    mkdirSync(dir2, { recursive: true });
    writeFileSync(resolve(dir2, "secret"), "another-secret");

    await list();

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("github_token");
    expect(output).toContain("(token)");
    expect(output).toContain("github_webhook_secret:myapp");
    expect(output).toContain("(secret)");
    // Should NOT contain actual secret values
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

  it("lists multiple instances of the same type", async () => {
    for (const instance of ["default", "staging", "prod"]) {
      const dir = resolve(tmpDir, "github_webhook_secret", instance);
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, "secret"), "val");
    }

    await list();

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("github_webhook_secret");
    expect(output).toContain("github_webhook_secret:staging");
    expect(output).toContain("github_webhook_secret:prod");
  });
});
