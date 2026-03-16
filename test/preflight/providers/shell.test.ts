import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { shellProvider } from "../../../src/preflight/providers/shell.js";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { PreflightContext } from "../../../src/preflight/schema.js";

let tmpDir: string;

function makeCtx(env?: Record<string, string>): PreflightContext {
  return {
    env: { ...process.env, ...env } as Record<string, string>,
    logger: () => {},
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "al-preflight-shell-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("shell provider", () => {
  it("runs a command", async () => {
    const output = join(tmpDir, "out.txt");
    await shellProvider.run(
      { command: "echo hello", output },
      makeCtx(),
    );
    expect(readFileSync(output, "utf-8")).toBe("hello\n");
  });

  it("interpolates env vars in command", async () => {
    const output = join(tmpDir, "out.txt");
    await shellProvider.run(
      { command: "echo ${MY_VAR}", output },
      makeCtx({ MY_VAR: "world" }),
    );
    expect(readFileSync(output, "utf-8")).toBe("world\n");
  });

  it("creates parent directories for output", async () => {
    const output = join(tmpDir, "sub", "dir", "out.txt");
    await shellProvider.run(
      { command: "echo nested", output },
      makeCtx(),
    );
    expect(existsSync(output)).toBe(true);
  });

  it("throws on missing command", async () => {
    await expect(shellProvider.run({}, makeCtx())).rejects.toThrow(/requires a 'command' param/);
  });

  it("throws on command failure", async () => {
    await expect(
      shellProvider.run({ command: "exit 1" }, makeCtx()),
    ).rejects.toThrow();
  });

  it("runs without output param (no capture)", async () => {
    // Should not throw — just runs command
    await shellProvider.run({ command: "true" }, makeCtx());
  });
});
