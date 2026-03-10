import { describe, it, expect, vi, beforeEach } from "vitest";
import { LambdaRuntime } from "../../src/docker/lambda-runtime.js";
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
const mockLambdaSend = vi.fn();
const mockSmSend = vi.fn();
const mockLogsSend = vi.fn();
const mockCbSend = vi.fn();
const mockS3Send = vi.fn();
const mockEcrSend = vi.fn();

vi.mock("@aws-sdk/client-lambda", () => {
  const LambdaClient = vi.fn(function (this: any) { this.send = mockLambdaSend; });
  const GetFunctionCommand = vi.fn(function (this: any, input: any) { this._type = "GetFunction"; this.input = input; });
  const CreateFunctionCommand = vi.fn(function (this: any, input: any) { this._type = "CreateFunction"; this.input = input; });
  const UpdateFunctionCodeCommand = vi.fn(function (this: any, input: any) { this._type = "UpdateFunctionCode"; this.input = input; });
  const UpdateFunctionConfigurationCommand = vi.fn(function (this: any, input: any) { this._type = "UpdateFunctionConfiguration"; this.input = input; });
  const InvokeCommand = vi.fn(function (this: any, input: any) { this._type = "Invoke"; this.input = input; });
  const PutFunctionEventInvokeConfigCommand = vi.fn(function (this: any, input: any) { this._type = "PutFunctionEventInvokeConfig"; this.input = input; });
  return { LambdaClient, GetFunctionCommand, CreateFunctionCommand, UpdateFunctionCodeCommand, UpdateFunctionConfigurationCommand, InvokeCommand, PutFunctionEventInvokeConfigCommand };
});

vi.mock("@aws-sdk/client-secrets-manager", () => {
  const SecretsManagerClient = vi.fn(function (this: any) { this.send = mockSmSend; });
  const ListSecretsCommand = vi.fn(function (this: any, input: any) { this._type = "ListSecrets"; this.input = input; });
  const GetSecretValueCommand = vi.fn(function (this: any, input: any) { this._type = "GetSecretValue"; this.input = input; });
  return { SecretsManagerClient, ListSecretsCommand, GetSecretValueCommand };
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
  return { ECRClient, BatchGetImageCommand };
});

vi.mock("child_process", () => ({
  execFileSync: vi.fn((_cmd: string, _args: string[]) => ""),
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return { ...actual, createReadStream: vi.fn(() => "mock-stream") };
});

const defaultConfig = {
  awsRegion: "us-east-1",
  ecrRepository: "123456789012.dkr.ecr.us-east-1.amazonaws.com/al-images",
  secretPrefix: "action-llama",
};

describe("LambdaRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("implements ContainerRuntime interface", () => {
    const runtime: ContainerRuntime = new LambdaRuntime(defaultConfig);
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

  it("prepareCredentials maps to secrets-manager strategy", async () => {
    const runtime = new LambdaRuntime(defaultConfig);

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
    }
  });

  it("creates new Lambda function when it does not exist", async () => {
    const runtime = new LambdaRuntime(defaultConfig);

    // Mock: no secrets needed (empty creds)
    const creds = { strategy: "secrets-manager" as const, mounts: [] };

    // GetFunction → not found
    mockLambdaSend.mockRejectedValueOnce({ name: "ResourceNotFoundException" });

    // CreateFunction
    mockLambdaSend.mockResolvedValueOnce({});

    // PutFunctionEventInvokeConfig
    mockLambdaSend.mockResolvedValueOnce({});

    // GetFunction for waitForFunctionReady → active
    mockLambdaSend.mockResolvedValueOnce({
      Configuration: { State: "Active", LastUpdateStatus: "Successful" },
    });

    // Invoke
    mockLambdaSend.mockResolvedValueOnce({
      $metadata: { requestId: "req-123" },
    });

    const id = await runtime.launch({
      image: "123456789012.dkr.ecr.us-east-1.amazonaws.com/al-images:test",
      agentName: "fast-agent",
      env: { PROMPT: "test", TIMEOUT_SECONDS: "300" },
      credentials: creds,
    });

    expect(id).toContain("lambda:al-fast-agent:");

    // Verify CreateFunctionCommand was called
    const { CreateFunctionCommand } = await import("@aws-sdk/client-lambda");
    const createCalls = vi.mocked(CreateFunctionCommand).mock.calls;
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0][0].FunctionName).toBe("al-fast-agent");
    expect(createCalls[0][0].PackageType).toBe("Image");
    expect(createCalls[0][0].Timeout).toBe(300);
    expect(createCalls[0][0].ImageConfig).toEqual({
      EntryPoint: ["node", "/app/dist/agents/lambda-handler.js"],
    });
  });

  it("updates existing Lambda function", async () => {
    const runtime = new LambdaRuntime(defaultConfig);
    const creds = { strategy: "secrets-manager" as const, mounts: [] };

    // GetFunction → exists
    mockLambdaSend.mockResolvedValueOnce({
      Configuration: { State: "Active" },
    });

    // UpdateFunctionCode
    mockLambdaSend.mockResolvedValueOnce({});

    // GetFunction for waitForFunctionReady after code update
    mockLambdaSend.mockResolvedValueOnce({
      Configuration: { State: "Active", LastUpdateStatus: "Successful" },
    });

    // UpdateFunctionConfiguration
    mockLambdaSend.mockResolvedValueOnce({});

    // PutFunctionEventInvokeConfig
    mockLambdaSend.mockResolvedValueOnce({});

    // GetFunction for waitForFunctionReady after config update
    mockLambdaSend.mockResolvedValueOnce({
      Configuration: { State: "Active", LastUpdateStatus: "Successful" },
    });

    // Invoke
    mockLambdaSend.mockResolvedValueOnce({
      $metadata: { requestId: "req-456" },
    });

    const id = await runtime.launch({
      image: "123456789012.dkr.ecr.us-east-1.amazonaws.com/al-images:test",
      agentName: "existing-agent",
      env: { PROMPT: "test", TIMEOUT_SECONDS: "600" },
      credentials: creds,
    });

    expect(id).toContain("lambda:al-existing-agent:");

    // Verify UpdateFunctionCodeCommand and UpdateFunctionConfigurationCommand were called
    const { UpdateFunctionCodeCommand, UpdateFunctionConfigurationCommand } = await import("@aws-sdk/client-lambda");
    expect(vi.mocked(UpdateFunctionCodeCommand).mock.calls).toHaveLength(1);
    expect(vi.mocked(UpdateFunctionConfigurationCommand).mock.calls).toHaveLength(1);
    expect(vi.mocked(UpdateFunctionConfigurationCommand).mock.calls[0][0].Timeout).toBe(600);
    expect(vi.mocked(UpdateFunctionConfigurationCommand).mock.calls[0][0].ImageConfig).toEqual({
      EntryPoint: ["node", "/app/dist/agents/lambda-handler.js"],
    });
  });

  it("caps timeout at LAMBDA_MAX_TIMEOUT (900s)", async () => {
    const runtime = new LambdaRuntime(defaultConfig);
    const creds = { strategy: "secrets-manager" as const, mounts: [] };

    // GetFunction → not found
    mockLambdaSend.mockRejectedValueOnce({ name: "ResourceNotFoundException" });
    // CreateFunction
    mockLambdaSend.mockResolvedValueOnce({});
    // PutFunctionEventInvokeConfig
    mockLambdaSend.mockResolvedValueOnce({});
    // waitForFunctionReady
    mockLambdaSend.mockResolvedValueOnce({
      Configuration: { State: "Active", LastUpdateStatus: "Successful" },
    });
    // Invoke
    mockLambdaSend.mockResolvedValueOnce({
      $metadata: { requestId: "req-789" },
    });

    await runtime.launch({
      image: "123456789012.dkr.ecr.us-east-1.amazonaws.com/al-images:test",
      agentName: "test-agent",
      env: { PROMPT: "test", TIMEOUT_SECONDS: "1200" },
      credentials: creds,
    });

    const { CreateFunctionCommand } = await import("@aws-sdk/client-lambda");
    expect(vi.mocked(CreateFunctionCommand).mock.calls[0][0].Timeout).toBe(900);
  });

  it("derives per-agent Lambda role from ECR account ID", async () => {
    const runtime = new LambdaRuntime(defaultConfig);
    const creds = { strategy: "secrets-manager" as const, mounts: [] };

    // GetFunction → not found
    mockLambdaSend.mockRejectedValueOnce({ name: "ResourceNotFoundException" });
    // CreateFunction
    mockLambdaSend.mockResolvedValueOnce({});
    // PutFunctionEventInvokeConfig
    mockLambdaSend.mockResolvedValueOnce({});
    // waitForFunctionReady
    mockLambdaSend.mockResolvedValueOnce({
      Configuration: { State: "Active", LastUpdateStatus: "Successful" },
    });
    // Invoke
    mockLambdaSend.mockResolvedValueOnce({
      $metadata: { requestId: "req-role" },
    });

    await runtime.launch({
      image: "123456789012.dkr.ecr.us-east-1.amazonaws.com/al-images:test",
      agentName: "my-agent",
      env: { PROMPT: "test", TIMEOUT_SECONDS: "300" },
      credentials: creds,
    });

    const { CreateFunctionCommand } = await import("@aws-sdk/client-lambda");
    const calls = vi.mocked(CreateFunctionCommand).mock.calls;
    expect(calls[0][0].Role).toBe("arn:aws:iam::123456789012:role/al-my-agent-lambda-role");
  });

  it("uses explicit lambdaRoleArn when provided", async () => {
    const runtime = new LambdaRuntime({
      ...defaultConfig,
      lambdaRoleArn: "arn:aws:iam::123456789012:role/custom-role",
    });
    const creds = { strategy: "secrets-manager" as const, mounts: [] };

    mockLambdaSend.mockRejectedValueOnce({ name: "ResourceNotFoundException" });
    mockLambdaSend.mockResolvedValueOnce({}); // CreateFunction
    mockLambdaSend.mockResolvedValueOnce({}); // PutFunctionEventInvokeConfig
    mockLambdaSend.mockResolvedValueOnce({
      Configuration: { State: "Active", LastUpdateStatus: "Successful" },
    });
    mockLambdaSend.mockResolvedValueOnce({
      $metadata: { requestId: "req-custom" },
    });

    await runtime.launch({
      image: "test-image",
      agentName: "test",
      env: { PROMPT: "test", TIMEOUT_SECONDS: "300" },
      credentials: creds,
    });

    const { CreateFunctionCommand } = await import("@aws-sdk/client-lambda");
    expect(vi.mocked(CreateFunctionCommand).mock.calls[0][0].Role).toBe(
      "arn:aws:iam::123456789012:role/custom-role"
    );
  });

  it("isAgentRunning always returns false", async () => {
    const runtime = new LambdaRuntime(defaultConfig);
    expect(await runtime.isAgentRunning("any")).toBe(false);
  });

  it("listRunningAgents returns empty array", async () => {
    const runtime = new LambdaRuntime(defaultConfig);
    expect(await runtime.listRunningAgents()).toEqual([]);
  });

  it("kill is a no-op", async () => {
    const runtime = new LambdaRuntime(defaultConfig);
    await runtime.kill("lambda:func:req");
    // Should not throw
  });

  it("remove is a no-op", async () => {
    const runtime = new LambdaRuntime(defaultConfig);
    await runtime.remove("lambda:func:req");
  });

  it("cleanupCredentials is a no-op", () => {
    const runtime = new LambdaRuntime(defaultConfig);
    runtime.cleanupCredentials({ strategy: "secrets-manager", mounts: [] });
  });

  it("getTaskUrl returns Lambda console URL", () => {
    const runtime = new LambdaRuntime(defaultConfig);
    const url = runtime.getTaskUrl("lambda:al-my-agent:req-123");
    expect(url).toBe(
      "https://us-east-1.console.aws.amazon.com/lambda/home?region=us-east-1#/functions/al-my-agent"
    );
  });

  it("resolves secrets and passes as env vars during launch", async () => {
    const runtime = new LambdaRuntime(defaultConfig);

    // prepareCredentials returns mounts
    mockSmSend.mockResolvedValueOnce({
      SecretList: [{ Name: "action-llama/github_token/default/token" }],
    });
    const creds = await runtime.prepareCredentials(["github_token:default"]);

    // resolveSecretValues: listSecretFields + getSecretValue
    mockSmSend.mockResolvedValueOnce({
      SecretList: [{ Name: "action-llama/github_token/default/token" }],
    });
    mockSmSend.mockResolvedValueOnce({
      SecretString: "ghp_fake123",
    });

    // Lambda API calls
    mockLambdaSend.mockRejectedValueOnce({ name: "ResourceNotFoundException" });
    mockLambdaSend.mockResolvedValueOnce({}); // CreateFunction
    mockLambdaSend.mockResolvedValueOnce({}); // PutFunctionEventInvokeConfig
    mockLambdaSend.mockResolvedValueOnce({
      Configuration: { State: "Active", LastUpdateStatus: "Successful" },
    });
    mockLambdaSend.mockResolvedValueOnce({
      $metadata: { requestId: "req-secrets" },
    });

    await runtime.launch({
      image: "test-image",
      agentName: "test",
      env: { PROMPT: "test", TIMEOUT_SECONDS: "300" },
      credentials: creds,
    });

    // Verify the CreateFunction call includes the secret env var
    const { CreateFunctionCommand } = await import("@aws-sdk/client-lambda");
    const envVars = vi.mocked(CreateFunctionCommand).mock.calls[0][0].Environment?.Variables;
    expect(envVars).toHaveProperty("AL_SECRET_github_token__default__token", "ghp_fake123");
  });
});
