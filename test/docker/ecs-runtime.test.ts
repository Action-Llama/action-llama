import { describe, it, expect, vi, beforeEach } from "vitest";
import { ECSFargateRuntime } from "../../src/docker/ecs-runtime.js";
import type { ContainerRuntime } from "../../src/docker/runtime.js";

// Mock credentials module
vi.mock("../../src/shared/credentials.js", () => ({
  parseCredentialRef: (ref: string) => {
    const sep = ref.indexOf(":");
    if (sep === -1) return { type: ref, instance: "default" };
    return { type: ref.slice(0, sep).trim(), instance: ref.slice(sep + 1).trim() };
  },
}));

// Mock AWS SDK clients
const mockEcsSend = vi.fn();
const mockSmSend = vi.fn();
const mockLogsSend = vi.fn();
const mockEcrSend = vi.fn();

vi.mock("@aws-sdk/client-ecs", () => {
  const ECSClient = vi.fn(function (this: any) { this.send = mockEcsSend; });
  const RegisterTaskDefinitionCommand = vi.fn(function (this: any, input: any) { this._type = "RegisterTaskDefinition"; this.input = input; });
  const RunTaskCommand = vi.fn(function (this: any, input: any) { this._type = "RunTask"; this.input = input; });
  const DescribeTasksCommand = vi.fn(function (this: any, input: any) { this._type = "DescribeTasks"; this.input = input; });
  const StopTaskCommand = vi.fn(function (this: any, input: any) { this._type = "StopTask"; this.input = input; });
  return { ECSClient, RegisterTaskDefinitionCommand, RunTaskCommand, DescribeTasksCommand, StopTaskCommand };
});

vi.mock("@aws-sdk/client-secrets-manager", () => {
  const SecretsManagerClient = vi.fn(function (this: any) { this.send = mockSmSend; });
  const ListSecretsCommand = vi.fn(function (this: any, input: any) { this._type = "ListSecrets"; this.input = input; });
  return { SecretsManagerClient, ListSecretsCommand };
});

vi.mock("@aws-sdk/client-cloudwatch-logs", () => {
  const CloudWatchLogsClient = vi.fn(function (this: any) { this.send = mockLogsSend; });
  const GetLogEventsCommand = vi.fn(function (this: any, input: any) { this._type = "GetLogEvents"; this.input = input; });
  return { CloudWatchLogsClient, GetLogEventsCommand };
});

vi.mock("@aws-sdk/client-ecr", () => {
  const ECRClient = vi.fn(function (this: any) { this.send = mockEcrSend; });
  const GetAuthorizationTokenCommand = vi.fn(function (this: any, input: any) { this._type = "GetAuthorizationToken"; this.input = input; });
  return { ECRClient, GetAuthorizationTokenCommand };
});

// Mock child_process for docker commands
vi.mock("child_process", () => ({
  execFileSync: vi.fn((_cmd: string, _args: string[]) => ""),
}));

const defaultConfig = {
  awsRegion: "us-east-1",
  ecsCluster: "al-cluster",
  ecrRepository: "123456789012.dkr.ecr.us-east-1.amazonaws.com/al-images",
  executionRoleArn: "arn:aws:iam::123456789012:role/ecsTaskExecutionRole",
  taskRoleArn: "arn:aws:iam::123456789012:role/al-default-task-role",
  subnets: ["subnet-abc123"],
  securityGroups: ["sg-abc123"],
};

describe("ECSFargateRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("implements ContainerRuntime interface", () => {
    const runtime: ContainerRuntime = new ECSFargateRuntime(defaultConfig);
    expect(typeof runtime.launch).toBe("function");
    expect(typeof runtime.streamLogs).toBe("function");
    expect(typeof runtime.waitForExit).toBe("function");
    expect(typeof runtime.kill).toBe("function");
    expect(typeof runtime.remove).toBe("function");
    expect(typeof runtime.prepareCredentials).toBe("function");
    expect(typeof runtime.pushImage).toBe("function");
    expect(typeof runtime.buildImage).toBe("function");
    expect(typeof runtime.cleanupCredentials).toBe("function");
    expect(runtime.needsGateway).toBe(false);
  });

  it("prepareCredentials maps credential refs to AWS Secrets Manager names", async () => {
    const runtime = new ECSFargateRuntime(defaultConfig);

    mockSmSend.mockResolvedValueOnce({
      SecretList: [
        { Name: "action-llama/github_token/default/token" },
      ],
    });

    const creds = await runtime.prepareCredentials(["github_token:default"]);
    expect(creds.strategy).toBe("secrets-manager");
    if (creds.strategy === "secrets-manager") {
      expect(creds.mounts).toHaveLength(1);
      expect(creds.mounts[0].secretId).toBe("action-llama/github_token/default/token");
      expect(creds.mounts[0].mountPath).toBe("/credentials/github_token/default/token");
    }
  });

  it("prepareCredentials uses custom secret prefix", async () => {
    const runtime = new ECSFargateRuntime({ ...defaultConfig, secretPrefix: "myapp" });

    mockSmSend.mockResolvedValueOnce({
      SecretList: [
        { Name: "myapp/github_token/default/token" },
      ],
    });

    const creds = await runtime.prepareCredentials(["github_token:default"]);
    if (creds.strategy === "secrets-manager") {
      expect(creds.mounts[0].secretId).toBe("myapp/github_token/default/token");
    }
  });

  it("prepareCredentials handles multiple credential refs", async () => {
    const runtime = new ECSFargateRuntime(defaultConfig);

    mockSmSend.mockResolvedValueOnce({
      SecretList: [
        { Name: "action-llama/github_token/default/token" },
      ],
    });
    mockSmSend.mockResolvedValueOnce({
      SecretList: [
        { Name: "action-llama/git_ssh/default/id_rsa" },
        { Name: "action-llama/git_ssh/default/username" },
      ],
    });

    const creds = await runtime.prepareCredentials(["github_token:default", "git_ssh:default"]);
    if (creds.strategy === "secrets-manager") {
      expect(creds.mounts).toHaveLength(3);
      expect(creds.mounts.map((m) => m.mountPath)).toEqual([
        "/credentials/github_token/default/token",
        "/credentials/git_ssh/default/id_rsa",
        "/credentials/git_ssh/default/username",
      ]);
    }
  });

  it("cleanupCredentials is a no-op", () => {
    const runtime = new ECSFargateRuntime(defaultConfig);
    runtime.cleanupCredentials({ strategy: "secrets-manager", mounts: [] });
  });

  it("remove is a no-op", async () => {
    const runtime = new ECSFargateRuntime(defaultConfig);
    await runtime.remove("arn:aws:ecs:us-east-1:123456789012:task/al-cluster/abc123");
  });

  it("kill calls StopTask API", async () => {
    const runtime = new ECSFargateRuntime(defaultConfig);
    const taskArn = "arn:aws:ecs:us-east-1:123456789012:task/al-cluster/abc123";

    mockEcsSend.mockResolvedValueOnce({});

    await runtime.kill(taskArn);

    expect(mockEcsSend).toHaveBeenCalledTimes(1);

    const { StopTaskCommand } = await import("@aws-sdk/client-ecs");
    const stopCalls = vi.mocked(StopTaskCommand).mock.calls;
    expect(stopCalls).toHaveLength(1);
    expect(stopCalls[0][0]).toEqual({
      cluster: "al-cluster",
      task: taskArn,
      reason: "Action Llama timeout",
    });
  });

  it("derives per-agent task role ARN from ECR repo account ID", async () => {
    const runtime = new ECSFargateRuntime(defaultConfig);

    // Mock Secrets Manager — no secrets for anthropic_key
    mockSmSend.mockResolvedValueOnce({ SecretList: [] });

    // Mock RegisterTaskDefinition
    mockEcsSend.mockResolvedValueOnce({
      taskDefinition: { taskDefinitionArn: "arn:aws:ecs:us-east-1:123456789012:task-definition/al-dev:1" },
    });

    // Mock RunTask
    mockEcsSend.mockResolvedValueOnce({
      tasks: [{ taskArn: "arn:aws:ecs:us-east-1:123456789012:task/al-cluster/abc123" }],
    });

    const creds = await runtime.prepareCredentials(["anthropic_key:default"]);
    await runtime.launch({
      image: "123456789012.dkr.ecr.us-east-1.amazonaws.com/al-images:al-dev-latest",
      agentName: "dev",
      env: { PROMPT: "test" },
      credentials: creds,
    });

    // Verify RegisterTaskDefinitionCommand was constructed with the per-agent task role
    const { RegisterTaskDefinitionCommand } = await import("@aws-sdk/client-ecs");
    const registerCalls = vi.mocked(RegisterTaskDefinitionCommand).mock.calls;
    expect(registerCalls).toHaveLength(1);
    expect(registerCalls[0][0].taskRoleArn).toBe("arn:aws:iam::123456789012:role/al-dev-task-role");
  });
});
