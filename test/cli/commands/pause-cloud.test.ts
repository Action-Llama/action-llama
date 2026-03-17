import { describe, it, expect, afterEach, vi } from "vitest";
import { rmSync } from "fs";
import { makeTmpProject, captureLog } from "../../helpers.js";

const mockGetSchedulerStatus = vi.fn().mockResolvedValue(null);

vi.mock("../../../src/cloud/provider.js", () => ({
  createCloudProvider: vi.fn().mockImplementation(async () => ({
    getSchedulerStatus: mockGetSchedulerStatus,
  })),
}));

const mockCloudGatewayFetch = vi.fn();
vi.mock("../../../src/cli/cloud-gateway-client.js", () => ({
  cloudGatewayFetch: (...args: unknown[]) => mockCloudGatewayFetch(...args),
}));

const { execute } = await import("../../../src/cli/commands/pause.js");

describe("pause --cloud", () => {
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

  it("pauses entire scheduler via cloud gateway", async () => {
    tmpDir = makeCloudProject();

    mockGetSchedulerStatus.mockResolvedValueOnce({
      serviceUrl: "https://scheduler.example.com",
      status: "RUNNING",
    });
    mockCloudGatewayFetch.mockResolvedValueOnce({
      ok: true,
      data: { message: "Scheduler paused." },
    });

    const output = await captureLog(() =>
      execute(undefined, { project: tmpDir, cloud: true })
    );

    expect(mockCloudGatewayFetch).toHaveBeenCalledWith(
      "https://scheduler.example.com",
      expect.objectContaining({ path: "/control/pause", method: "POST" }),
    );
    expect(output).toContain("Scheduler paused.");
  });

  it("pauses a specific agent via cloud gateway", async () => {
    tmpDir = makeCloudProject();

    mockGetSchedulerStatus.mockResolvedValueOnce({
      serviceUrl: "https://scheduler.example.com",
      status: "RUNNING",
    });
    mockCloudGatewayFetch.mockResolvedValueOnce({
      ok: true,
      data: { message: "Agent dev paused." },
    });

    const output = await captureLog(() =>
      execute("dev", { project: tmpDir, cloud: true })
    );

    expect(mockCloudGatewayFetch).toHaveBeenCalledWith(
      "https://scheduler.example.com",
      expect.objectContaining({ path: "/control/agents/dev/pause", method: "POST" }),
    );
    expect(output).toContain("Agent dev paused.");
  });

  it("throws when scheduler is not deployed", async () => {
    tmpDir = makeCloudProject();
    mockGetSchedulerStatus.mockResolvedValueOnce(null);

    await expect(
      execute(undefined, { project: tmpDir, cloud: true })
    ).rejects.toThrow("Cloud scheduler is not deployed.");
  });

  it("throws when no [cloud] config", async () => {
    tmpDir = makeTmpProject();

    await expect(
      execute(undefined, { project: tmpDir, cloud: true })
    ).rejects.toThrow("No [cloud] section found in config.toml");
  });

  it("throws on gateway error response", async () => {
    tmpDir = makeCloudProject();

    mockGetSchedulerStatus.mockResolvedValueOnce({
      serviceUrl: "https://scheduler.example.com",
      status: "RUNNING",
    });
    mockCloudGatewayFetch.mockResolvedValueOnce({
      ok: false,
      data: { error: "Agent not found" },
    });

    await expect(
      execute("nonexistent", { project: tmpDir, cloud: true })
    ).rejects.toThrow("Agent not found");
  });
});
