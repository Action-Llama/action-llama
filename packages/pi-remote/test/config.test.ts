import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadRemotesConfig, RemoteNotConfiguredError } from "../src/config.js";

describe("loadRemotesConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-remote-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads remotes.json from CWD", () => {
    const config = {
      defaultRemote: "dev",
      remotes: {
        dev: { type: "container", container: "my-dev" },
      },
    };
    writeFileSync(join(tmpDir, "remotes.json"), JSON.stringify(config));

    const result = loadRemotesConfig(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.defaultRemote).toBe("dev");
    expect(result!.remotes.dev.type).toBe("container");
    expect(result!.remotes.dev.container).toBe("my-dev");
  });

  it("loads remotes.json from CWD/.pi/", () => {
    mkdirSync(join(tmpDir, ".pi"), { recursive: true });
    const config = {
      remotes: {
        box: { type: "ssh", host: "10.0.0.1", user: "alice" },
      },
    };
    writeFileSync(join(tmpDir, ".pi", "remotes.json"), JSON.stringify(config));

    const result = loadRemotesConfig(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.remotes.box.type).toBe("ssh");
    expect(result!.remotes.box.host).toBe("10.0.0.1");
  });

  it("prefers CWD/remotes.json over CWD/.pi/remotes.json", () => {
    // Create both
    writeFileSync(join(tmpDir, "remotes.json"), JSON.stringify({
      remotes: { a: { type: "host-user", user: "from-cwd" } },
    }));
    mkdirSync(join(tmpDir, ".pi"), { recursive: true });
    writeFileSync(join(tmpDir, ".pi", "remotes.json"), JSON.stringify({
      remotes: { b: { type: "host-user", user: "from-dot-pi" } },
    }));

    const result = loadRemotesConfig(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.remotes.a).toBeDefined();
    expect(result!.remotes.b).toBeUndefined();
  });

  it("returns null when not found and required is false", () => {
    const result = loadRemotesConfig(tmpDir);
    expect(result).toBeNull();
  });

  it("throws RemoteNotConfiguredError when required and not found", () => {
    expect(() => loadRemotesConfig(tmpDir, { required: true }))
      .toThrow(RemoteNotConfiguredError);
  });

  it("throws on invalid type", () => {
    writeFileSync(join(tmpDir, "remotes.json"), JSON.stringify({
      remotes: { bad: { type: "ftp" } },
    }));

    expect(() => loadRemotesConfig(tmpDir)).toThrow("type");
  });

  it("throws on invalid JSON", () => {
    writeFileSync(join(tmpDir, "remotes.json"), "not json");
    expect(() => loadRemotesConfig(tmpDir)).toThrow();
  });

  it("handles empty remotes object", () => {
    writeFileSync(join(tmpDir, "remotes.json"), JSON.stringify({ remotes: {} }));
    const result = loadRemotesConfig(tmpDir);
    expect(result).not.toBeNull();
    expect(Object.keys(result!.remotes)).toHaveLength(0);
  });
});
