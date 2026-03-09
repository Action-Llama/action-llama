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
  sanitizeEnvPart: (part: string) => part.replace(/[^a-zA-Z0-9_]/g, (ch: string) =>
    `_x${ch.charCodeAt(0).toString(16).padStart(2, "0")}`),
}));

// Mock AWS SDK clients
const mockEcsSend = vi.fn();
const mockSmSend = vi.fn();
const mockLogsSend = vi.fn();
const mockCbSend = vi.fn();
const mockS3Send = vi.fn();
const mockEcrSend = vi.fn();

vi.mock("@aws-sdk/client-ecs", () => {
  const ECSClient = vi.fn(function (this: any) { this.send = mockEcsSend; });
  const RegisterTaskDefinitionCommand = vi.fn(function (this: any, input: any) { this._type = "RegisterTaskDefinition"; this.input = input; });
  const RunTaskCommand = vi.fn(function (this: any, input: any) { this._type = "RunTask"; this.input = input; });
  const DescribeTasksCommand = vi.fn(function (this: any, input: any) { this._type = "DescribeTasks"; this.input = input; });
  const StopTaskCommand = vi.fn(function (this: any, input: any) { this._type = "StopTask"; this.input = input; });
  const ListTasksCommand = vi.fn(function (this: any, input: any) { this._type = "ListTasks"; this.input = input; });
  return { ECSClient, RegisterTaskDefinitionCommand, RunTaskCommand, DescribeTasksCommand, StopTaskCommand, ListTasksCommand };
});

vi.mock("@aws-sdk/client-secrets-manager", () => {
  const SecretsManagerClient = vi.fn(function (this: any) { this.send = mockSmSend; });
  const ListSecretsCommand = vi.fn(function (this: any, input: any) { this._type = "ListSecrets"; this.input = input; });
  return { SecretsManagerClient, ListSecretsCommand };
});

vi.mock("@aws-sdk/client-cloudwatch-logs", () => {
  const CloudWatchLogsClient = vi.fn(function (this: any) { this.send = mockLogsSend; });
  const GetLogEventsCommand = vi.fn(function (this: any, input: any) { this._type = "GetLogEvents"; this.input = input; });
  const FilterLogEventsCommand = vi.fn(function (this: any, input: any) { this._type = "FilterLogEvents"; this.input = input; });
  const CreateLogGroupCommand = vi.fn(function (this: any, input: any) { this._type = "CreateLogGroup"; this.input = input; });
  return { CloudWatchLogsClient, GetLogEventsCommand, FilterLogEventsCommand, CreateLogGroupCommand };
});

vi.mock("@aws-sdk/client-codebuild", () => {
  const CodeBuildClient = vi.fn(function (this: any) { this.send = mockCbSend; });
  const StartBuildCommand = vi.fn(function (this: any, input: any) { this._type = "StartBuild"; this.input = input; });
  const BatchGetBuildsCommand = vi.fn(function (this: any, input: any) { this._type = "BatchGetBuilds"; this.input = input; });
  const CreateProjectCommand = vi.fn(function (this: any, input: any) { this._type = "CreateProject"; this.input = input; });
  return { CodeBuildClient, StartBuildCommand, BatchGetBuildsCommand, CreateProjectCommand };
});

vi.mock("@aws-sdk/client-s3", () => {
  const S3Client = vi.fn(function (this: any) { this.send = mockS3Send; });
  const PutObjectCommand = vi.fn(function (this: any, input: any) { this._type = "PutObject"; this.input = input; });
  const CreateBucketCommand = vi.fn(function (this: any, input: any) { this._type = "CreateBucket"; this.input = input; });
  const HeadBucketCommand = vi.fn(function (this: any, input: any) { this._type = "HeadBucket"; this.input = input; });
  return { S3Client, PutObjectCommand, CreateBucketCommand, HeadBucketCommand };
});

vi.mock("@aws-sdk/client-ecr", () => {
  const ECRClient = vi.fn(function (this: any) { this.send = mockEcrSend; });
  const BatchGetImageCommand = vi.fn(function (this: any, input: any) { this._type = "BatchGetImage"; this.input = input; });
  const PutImageCommand = vi.fn(function (this: any, input: any) { this._type = "PutImage"; this.input = input; });
  const GetAuthorizationTokenCommand = vi.fn(function (this: any, input: any) { this._type = "GetAuthorizationToken"; this.input = input; });
  return { ECRClient, BatchGetImageCommand, PutImageCommand, GetAuthorizationTokenCommand };
});

// Mock child_process for tar commands
vi.mock("child_process", () => ({
  execFileSync: vi.fn((_cmd: string, _args: string[]) => ""),
}));

// Mock fs for createReadStream
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return { ...actual, createReadStream: vi.fn(() => "mock-stream") };
});

// Helpers for buildImage test
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

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
      reason: "action-llama timeout",
    });
  });

  it("buildImage with baseImage rewrite hashes temp Dockerfile before cleanup", async () => {
    const runtime = new ECSFargateRuntime(defaultConfig);

    // Set up a real temp context dir with the files buildImage expects
    const contextDir = mkdtempSync(join(tmpdir(), "al-build-test-"));
    writeFileSync(join(contextDir, "Dockerfile"), "FROM al-agent:latest\nRUN echo hello\n");
    writeFileSync(join(contextDir, "package.json"), '{"name":"test"}');
    mkdirSync(join(contextDir, "dist"));
    writeFileSync(join(contextDir, "dist", "index.js"), "console.log('hi')");

    // Mock S3 HeadBucket (ensureBuildBucket)
    mockS3Send.mockResolvedValueOnce({});

    // Mock ECR BatchGetImage — image exists (cache hit), so we skip the actual CodeBuild
    mockEcrSend.mockResolvedValueOnce({
      images: [{ imageId: { imageTag: "cached" } }],
    });

    // This would throw ENOENT before the fix because the temp Dockerfile
    // was deleted before hashing
    const tag = await runtime.buildImage({
      tag: "al-dev:latest",
      dockerfile: "Dockerfile",
      contextDir,
      baseImage: "123456789012.dkr.ecr.us-east-1.amazonaws.com/al-images:base",
    });

    expect(tag).toContain("123456789012.dkr.ecr.us-east-1.amazonaws.com/al-images:");
  });

  it("derives per-agent task role ARN from ECR repo account ID", async () => {
    const runtime = new ECSFargateRuntime(defaultConfig);

    // Mock Secrets Manager — no secrets for anthropic_key
    mockSmSend.mockResolvedValueOnce({ SecretList: [] });

    // Mock CreateLogGroup (ensureLogGroup)
    mockLogsSend.mockResolvedValueOnce({});

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
