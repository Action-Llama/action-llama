import { describe, it, expect, vi, beforeEach } from "vitest";
import { captureLog } from "../../helpers.js";

// --- Mocks ---

const mockDiscoverAgents = vi.fn();
const mockLoadAgentConfig = vi.fn();
const mockLoadGlobalConfig = vi.fn();
vi.mock("../../../src/shared/config.js", () => ({
  discoverAgents: (...args: any[]) => mockDiscoverAgents(...args),
  loadAgentConfig: (...args: any[]) => mockLoadAgentConfig(...args),
  loadGlobalConfig: (...args: any[]) => mockLoadGlobalConfig(...args),
}));

vi.mock("../../../src/shared/credentials.js", () => ({
  parseCredentialRef: (ref: string) => {
    const sep = ref.indexOf(":");
    if (sep === -1) return { type: ref, instance: "default" };
    return { type: ref.slice(0, sep).trim(), instance: ref.slice(sep + 1).trim() };
  },
}));

const mockExecFileSync = vi.fn();
vi.mock("child_process", () => ({
  execFileSync: (...args: any[]) => mockExecFileSync(...args),
}));

const mockConfirm = vi.fn();
vi.mock("@inquirer/prompts", () => ({
  confirm: (...args: any[]) => mockConfirm(...args),
}));

import { execute } from "../../../src/cli/commands/setup-cloud.js";

describe("setup --cloud", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: CLI tools work, return empty strings
    mockExecFileSync.mockReturnValue("");
  });

  // --- Shared ---

  it("throws when docker.runtime is not cloud-run or ecs", async () => {
    mockLoadGlobalConfig.mockReturnValue({ docker: { enabled: true, runtime: "local" } });
    await expect(execute({ project: "." })).rejects.toThrow("cloud-run");
  });

  // --- GCP Cloud Run ---

  describe("Cloud Run (GCP)", () => {
    it("throws when gcpProject is missing", async () => {
      mockLoadGlobalConfig.mockReturnValue({
        docker: { enabled: true, runtime: "cloud-run" },
      });
      await expect(execute({ project: "." })).rejects.toThrow("gcpProject");
    });

    it("prints message when no agents found", async () => {
      mockLoadGlobalConfig.mockReturnValue({
        docker: { enabled: true, runtime: "cloud-run", gcpProject: "test-proj" },
      });
      mockDiscoverAgents.mockReturnValue([]);

      const output = await captureLog(() => execute({ project: "." }));
      expect(output).toContain("No agents found");
    });

    it("creates SA and binds secrets for each agent", async () => {
      mockLoadGlobalConfig.mockReturnValue({
        docker: {
          enabled: true,
          runtime: "cloud-run",
          gcpProject: "test-proj",
          region: "us-central1",
          artifactRegistry: "us-central1-docker.pkg.dev/test-proj/images",
          serviceAccount: "runtime@test-proj.iam.gserviceaccount.com",
        },
      });
      mockDiscoverAgents.mockReturnValue(["dev"]);
      mockLoadAgentConfig.mockReturnValue({
        name: "dev",
        credentials: ["github_token:default"],
        model: { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" },
      });

      // Mock gcloud responses:
      // 1. auth print-access-token
      // 2. preflight secrets list (count check)
      // 3. iam service-accounts create
      // 4. secrets list (for github_token:default)
      // 5. secrets list (for anthropic_key:default)
      // 6. secrets add-iam-policy-binding (github_token token)
      // 7. secrets add-iam-policy-binding (anthropic_key token)
      // 8. iam service-accounts add-iam-policy-binding
      mockExecFileSync
        .mockReturnValueOnce("ya29.fake-token") // auth
        .mockReturnValueOnce("action-llama--github_token--default--token") // preflight
        .mockReturnValueOnce("") // SA create
        .mockReturnValueOnce("projects/test-proj/secrets/action-llama--github_token--default--token") // secrets list
        .mockReturnValueOnce("projects/test-proj/secrets/action-llama--anthropic_key--default--token") // secrets list
        .mockReturnValueOnce("") // IAM bind secret 1
        .mockReturnValueOnce("") // IAM bind secret 2
        .mockReturnValueOnce(""); // SA self-bind

      const output = await captureLog(() => execute({ project: "." }));

      expect(output).toContain("Agent: dev");
      expect(output).toContain("al-dev@test-proj.iam.gserviceaccount.com");
      expect(output).toContain("Bound 2 secret(s)");
      expect(output).toContain("isolated service account");

      // Verify gcloud was called to create the SA
      const createCall = mockExecFileSync.mock.calls.find(
        (c: any[]) => c[0] === "gcloud" && c[1]?.includes("service-accounts") && c[1]?.includes("create")
      );
      expect(createCall).toBeTruthy();
      expect(createCall![1]).toContain("al-dev");
    });

    it("handles existing SA gracefully", async () => {
      mockLoadGlobalConfig.mockReturnValue({
        docker: {
          enabled: true,
          runtime: "cloud-run",
          gcpProject: "test-proj",
        },
      });
      mockDiscoverAgents.mockReturnValue(["dev"]);
      mockLoadAgentConfig.mockReturnValue({
        name: "dev",
        credentials: [],
        model: { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "pi_auth" },
      });

      // auth succeeds, preflight finds secrets, SA create fails with "already exists"
      mockExecFileSync
        .mockReturnValueOnce("ya29.fake-token")
        .mockReturnValueOnce("action-llama--some--secret--field") // preflight
        .mockImplementationOnce(() => { throw new Error("already exists"); });

      const output = await captureLog(() => execute({ project: "." }));
      expect(output).toContain("already exists");
    });

    it("warns and prompts when no secrets found in GSM", async () => {
      mockLoadGlobalConfig.mockReturnValue({
        docker: {
          enabled: true,
          runtime: "cloud-run",
          gcpProject: "test-proj",
        },
      });
      mockDiscoverAgents.mockReturnValue(["dev"]);

      // auth succeeds, preflight finds nothing
      mockExecFileSync
        .mockReturnValueOnce("ya29.fake-token")
        .mockReturnValueOnce(""); // preflight: no secrets

      // User declines
      mockConfirm.mockResolvedValueOnce(false);

      const output = await captureLog(() => execute({ project: "." }));
      expect(output).toContain("No secrets found in GSM");
      expect(output).toContain("al creds push");
      expect(output).toContain("Aborted");
    });

    it("proceeds when user confirms despite no secrets", async () => {
      mockLoadGlobalConfig.mockReturnValue({
        docker: {
          enabled: true,
          runtime: "cloud-run",
          gcpProject: "test-proj",
        },
      });
      mockDiscoverAgents.mockReturnValue(["dev"]);
      mockLoadAgentConfig.mockReturnValue({
        name: "dev",
        credentials: [],
        model: { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "pi_auth" },
      });

      // auth succeeds, preflight finds nothing
      mockExecFileSync
        .mockReturnValueOnce("ya29.fake-token")
        .mockReturnValueOnce("") // preflight: no secrets
        .mockReturnValueOnce(""); // SA create

      // User confirms
      mockConfirm.mockResolvedValueOnce(true);

      const output = await captureLog(() => execute({ project: "." }));
      expect(output).toContain("No secrets found in GSM");
      expect(output).toContain("Setting up Cloud Run");
    });
  });

  // --- AWS ECS Fargate ---

  describe("ECS Fargate (AWS)", () => {
    it("throws when awsRegion is missing", async () => {
      mockLoadGlobalConfig.mockReturnValue({
        docker: { enabled: true, runtime: "ecs" },
      });
      await expect(execute({ project: "." })).rejects.toThrow("awsRegion");
    });

    it("throws when ecrRepository is missing", async () => {
      mockLoadGlobalConfig.mockReturnValue({
        docker: { enabled: true, runtime: "ecs", awsRegion: "us-east-1" },
      });
      await expect(execute({ project: "." })).rejects.toThrow("ecrRepository");
    });

    it("throws when ECR repo format is invalid", async () => {
      mockLoadGlobalConfig.mockReturnValue({
        docker: {
          enabled: true,
          runtime: "ecs",
          awsRegion: "us-east-1",
          ecrRepository: "invalid-repo-format",
        },
      });
      await expect(execute({ project: "." })).rejects.toThrow("Cannot extract AWS account ID");
    });

    it("prints message when no agents found", async () => {
      mockLoadGlobalConfig.mockReturnValue({
        docker: {
          enabled: true,
          runtime: "ecs",
          awsRegion: "us-east-1",
          ecrRepository: "123456789012.dkr.ecr.us-east-1.amazonaws.com/al-images",
        },
      });
      mockDiscoverAgents.mockReturnValue([]);

      const output = await captureLog(() => execute({ project: "." }));
      expect(output).toContain("No agents found");
    });

    it("creates IAM role and binds secrets for each agent", async () => {
      mockLoadGlobalConfig.mockReturnValue({
        docker: {
          enabled: true,
          runtime: "ecs",
          awsRegion: "us-east-1",
          ecsCluster: "al-cluster",
          ecrRepository: "123456789012.dkr.ecr.us-east-1.amazonaws.com/al-images",
          executionRoleArn: "arn:aws:iam::123456789012:role/ecsTaskExecutionRole",
          taskRoleArn: "arn:aws:iam::123456789012:role/al-default-task-role",
          subnets: ["subnet-abc123"],
        },
      });
      mockDiscoverAgents.mockReturnValue(["dev"]);
      mockLoadAgentConfig.mockReturnValue({
        name: "dev",
        credentials: ["github_token:default"],
        model: { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" },
      });

      // Mock AWS CLI responses:
      // 1. sts get-caller-identity (auth check)
      // 2. iam create-role
      // 3. iam put-role-policy
      mockExecFileSync
        .mockReturnValueOnce('{"Account":"123456789012"}') // auth
        .mockReturnValueOnce("") // create role
        .mockReturnValueOnce(""); // put-role-policy

      const output = await captureLog(() => execute({ project: "." }));

      expect(output).toContain("Agent: dev");
      expect(output).toContain("al-dev-task-role");
      expect(output).toContain("Bound 2 secret path(s)"); // github_token + anthropic_key
      expect(output).toContain("isolated IAM task role");

      // Verify aws was called to create the role
      const createCall = mockExecFileSync.mock.calls.find(
        (c: any[]) => c[0] === "aws" && c[1]?.includes("create-role")
      );
      expect(createCall).toBeTruthy();
      expect(createCall![1]).toContain("al-dev-task-role");

      // Verify the policy includes correct secret ARN patterns
      const policyCall = mockExecFileSync.mock.calls.find(
        (c: any[]) => c[0] === "aws" && c[1]?.includes("put-role-policy")
      );
      expect(policyCall).toBeTruthy();
      const policyIdx = policyCall![1].indexOf("--policy-document");
      const policyDoc = JSON.parse(policyCall![1][policyIdx + 1]);
      expect(policyDoc.Statement[0].Resource).toContain(
        "arn:aws:secretsmanager:us-east-1:123456789012:secret:action-llama/github_token/default/*"
      );
      expect(policyDoc.Statement[0].Resource).toContain(
        "arn:aws:secretsmanager:us-east-1:123456789012:secret:action-llama/anthropic_key/default/*"
      );
    });

    it("handles existing IAM role gracefully", async () => {
      mockLoadGlobalConfig.mockReturnValue({
        docker: {
          enabled: true,
          runtime: "ecs",
          awsRegion: "us-east-1",
          ecrRepository: "123456789012.dkr.ecr.us-east-1.amazonaws.com/al-images",
        },
      });
      mockDiscoverAgents.mockReturnValue(["dev"]);
      mockLoadAgentConfig.mockReturnValue({
        name: "dev",
        credentials: [],
        model: { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "pi_auth" },
      });

      // auth succeeds, create-role fails with EntityAlreadyExists
      mockExecFileSync
        .mockReturnValueOnce('{"Account":"123456789012"}')
        .mockImplementationOnce(() => { throw new Error("EntityAlreadyExists"); });

      const output = await captureLog(() => execute({ project: "." }));
      expect(output).toContain("already exists");
    });
  });
});
