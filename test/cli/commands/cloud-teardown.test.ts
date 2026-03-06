import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml";

// Mock inquirer prompts
const mockConfirm = vi.fn();
vi.mock("@inquirer/prompts", () => ({
  confirm: (...args: any[]) => mockConfirm(...args),
}));

// Mock child_process (gcloud/aws CLI calls)
const mockExecFileSync = vi.fn().mockReturnValue("");
vi.mock("child_process", () => ({
  execFileSync: (...args: any[]) => mockExecFileSync(...args),
}));

// Mock config discovery
const mockDiscoverAgents = vi.fn();
vi.mock("../../../src/shared/config.js", () => ({
  discoverAgents: (...args: any[]) => mockDiscoverAgents(...args),
}));

import { execute } from "../../../src/cli/commands/cloud-teardown.js";

describe("cloud teardown", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = mkdtempSync(join(tmpdir(), "al-cloud-teardown-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does nothing if no config.toml exists", async () => {
    await execute({ project: tmpDir });
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("does nothing if no [cloud] section exists", async () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({ local: { enabled: true } }));

    await execute({ project: tmpDir });
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("aborts when user declines confirmation", async () => {
    writeFileSync(
      resolve(tmpDir, "config.toml"),
      stringifyTOML({ local: { enabled: true }, cloud: { provider: "cloud-run", gcpProject: "my-proj" } })
    );

    mockConfirm.mockResolvedValueOnce(false);
    await execute({ project: tmpDir });

    // Config should be unchanged
    const config = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
    expect(config.cloud.provider).toBe("cloud-run");
  });

  it("tears down GCP service accounts and removes [cloud] from config", async () => {
    writeFileSync(
      resolve(tmpDir, "config.toml"),
      stringifyTOML({ local: { enabled: true }, cloud: { provider: "cloud-run", gcpProject: "my-proj" } })
    );

    mockConfirm.mockResolvedValueOnce(true);
    mockDiscoverAgents.mockReturnValue(["dev", "reviewer"]);

    await execute({ project: tmpDir });

    // Should have called gcloud to delete service accounts
    const deleteCalls = mockExecFileSync.mock.calls.filter(
      (call: any[]) => call[0] === "gcloud" && call[1]?.includes("delete")
    );
    expect(deleteCalls).toHaveLength(2);

    // [cloud] should be removed from config
    const config = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
    expect(config.cloud).toBeUndefined();
    expect(config.local.enabled).toBe(true); // preserved
  });

  it("tears down AWS task roles and removes [cloud] from config", async () => {
    writeFileSync(
      resolve(tmpDir, "config.toml"),
      stringifyTOML({
        local: { enabled: true },
        cloud: { provider: "ecs", awsRegion: "us-east-1", ecrRepository: "123.dkr.ecr.us-east-1.amazonaws.com/al" },
      })
    );

    mockConfirm.mockResolvedValueOnce(true);
    mockDiscoverAgents.mockReturnValue(["dev"]);

    await execute({ project: tmpDir });

    // Should have called aws to delete role policy then delete role
    const awsCalls = mockExecFileSync.mock.calls.filter(
      (call: any[]) => call[0] === "aws" && (call[1]?.includes("delete-role") || call[1]?.includes("delete-role-policy"))
    );
    expect(awsCalls.length).toBeGreaterThanOrEqual(1);

    // [cloud] should be removed from config
    const config = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
    expect(config.cloud).toBeUndefined();
  });
});
