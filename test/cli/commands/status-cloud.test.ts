import { describe, it, expect, afterEach, vi } from "vitest";
import { rmSync } from "fs";
import { makeTmpProject, captureLog } from "../../helpers.js";

const mockListRunningAgents = vi.fn().mockResolvedValue([]);
const mockGetSchedulerStatus = vi.fn().mockResolvedValue(null);

vi.mock("../../../src/cloud/provider.js", () => ({
  createCloudProvider: vi.fn().mockImplementation(async () => ({
    getSchedulerStatus: mockGetSchedulerStatus,
    createRuntime: () => ({
      listRunningAgents: mockListRunningAgents,
    }),
  })),
}));

// Must import after vi.mock
const { execute } = await import("../../../src/cli/commands/status.js");

describe("status cloud summary", () => {
  let tmpDir: string;

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  function makeCloudProject(agentOverrides?: Parameters<typeof makeTmpProject>[0]["agents"]) {
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
      agents: agentOverrides,
    });
  }

  it("shows agents table and scheduler status", async () => {
    tmpDir = makeCloudProject();

    mockGetSchedulerStatus.mockResolvedValueOnce({
      serviceUrl: "https://test.awsapprunner.com",
      status: "RUNNING",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    mockListRunningAgents.mockResolvedValueOnce([]);

    const output = await captureLog(() => execute({ project: tmpDir, cloud: true }));

    expect(output).toContain("AL Status");
    expect(output).toContain("Scheduler (ecs):");
    expect(output).toContain("Status: RUNNING");
    expect(output).toContain("URL:    https://test.awsapprunner.com");
    // Agents table
    expect(output).toContain("AGENT");
    expect(output).toContain("TRIGGER");
    expect(output).toContain("dev");
    expect(output).toContain("reviewer");
    expect(output).toContain("devops");
    expect(output).toContain("cron");
    expect(output).toContain("No running instances.");
  });

  it("shows running instances with trigger info", async () => {
    tmpDir = makeCloudProject();

    mockGetSchedulerStatus.mockResolvedValueOnce({
      serviceUrl: "https://test.awsapprunner.com",
      status: "RUNNING",
    });
    mockListRunningAgents.mockResolvedValueOnce([
      {
        agentName: "dev",
        taskId: "arn:aws:ecs:us-east-1:123:task/abc123",
        status: "RUNNING",
        startedAt: new Date("2026-01-15T10:00:00Z"),
        trigger: "schedule",
      },
      {
        agentName: "dev",
        taskId: "arn:aws:ecs:us-east-1:123:task/def456",
        status: "RUNNING",
        startedAt: new Date("2026-01-15T10:01:00Z"),
        trigger: "webhook (github)",
      },
    ]);

    const output = await captureLog(() => execute({ project: tmpDir, cloud: true }));

    // Agents table shows instance counts
    expect(output).toContain("2 running");
    // Running instances table with trigger
    expect(output).toContain("Running Instances:");
    expect(output).toContain("schedule");
    expect(output).toContain("webhook (github)");
    expect(output).toContain("arn:aws:ecs:us-east-1:123:task/abc123");
  });

  it("shows scheduler not deployed", async () => {
    tmpDir = makeCloudProject();

    mockGetSchedulerStatus.mockResolvedValueOnce(null);
    mockListRunningAgents.mockResolvedValueOnce([]);

    const output = await captureLog(() => execute({ project: tmpDir, cloud: true }));
    expect(output).toContain("Scheduler: not deployed");
  });
});

describe("status cloud per-agent detail", () => {
  let tmpDir: string;

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("shows config and filtered instances for a specific agent", async () => {
    tmpDir = makeTmpProject({
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
      agents: [
        {
          name: "dev",
          schedule: "*/10 * * * *",
          webhooks: [{ source: "github", events: ["issues.opened"] }],
        },
        { name: "reviewer" },
      ],
    });

    mockListRunningAgents.mockResolvedValueOnce([
      {
        agentName: "dev",
        taskId: "task-111",
        status: "RUNNING",
        startedAt: new Date("2026-01-15T10:00:00Z"),
        trigger: "schedule",
      },
      {
        agentName: "reviewer",
        taskId: "task-222",
        status: "RUNNING",
        startedAt: new Date("2026-01-15T10:05:00Z"),
        trigger: "schedule",
      },
    ]);

    const output = await captureLog(() =>
      execute({ project: tmpDir, cloud: true, agent: "dev" })
    );

    // Shows agent header and config
    expect(output).toContain("Agent: dev");
    expect(output).toContain("Schedule: */10 * * * *");
    expect(output).toContain("Webhooks:");
    expect(output).toContain("github: issues.opened");
    // Shows only dev's instance, not reviewer's
    expect(output).toContain("task-111");
    expect(output).not.toContain("task-222");
    // Does NOT show summary table header
    expect(output).not.toContain("AL Status");
  });

  it("shows no running instances for idle agent", async () => {
    tmpDir = makeTmpProject({
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

    mockListRunningAgents.mockResolvedValueOnce([]);

    const output = await captureLog(() =>
      execute({ project: tmpDir, cloud: true, agent: "devops" })
    );

    expect(output).toContain("Agent: devops");
    expect(output).toContain("Schedule: */15 * * * *");
    expect(output).toContain("No running instances.");
  });
});
