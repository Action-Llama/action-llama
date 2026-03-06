import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml";

// Mock inquirer prompts
const mockSelect = vi.fn();
const mockInput = vi.fn();
const mockConfirm = vi.fn();
vi.mock("@inquirer/prompts", () => ({
  select: (...args: any[]) => mockSelect(...args),
  input: (...args: any[]) => mockInput(...args),
  confirm: (...args: any[]) => mockConfirm(...args),
}));

// Mock remote backends
const mockList = vi.fn().mockResolvedValue([]);
const mockWrite = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../src/shared/remote.js", () => ({
  createLocalBackend: () => ({ list: mockList }),
  createBackendFromCloudConfig: () => Promise.resolve({ write: mockWrite }),
}));

// Mock doctor's reconcileCloudIam
vi.mock("../../../src/cli/commands/doctor.js", () => ({
  reconcileCloudIam: vi.fn().mockResolvedValue(undefined),
}));

// Mock cloud-teardown
const mockTeardownCloud = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../src/cli/commands/cloud-teardown.js", () => ({
  teardownCloud: (...args: any[]) => mockTeardownCloud(...args),
}));

import { execute } from "../../../src/cli/commands/cloud-setup.js";

describe("cloud setup", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = mkdtempSync(join(tmpdir(), "al-cloud-setup-"));
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({ local: { enabled: true } }));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes [cloud] section for cloud-run provider", async () => {
    mockSelect.mockResolvedValueOnce("cloud-run");
    mockInput
      .mockResolvedValueOnce("my-project")     // gcpProject
      .mockResolvedValueOnce("us-central1")     // region
      .mockResolvedValueOnce("us-central1-docker.pkg.dev/my-project/al-images") // artifactRegistry
      .mockResolvedValueOnce("al-runner@my-project.iam.gserviceaccount.com")    // serviceAccount
      .mockResolvedValueOnce("action-llama");   // secretPrefix

    await execute({ project: tmpDir });

    const config = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
    expect(config.cloud.provider).toBe("cloud-run");
    expect(config.cloud.gcpProject).toBe("my-project");
    expect(config.cloud.region).toBe("us-central1");
    expect(config.local.enabled).toBe(true); // preserved
  });

  it("writes [cloud] section for ecs provider", async () => {
    mockSelect.mockResolvedValueOnce("ecs");
    mockInput
      .mockResolvedValueOnce("us-east-1")       // awsRegion
      .mockResolvedValueOnce("al-cluster")       // ecsCluster
      .mockResolvedValueOnce("123.dkr.ecr.us-east-1.amazonaws.com/al") // ecrRepository
      .mockResolvedValueOnce("arn:aws:iam::123:role/exec")  // executionRoleArn
      .mockResolvedValueOnce("arn:aws:iam::123:role/task")  // taskRoleArn
      .mockResolvedValueOnce("subnet-abc")       // subnets
      .mockResolvedValueOnce("")                 // securityGroups
      .mockResolvedValueOnce("action-llama");    // secretPrefix

    await execute({ project: tmpDir });

    const config = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
    expect(config.cloud.provider).toBe("ecs");
    expect(config.cloud.awsRegion).toBe("us-east-1");
    expect(config.cloud.ecsCluster).toBe("al-cluster");
    expect(config.cloud.subnets).toEqual(["subnet-abc"]);
  });

  it("prompts to teardown existing cloud config before re-configuring", async () => {
    // Write existing cloud config
    writeFileSync(
      resolve(tmpDir, "config.toml"),
      stringifyTOML({ local: { enabled: true }, cloud: { provider: "cloud-run", gcpProject: "old" } })
    );

    // Confirm teardown
    mockConfirm.mockResolvedValueOnce(true);

    // Then proceed with new setup
    mockSelect.mockResolvedValueOnce("ecs");
    mockInput
      .mockResolvedValueOnce("us-east-1")
      .mockResolvedValueOnce("al-cluster")
      .mockResolvedValueOnce("123.dkr.ecr.us-east-1.amazonaws.com/al")
      .mockResolvedValueOnce("arn:aws:iam::123:role/exec")
      .mockResolvedValueOnce("arn:aws:iam::123:role/task")
      .mockResolvedValueOnce("subnet-abc")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("action-llama");

    await execute({ project: tmpDir });

    expect(mockTeardownCloud).toHaveBeenCalledWith(
      resolve(tmpDir),
      expect.objectContaining({ provider: "cloud-run", gcpProject: "old" })
    );

    const config = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
    expect(config.cloud.provider).toBe("ecs");
  });

  it("aborts when user declines teardown and declines overwrite", async () => {
    writeFileSync(
      resolve(tmpDir, "config.toml"),
      stringifyTOML({ local: { enabled: true }, cloud: { provider: "cloud-run", gcpProject: "old" } })
    );

    mockConfirm
      .mockResolvedValueOnce(false)   // don't teardown
      .mockResolvedValueOnce(false);  // don't continue

    await execute({ project: tmpDir });

    expect(mockTeardownCloud).not.toHaveBeenCalled();
    // Config should be unchanged
    const config = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
    expect(config.cloud.provider).toBe("cloud-run");
  });
});
