import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the runtime constructors as classes
const mockEcsRuntime = { launch: vi.fn(), buildImage: vi.fn() };
const mockLambdaRuntime = { launch: vi.fn(), buildImage: vi.fn() };

vi.mock("../../../src/docker/ecs-runtime.js", () => ({
  ECSFargateRuntime: class { constructor() { return mockEcsRuntime; } },
}));

vi.mock("../../../src/docker/lambda-runtime.js", () => ({
  LambdaRuntime: class { constructor() { return mockLambdaRuntime; } },
}));

vi.mock("../../../src/shared/asm-backend.js", () => ({
  AwsSecretsManagerBackend: class {
    read = vi.fn();
    write = vi.fn();
    list = vi.fn().mockResolvedValue([]);
  },
}));

import { AwsCloudProvider } from "../../../src/cloud/aws/provider.js";
import type { EcsCloudConfig } from "../../../src/shared/config.js";

const testConfig: EcsCloudConfig = {
  provider: "ecs",
  awsRegion: "us-east-1",
  ecsCluster: "al-cluster",
  ecrRepository: "123456789012.dkr.ecr.us-east-1.amazonaws.com/al-images",
  executionRoleArn: "arn:aws:iam::123456789012:role/al-ecs-execution-role",
  taskRoleArn: "arn:aws:iam::123456789012:role/al-default-task-role",
  subnets: ["subnet-abc123"],
};

describe("AwsCloudProvider", () => {
  let provider: AwsCloudProvider;

  beforeEach(() => {
    provider = new AwsCloudProvider(testConfig);
  });

  it("has correct providerName", () => {
    expect(provider.providerName).toBe("ecs");
  });

  it("createRuntime returns an ECS runtime", () => {
    const runtime = provider.createRuntime();
    expect(runtime).toBe(mockEcsRuntime);
  });

  it("createAgentRuntime returns Lambda runtime for short-timeout agents", () => {
    const agentConfig = {
      name: "test-agent",
      credentials: [],
      model: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" as const },
      timeout: 300,
    };
    const globalConfig = {};

    const runtime = provider.createAgentRuntime(agentConfig, globalConfig);
    expect(runtime).toBe(mockLambdaRuntime);
  });

  it("createAgentRuntime returns ECS runtime for long-timeout agents", () => {
    const agentConfig = {
      name: "test-agent",
      credentials: [],
      model: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" as const },
      timeout: 1800,
    };
    const globalConfig = {};

    const runtime = provider.createAgentRuntime(agentConfig, globalConfig);
    expect(runtime).toBe(mockEcsRuntime);
  });

  it("createRuntimes returns overrides for short-timeout agents", () => {
    const agents = [
      { name: "short", credentials: [], model: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" as const }, timeout: 300 },
      { name: "long", credentials: [], model: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" as const }, timeout: 1800 },
    ];

    const result = provider.createRuntimes(agents, {});
    expect(result.runtime).toBe(mockEcsRuntime);
    expect(result.agentRuntimeOverrides["short"]).toBe(mockLambdaRuntime);
    expect(result.agentRuntimeOverrides["long"]).toBeUndefined();
  });

  it("createCredentialBackend returns ASM backend", async () => {
    const backend = await provider.createCredentialBackend();
    expect(backend).toBeDefined();
    expect(backend.read).toBeDefined();
  });
});
