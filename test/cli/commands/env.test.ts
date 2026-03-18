import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import {
  writeEnvToml,
  loadEnvToml,
  writeEnvironmentConfig,
  loadEnvironmentConfig,
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

// Mock VPS SSH for readiness checks
const mockTestConnection = vi.fn();
const mockSshExec = vi.fn();
vi.mock("../../../src/cloud/vps/ssh.js", () => ({
  testConnection: (...args: any[]) => mockTestConnection(...args),
  sshExec: (...args: any[]) => mockSshExec(...args),
}));

// Mock VPS teardown
const mockTeardownVps = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../src/cloud/vps/teardown.js", () => ({
  teardownVps: (...args: any[]) => mockTeardownVps(...args),
}));

// Mock VPS provisioning
const mockSetupVpsCloud = vi.fn();
vi.mock("../../../src/cloud/vps/provision.js", () => ({
  setupVpsCloud: (...args: any[]) => mockSetupVpsCloud(...args),
}));

// Mock FilesystemBackend for credential-dependent checks
vi.mock("../../../src/shared/filesystem-backend.js", () => ({
  FilesystemBackend: class {
    read = () => Promise.resolve(undefined);
  },
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

  it("runs readiness checks when environment already has a real host", async () => {
    writeEnvironmentConfig(testEnvName, {
      server: { host: "1.2.3.4", user: "root" },
    });

    mockTestConnection.mockResolvedValue(true);
    mockSshExec.mockImplementation((_cfg: any, cmd: string) => {
      if (cmd.includes("node")) return Promise.resolve({ exitCode: 0, stdout: "v22.14.0", stderr: "" });
      return Promise.resolve({ exitCode: 0, stdout: "24.0.7", stderr: "" });
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await prov(testEnvName);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Checking readiness"));
    expect(mockTestConnection).toHaveBeenCalled();
    expect(mockSshExec).toHaveBeenCalledWith(
      expect.objectContaining({ host: "1.2.3.4" }),
      expect.stringContaining("node"),
    );
    logSpy.mockRestore();
    mockTestConnection.mockReset();
    mockSshExec.mockReset();
  });

  it("installs Node.js when not found on existing server", async () => {
    writeEnvironmentConfig(testEnvName, {
      server: { host: "1.2.3.4", user: "root" },
    });

    mockTestConnection.mockResolvedValue(true);
    let nodeCallCount = 0;
    mockSshExec.mockImplementation((_cfg: any, cmd: string) => {
      if (cmd.includes("node --version")) {
        nodeCallCount++;
        // First call: not found, second call (after install): found
        if (nodeCallCount === 1) return Promise.resolve({ exitCode: 127, stdout: "", stderr: "not found" });
        return Promise.resolve({ exitCode: 0, stdout: "v22.14.0", stderr: "" });
      }
      if (cmd.includes("nodesource")) return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
      return Promise.resolve({ exitCode: 0, stdout: "24.0.7", stderr: "" });
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await prov(testEnvName);

    // verifyEnvironment in fix mode installs Node.js and reports "fixed"
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("fixed"));
    expect(mockSshExec).toHaveBeenCalledWith(
      expect.objectContaining({ host: "1.2.3.4" }),
      expect.stringContaining("nodesource"),
      120_000,
    );
    logSpy.mockRestore();
    mockTestConnection.mockReset();
    mockSshExec.mockReset();
  });
});

describe("env prov persists provider fields", () => {
  const testEnvName = `test-prov-fields-${Date.now()}`;

  afterEach(() => {
    try { rmSync(environmentPath(testEnvName)); } catch {}
    mockSetupVpsCloud.mockReset();
  });

  it("persists hetznerServerId via onInstanceCreated callback (interrupted provisioning)", async () => {
    // Simulate setupVpsCloud calling onInstanceCreated then returning null (interrupted)
    mockSetupVpsCloud.mockImplementation(async (onInstanceCreated: Function) => {
      onInstanceCreated({
        provider: "vps",
        host: "PENDING",
        hetznerServerId: 99887766,
        hetznerLocation: "fsn1",
      });
      return null; // simulate Ctrl+C / failure before completion
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await prov(testEnvName);
    logSpy.mockRestore();

    // The environment file must contain the server ID so deprov can clean up
    const saved = loadEnvironmentConfig(testEnvName);
    expect(saved.server?.hetznerServerId).toBe(99887766);
    expect(saved.server?.hetznerLocation).toBe("fsn1");
  });

  it("persists hetznerServerId in final write after successful provisioning", async () => {
    mockSetupVpsCloud.mockImplementation(async (onInstanceCreated: Function) => {
      onInstanceCreated({
        provider: "vps",
        host: "PENDING",
        hetznerServerId: 11223344,
        hetznerLocation: "nbg1",
      });
      return {
        provider: "vps",
        host: "5.6.7.8",
        hetznerServerId: 11223344,
        hetznerLocation: "nbg1",
      };
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await prov(testEnvName);
    logSpy.mockRestore();

    const saved = loadEnvironmentConfig(testEnvName);
    expect(saved.server?.hetznerServerId).toBe(11223344);
    expect(saved.server?.hetznerLocation).toBe("nbg1");
    expect(saved.server?.host).toBe("5.6.7.8");
  });

  it("persists vultrInstanceId via onInstanceCreated callback (interrupted provisioning)", async () => {
    mockSetupVpsCloud.mockImplementation(async (onInstanceCreated: Function) => {
      onInstanceCreated({
        provider: "vps",
        host: "PENDING",
        vultrInstanceId: "vultr-abc-123",
        vultrRegion: "ewr",
      });
      return null;
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await prov(testEnvName);
    logSpy.mockRestore();

    const saved = loadEnvironmentConfig(testEnvName);
    expect(saved.server?.vultrInstanceId).toBe("vultr-abc-123");
    expect(saved.server?.vultrRegion).toBe("ewr");
  });

  it("persists Cloudflare fields via onInstanceCreated callback", async () => {
    mockSetupVpsCloud.mockImplementation(async (onInstanceCreated: Function) => {
      onInstanceCreated({
        provider: "vps",
        host: "PENDING",
        hetznerServerId: 55667788,
        cloudflareZoneId: "zone-abc",
        cloudflareDnsRecordId: "rec-xyz",
        cloudflareHostname: "agents.example.com",
      });
      return null;
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await prov(testEnvName);
    logSpy.mockRestore();

    const saved = loadEnvironmentConfig(testEnvName);
    expect(saved.server?.hetznerServerId).toBe(55667788);
    expect(saved.server?.cloudflareZoneId).toBe("zone-abc");
    expect(saved.server?.cloudflareDnsRecordId).toBe("rec-xyz");
    expect(saved.server?.cloudflareHostname).toBe("agents.example.com");
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

  it("passes Hetzner fields to teardownVps", async () => {
    writeEnvironmentConfig(testEnvName, {
      server: {
        host: "5.6.7.8",
        user: "root",
        hetznerServerId: 12345678,
        hetznerLocation: "nbg1",
      },
    });

    await deprov(testEnvName, { project: tmpDir });

    expect(mockTeardownVps).toHaveBeenCalledWith(
      tmpDir,
      expect.objectContaining({
        hetznerServerId: 12345678,
        hetznerLocation: "nbg1",
      }),
    );
  });

  it("passes Vultr fields to teardownVps", async () => {
    writeEnvironmentConfig(testEnvName, {
      server: {
        host: "1.2.3.4",
        user: "root",
        vultrInstanceId: "abc-123",
        vultrRegion: "ewr",
      },
    });

    await deprov(testEnvName, { project: tmpDir });

    expect(mockTeardownVps).toHaveBeenCalledWith(
      tmpDir,
      expect.objectContaining({
        vultrInstanceId: "abc-123",
        vultrRegion: "ewr",
      }),
    );
  });

  it("deletes environment file after teardown", async () => {
    writeEnvironmentConfig(testEnvName, {
      server: { host: "1.2.3.4" },
    });

    await deprov(testEnvName, { project: tmpDir });

    expect(environmentExists(testEnvName)).toBe(false);
  });
});
