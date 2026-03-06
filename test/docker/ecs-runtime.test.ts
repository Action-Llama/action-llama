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

// Mock fetch for AWS API calls
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock child_process for aws cli and docker
vi.mock("child_process", () => ({
  execFileSync: vi.fn((_cmd: string, _args: string[]) => ""),
}));

// Set AWS credentials for tests
process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
process.env.AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

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

    // Mock the Secrets Manager ListSecrets API
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        SecretList: [
          { Name: "action-llama/github_token/default/token" },
        ],
      }),
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

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        SecretList: [
          { Name: "myapp/github_token/default/token" },
        ],
      }),
    });

    const creds = await runtime.prepareCredentials(["github_token:default"]);
    if (creds.strategy === "secrets-manager") {
      expect(creds.mounts[0].secretId).toBe("myapp/github_token/default/token");
    }
  });

  it("prepareCredentials handles multiple credential refs", async () => {
    const runtime = new ECSFargateRuntime(defaultConfig);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        SecretList: [
          { Name: "action-llama/github_token/default/token" },
        ],
      }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        SecretList: [
          { Name: "action-llama/git_ssh/default/id_rsa" },
          { Name: "action-llama/git_ssh/default/username" },
        ],
      }),
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

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await runtime.kill(taskArn);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://ecs.us-east-1.amazonaws.com/");
    expect(opts.method).toBe("POST");
    expect(opts.headers["X-Amz-Target"]).toContain("StopTask");
    expect(opts.body).toContain(taskArn);
  });

  it("derives per-agent task role ARN from ECR repo account ID", async () => {
    const runtime = new ECSFargateRuntime(defaultConfig);

    // Mock Secrets Manager (no secrets)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ SecretList: [] }),
    });

    // Mock RegisterTaskDefinition
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        taskDefinition: { taskDefinitionArn: "arn:aws:ecs:us-east-1:123456789012:task-definition/al-dev:1" },
      }),
    });

    // Mock RunTask
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        tasks: [{ taskArn: "arn:aws:ecs:us-east-1:123456789012:task/al-cluster/abc123" }],
      }),
    });

    const creds = await runtime.prepareCredentials(["anthropic_key:default"]);
    await runtime.launch({
      image: "123456789012.dkr.ecr.us-east-1.amazonaws.com/al-images:al-dev-latest",
      agentName: "dev",
      env: { PROMPT: "test" },
      credentials: creds,
    });

    // Check the RegisterTaskDefinition call includes the per-agent task role
    const registerCall = mockFetch.mock.calls.find(
      (c) => c[1]?.headers?.["X-Amz-Target"]?.includes("RegisterTaskDefinition")
    );
    expect(registerCall).toBeTruthy();
    const body = JSON.parse(registerCall![1].body);
    expect(body.taskRoleArn).toBe("arn:aws:iam::123456789012:role/al-dev-task-role");
  });
});
