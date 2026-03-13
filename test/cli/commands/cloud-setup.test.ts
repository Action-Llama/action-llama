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

// Mock cloud state to avoid filesystem writes
vi.mock("../../../src/cloud/state.js", () => ({
  saveState: vi.fn(),
  createState: vi.fn().mockReturnValue({}),
}));

// Mock AWS SDK clients
const mockStsSend = vi.fn();
const mockEcrSend = vi.fn();
const mockEcsSend = vi.fn();
const mockIamSend = vi.fn();
const mockEc2Send = vi.fn();

vi.mock("@aws-sdk/client-sts", () => ({
  STSClient: vi.fn().mockImplementation(function () { this.send = mockStsSend; }),
  GetCallerIdentityCommand: vi.fn().mockImplementation(function (input: any) { Object.assign(this, input); }),
}));

vi.mock("@aws-sdk/client-ecr", () => ({
  ECRClient: vi.fn().mockImplementation(function () { this.send = mockEcrSend; }),
  DescribeRepositoriesCommand: vi.fn().mockImplementation(function (input: any) { Object.assign(this, { _type: "DescribeRepositories", ...input }); }),
  CreateRepositoryCommand: vi.fn().mockImplementation(function (input: any) { Object.assign(this, { _type: "CreateRepository", ...input }); }),
  SetRepositoryPolicyCommand: vi.fn().mockImplementation(function (input: any) { Object.assign(this, { _type: "SetRepositoryPolicy", ...input }); }),
}));

vi.mock("@aws-sdk/client-ecs", () => ({
  ECSClient: vi.fn().mockImplementation(function () { this.send = mockEcsSend; }),
  ListClustersCommand: vi.fn().mockImplementation(function (input: any) { Object.assign(this, { _type: "ListClusters", ...input }); }),
  DescribeClustersCommand: vi.fn().mockImplementation(function (input: any) { Object.assign(this, { _type: "DescribeClusters", ...input }); }),
  CreateClusterCommand: vi.fn().mockImplementation(function (input: any) { Object.assign(this, { _type: "CreateCluster", ...input }); }),
}));

vi.mock("@aws-sdk/client-iam", () => ({
  IAMClient: vi.fn().mockImplementation(function () { this.send = mockIamSend; }),
  ListRolesCommand: vi.fn().mockImplementation(function (input: any) { Object.assign(this, { _type: "ListRoles", ...input }); }),
  CreateRoleCommand: vi.fn().mockImplementation(function (input: any) { Object.assign(this, { _type: "CreateRole", ...input }); }),
  GetRoleCommand: vi.fn().mockImplementation(function (input: any) { Object.assign(this, { _type: "GetRole", ...input }); }),
  AttachRolePolicyCommand: vi.fn().mockImplementation(function (input: any) { Object.assign(this, { _type: "AttachRolePolicy", ...input }); }),
  PutRolePolicyCommand: vi.fn().mockImplementation(function (input: any) { Object.assign(this, { _type: "PutRolePolicy", ...input }); }),
  PutUserPolicyCommand: vi.fn().mockImplementation(function (input: any) { Object.assign(this, { _type: "PutUserPolicy", ...input }); }),
  CreateServiceLinkedRoleCommand: vi.fn().mockImplementation(function (input: any) { Object.assign(this, { _type: "CreateServiceLinkedRole", ...input }); }),
}));

vi.mock("@aws-sdk/client-ec2", () => ({
  EC2Client: vi.fn().mockImplementation(function () { this.send = mockEc2Send; }),
  DescribeVpcsCommand: vi.fn().mockImplementation(function (input: any) { Object.assign(this, { _type: "DescribeVpcs", ...input }); }),
  DescribeSubnetsCommand: vi.fn().mockImplementation(function (input: any) { Object.assign(this, { _type: "DescribeSubnets", ...input }); }),
  DescribeSecurityGroupsCommand: vi.fn().mockImplementation(function (input: any) { Object.assign(this, { _type: "DescribeSecurityGroups", ...input }); }),
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
    // Provider selection
    mockSelect.mockResolvedValueOnce("ecs");

    // STS: early credential probe + later account ID fetch
    mockStsSend
      .mockResolvedValueOnce({ Account: "123456789012", Arn: "arn:aws:iam::123456789012:user/test" })
      .mockResolvedValueOnce({ Account: "123456789012", Arn: "arn:aws:iam::123456789012:user/test" });

    // Region input
    mockInput.mockResolvedValueOnce("us-east-1");

    // ECR: list returns empty -> create succeeds -> set Lambda policy
    mockEcrSend
      .mockResolvedValueOnce({ repositories: [] })                    // DescribeRepositories
      .mockResolvedValueOnce({                                         // CreateRepository
        repository: { repositoryUri: "123456789012.dkr.ecr.us-east-1.amazonaws.com/al-images" },
      })
      .mockResolvedValueOnce({});                                      // SetRepositoryPolicy (Lambda access)

    // ECS: list returns empty -> create succeeds
    mockEcsSend
      .mockResolvedValueOnce({ clusterArns: [] })                     // ListClusters
      .mockResolvedValueOnce({});                                      // CreateCluster

    // IAM: service-linked roles, execution role, task role, CodeBuild role, App Runner roles
    mockIamSend
      .mockResolvedValueOnce({})                                       // CreateServiceLinkedRole (ECS)
      .mockResolvedValueOnce({})                                       // CreateServiceLinkedRole (App Runner)
      .mockResolvedValueOnce({ Roles: [] })                            // ListRoles (execution role)
      .mockResolvedValueOnce({                                         // CreateRole (execution role)
        Role: { Arn: "arn:aws:iam::123456789012:role/al-ecs-execution-role" },
      })
      .mockResolvedValueOnce({})                                       // AttachRolePolicy (execution role)
      .mockResolvedValueOnce({ Roles: [] })                            // ListRoles (task role)
      .mockResolvedValueOnce({                                         // CreateRole (task role)
        Role: { Arn: "arn:aws:iam::123456789012:role/al-default-task-role" },
      })
      .mockResolvedValueOnce({})                                       // PutRolePolicy (execution role inline)
      .mockResolvedValueOnce({})                                       // CreateRole (CodeBuild)
      .mockResolvedValueOnce({})                                       // PutRolePolicy (CodeBuild)
      .mockResolvedValueOnce({})                                       // CreateRole (App Runner access)
      .mockResolvedValueOnce({})                                       // AttachRolePolicy (App Runner access)
      .mockResolvedValueOnce({                                         // GetRole (App Runner access)
        Role: { Arn: "arn:aws:iam::123456789012:role/al-apprunner-access-role" },
      })
      .mockResolvedValueOnce({})                                       // CreateRole (App Runner instance)
      .mockResolvedValueOnce({})                                       // PutRolePolicy (App Runner instance)
      .mockResolvedValueOnce({                                         // GetRole (App Runner instance)
        Role: { Arn: "arn:aws:iam::123456789012:role/al-apprunner-instance-role" },
      })
      .mockResolvedValueOnce({});                                      // PutUserPolicy (operator)

    // EC2: single VPC (auto-selected), subnets, security groups
    mockEc2Send
      .mockResolvedValueOnce({                                         // DescribeVpcs
        Vpcs: [{ VpcId: "vpc-123", CidrBlock: "10.0.0.0/16", IsDefault: true }],
      })
      .mockResolvedValueOnce({                                         // DescribeSubnets
        Subnets: [{ SubnetId: "subnet-abc", AvailabilityZone: "us-east-1a", CidrBlock: "10.0.1.0/24" }],
      })
      .mockResolvedValueOnce({                                         // DescribeSecurityGroups
        SecurityGroups: [{ GroupName: "default", GroupId: "sg-123", Description: "default VPC security group" }],
      });

    // Prompt responses for create-new paths:
    // input: new ECR repo name, new ECS cluster name, new execution role name, new task role name, secret prefix
    mockInput
      .mockResolvedValueOnce("al-images")       // new ECR repository name
      .mockResolvedValueOnce("al-cluster")       // new ECS cluster name
      .mockResolvedValueOnce("al-ecs-execution-role")  // new execution role name
      .mockResolvedValueOnce("al-default-task-role")   // new task role name
      .mockResolvedValueOnce("action-llama");          // secret prefix

    // confirm: use all subnets
    mockConfirm.mockResolvedValueOnce(true);

    // select: security group -> skip
    mockSelect.mockResolvedValueOnce("");

    await execute({ project: tmpDir });

    const config = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
    expect(config.cloud.provider).toBe("ecs");
    expect(config.cloud.awsRegion).toBe("us-east-1");
    expect(config.cloud.ecsCluster).toBe("al-cluster");
    expect(config.cloud.ecrRepository).toBe("123456789012.dkr.ecr.us-east-1.amazonaws.com/al-images");
    expect(config.cloud.executionRoleArn).toBe("arn:aws:iam::123456789012:role/al-ecs-execution-role");
    expect(config.cloud.taskRoleArn).toBe("arn:aws:iam::123456789012:role/al-default-task-role");
    expect(config.cloud.appRunnerAccessRoleArn).toBe("arn:aws:iam::123456789012:role/al-apprunner-access-role");
    expect(config.cloud.appRunnerInstanceRoleArn).toBe("arn:aws:iam::123456789012:role/al-apprunner-instance-role");
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

    // Then proceed with new setup (ECS with SDK mocks)
    mockSelect.mockResolvedValueOnce("ecs");

    // STS: early credential probe + later account ID fetch
    mockStsSend
      .mockResolvedValueOnce({ Account: "123456789012", Arn: "arn:aws:iam::123456789012:user/test" })
      .mockResolvedValueOnce({ Account: "123456789012", Arn: "arn:aws:iam::123456789012:user/test" });

    // Region input
    mockInput.mockResolvedValueOnce("us-east-1");

    // ECR: list empty -> create -> set Lambda policy
    mockEcrSend
      .mockResolvedValueOnce({ repositories: [] })
      .mockResolvedValueOnce({
        repository: { repositoryUri: "123456789012.dkr.ecr.us-east-1.amazonaws.com/al-images" },
      })
      .mockResolvedValueOnce({});                                      // SetRepositoryPolicy

    // ECS: list empty -> create
    mockEcsSend
      .mockResolvedValueOnce({ clusterArns: [] })
      .mockResolvedValueOnce({});

    // IAM: SLRs, two ECS roles, CodeBuild role, two App Runner roles, operator policy
    mockIamSend
      .mockResolvedValueOnce({})  // CreateServiceLinkedRole (ECS)
      .mockResolvedValueOnce({})  // CreateServiceLinkedRole (App Runner)
      .mockResolvedValueOnce({ Roles: [] })
      .mockResolvedValueOnce({ Role: { Arn: "arn:aws:iam::123456789012:role/al-ecs-execution-role" } })
      .mockResolvedValueOnce({})  // AttachRolePolicy
      .mockResolvedValueOnce({ Roles: [] })
      .mockResolvedValueOnce({ Role: { Arn: "arn:aws:iam::123456789012:role/al-default-task-role" } })
      .mockResolvedValueOnce({})  // PutRolePolicy (execution)
      .mockResolvedValueOnce({})  // CreateRole (CodeBuild)
      .mockResolvedValueOnce({})  // PutRolePolicy (CodeBuild)
      .mockResolvedValueOnce({})  // CreateRole (App Runner access)
      .mockResolvedValueOnce({})  // AttachRolePolicy (App Runner access)
      .mockResolvedValueOnce({ Role: { Arn: "arn:aws:iam::123456789012:role/al-apprunner-access-role" } })
      .mockResolvedValueOnce({})  // CreateRole (App Runner instance)
      .mockResolvedValueOnce({})  // PutRolePolicy (App Runner instance)
      .mockResolvedValueOnce({ Role: { Arn: "arn:aws:iam::123456789012:role/al-apprunner-instance-role" } })
      .mockResolvedValueOnce({});  // PutUserPolicy (operator)

    // EC2: single VPC, subnets, security groups
    mockEc2Send
      .mockResolvedValueOnce({ Vpcs: [{ VpcId: "vpc-123", CidrBlock: "10.0.0.0/16", IsDefault: true }] })
      .mockResolvedValueOnce({ Subnets: [{ SubnetId: "subnet-abc", AvailabilityZone: "us-east-1a", CidrBlock: "10.0.1.0/24" }] })
      .mockResolvedValueOnce({ SecurityGroups: [{ GroupName: "default", GroupId: "sg-123", Description: "default" }] });

    // Input prompts for create paths + secret prefix
    mockInput
      .mockResolvedValueOnce("al-images")
      .mockResolvedValueOnce("al-cluster")
      .mockResolvedValueOnce("al-ecs-execution-role")
      .mockResolvedValueOnce("al-default-task-role")
      .mockResolvedValueOnce("action-llama");

    // Confirm: use all subnets
    mockConfirm.mockResolvedValueOnce(true);

    // Select: skip security group
    mockSelect.mockResolvedValueOnce("");

    await execute({ project: tmpDir });

    expect(mockTeardownCloud).toHaveBeenCalledWith(
      resolve(tmpDir),
      expect.objectContaining({ provider: "cloud-run", gcpProject: "old" })
    );

    const config = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
    expect(config.cloud.provider).toBe("ecs");
  });

  it("aborts ECS setup when AWS credentials are missing", async () => {
    mockSelect.mockResolvedValueOnce("ecs");
    mockStsSend.mockRejectedValueOnce(new Error("Could not load credentials"));

    await execute({ project: tmpDir });

    // Config should NOT have a [cloud] section
    const config = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
    expect(config.cloud).toBeUndefined();
    expect(config.local.enabled).toBe(true); // preserved
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
