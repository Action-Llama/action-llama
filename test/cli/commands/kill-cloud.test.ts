import { describe, it, expect, afterEach, vi } from "vitest";
import { rmSync } from "fs";
import { makeTmpProject, captureLog } from "../../helpers.js";

const mockListRunningAgents = vi.fn().mockResolvedValue([]);
const mockKill = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../src/cloud/provider.js", () => ({
  createCloudProvider: vi.fn().mockImplementation(async () => ({
    createRuntime: () => ({
      listRunningAgents: mockListRunningAgents,
      kill: mockKill,
    }),
  })),
}));

const { execute } = await import("../../../src/cli/commands/kill.js");

describe("kill --env (cloud)", () => {
  let tmpDir: string;

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  function makeCloudProject() {
    return makeTmpProject({
      global: {
        cloud: {
          provider: "ecs",
          awsRegion: "us-east-1",
          ecsCluster: "test-cluster",
          ecrRepository: "test-repo",
          executionRoleArn: "arn:aws:iam::123:role/exec",
          taskRoleArn: "arn:aws:iam::123:role/task",
          subnets: ["subnet-abc"],
        },
      },
    });
  }

  it("kills all instances by agent name", async () => {
    tmpDir = makeCloudProject();

    mockListRunningAgents.mockResolvedValueOnce([
      {
        agentName: "dev",
        taskId: "abc123",
        runtimeId: "arn:aws:ecs:us-east-1:123:task/cluster/abc123",
        status: "RUNNING",
      },
      {
        agentName: "dev",
        taskId: "def456",
        runtimeId: "arn:aws:ecs:us-east-1:123:task/cluster/def456",
        status: "RUNNING",
      },
    ]);

    const output = await captureLog(() =>
      execute("dev", { project: tmpDir })
    );

    expect(mockKill).toHaveBeenCalledTimes(2);
    expect(mockKill).toHaveBeenCalledWith("arn:aws:ecs:us-east-1:123:task/cluster/abc123");
    expect(mockKill).toHaveBeenCalledWith("arn:aws:ecs:us-east-1:123:task/cluster/def456");
    expect(output).toContain('Killed 2 instance(s) of agent "dev".');
  });

  it("kills a specific instance by task ID", async () => {
    tmpDir = makeCloudProject();

    mockListRunningAgents.mockResolvedValueOnce([
      {
        agentName: "reviewer",
        taskId: "8acdf32fa2c2405488c63bc55880192e",
        runtimeId: "arn:aws:ecs:us-east-1:123:task/cluster/8acdf32fa2c2405488c63bc55880192e",
        status: "RUNNING",
      },
    ]);

    const output = await captureLog(() =>
      execute("8acdf32fa2c2405488c63bc55880192e", { project: tmpDir })
    );

    expect(mockKill).toHaveBeenCalledTimes(1);
    expect(mockKill).toHaveBeenCalledWith("arn:aws:ecs:us-east-1:123:task/cluster/8acdf32fa2c2405488c63bc55880192e");
    expect(output).toContain("Killed instance 8acdf32fa2c2405488c63bc55880192e.");
  });

  it("throws when target not found", async () => {
    tmpDir = makeCloudProject();

    mockListRunningAgents.mockResolvedValueOnce([]);

    await expect(
      execute("nonexistent", { project: tmpDir })
    ).rejects.toThrow('No running cloud instances found matching "nonexistent".');

    expect(mockKill).not.toHaveBeenCalled();
  });

  it("falls through to local mode when no cloud config", async () => {
    tmpDir = makeTmpProject();

    // Without cloud config, it tries local gateway which fails (no gateway running)
    await expect(
      execute("dev", { project: tmpDir })
    ).rejects.toThrow();
  });
});
