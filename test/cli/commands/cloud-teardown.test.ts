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

// Mock child_process (still needed for gcloud CLI calls)
const mockExecFileSync = vi.fn().mockReturnValue("");
vi.mock("child_process", () => ({
  execFileSync: (...args: any[]) => mockExecFileSync(...args),
}));

// Mock config discovery
const mockDiscoverAgents = vi.fn();
vi.mock("../../../src/shared/config.js", () => ({
  discoverAgents: (...args: any[]) => mockDiscoverAgents(...args),
}));

// Mock AWS SDK clients
const mockStsSend = vi.fn();
const mockIamSend = vi.fn();

vi.mock("@aws-sdk/client-sts", () => ({
  STSClient: vi.fn().mockImplementation(function () { this.send = mockStsSend; }),
  GetCallerIdentityCommand: vi.fn().mockImplementation(function (input: any) { Object.assign(this, { _type: "GetCallerIdentity", input }); }),
}));

vi.mock("@aws-sdk/client-iam", () => ({
  IAMClient: vi.fn().mockImplementation(function () { this.send = mockIamSend; }),
  DeleteRolePolicyCommand: vi.fn().mockImplementation(function (input: any) { Object.assign(this, { _type: "DeleteRolePolicy", input }); }),
  DeleteRoleCommand: vi.fn().mockImplementation(function (input: any) { Object.assign(this, { _type: "DeleteRole", input }); }),
}));

import { execute } from "../../../src/cli/commands/cloud-teardown.js";

describe("cloud teardown", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = mkdtempSync(join(tmpdir(), "al-cloud-teardown-"));
    mockStsSend.mockResolvedValue({});
    mockIamSend.mockResolvedValue({});
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

    // Should have called IAM SDK to delete role policy and delete role
    const deletePolicyCalls = mockIamSend.mock.calls.filter(
      (call: any[]) => call[0]?._type === "DeleteRolePolicy"
    );
    const deleteRoleCalls = mockIamSend.mock.calls.filter(
      (call: any[]) => call[0]?._type === "DeleteRole"
    );
    expect(deletePolicyCalls).toHaveLength(1);
    expect(deleteRoleCalls).toHaveLength(1);

    // Should NOT have called aws CLI
    const awsCalls = mockExecFileSync.mock.calls.filter(
      (call: any[]) => call[0] === "aws"
    );
    expect(awsCalls).toHaveLength(0);

    // [cloud] should be removed from config
    const config = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
    expect(config.cloud).toBeUndefined();
  });
});
