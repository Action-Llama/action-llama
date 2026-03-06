import { resolve } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { select, input, confirm } from "@inquirer/prompts";
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml";
import type { CloudConfig } from "../../shared/config.js";
import { createLocalBackend, createBackendFromCloudConfig } from "../../shared/remote.js";
import { reconcileCloudIam } from "./doctor.js";
import { teardownCloud } from "./cloud-teardown.js";

import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import {
  ECRClient,
  DescribeRepositoriesCommand,
  CreateRepositoryCommand,
} from "@aws-sdk/client-ecr";
import {
  ECSClient,
  ListClustersCommand,
  DescribeClustersCommand,
  CreateClusterCommand,
} from "@aws-sdk/client-ecs";
import {
  IAMClient,
  ListRolesCommand,
  CreateRoleCommand,
  GetRoleCommand,
  AttachRolePolicyCommand,
} from "@aws-sdk/client-iam";
import {
  EC2Client,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
  DescribeSecurityGroupsCommand,
} from "@aws-sdk/client-ec2";

const CREATE_NEW = "__create_new__";
const MANUAL_INPUT = "__manual_input__";

export async function execute(opts: { project: string }): Promise<void> {
  const projectPath = resolve(opts.project);
  const configPath = resolve(projectPath, "config.toml");

  console.log("\n=== Cloud Setup ===\n");

  // Check for existing cloud config
  if (existsSync(configPath)) {
    const existing = parseTOML(readFileSync(configPath, "utf-8")) as Record<string, any>;
    if (existing.cloud && existing.cloud.provider) {
      console.log(`Existing cloud config found (provider: ${existing.cloud.provider}).`);
      const proceed = await confirm({
        message: "Tear down existing cloud infrastructure before re-configuring?",
        default: true,
      });
      if (proceed) {
        await teardownCloud(projectPath, existing.cloud as CloudConfig);
      } else {
        const skip = await confirm({
          message: "Continue setup anyway (will overwrite [cloud] config)?",
          default: false,
        });
        if (!skip) {
          console.log("Aborted.");
          return;
        }
      }
    }
  }

  // 1. Select provider
  const provider = await select({
    message: "Cloud provider:",
    choices: [
      { name: "GCP Cloud Run Jobs", value: "cloud-run" as const },
      { name: "AWS ECS Fargate", value: "ecs" as const },
    ],
  });

  // 2. Prompt for provider-specific fields
  const cloud: CloudConfig = { provider };

  if (provider === "cloud-run") {
    cloud.gcpProject = await input({ message: "GCP project ID:" });
    cloud.region = await input({ message: "Region:", default: "us-central1" });
    cloud.artifactRegistry = await input({
      message: "Artifact Registry repo:",
      default: `${cloud.region}-docker.pkg.dev/${cloud.gcpProject}/al-images`,
    });
    cloud.serviceAccount = await input({
      message: "Service account email (for job creation):",
      default: `al-runner@${cloud.gcpProject}.iam.gserviceaccount.com`,
    });
    const prefix = await input({ message: "Secret prefix:", default: "action-llama" });
    if (prefix !== "action-llama") cloud.secretPrefix = prefix;
  } else {
    const ok = await setupEcsCloud(cloud);
    if (!ok) return;
  }

  // 3. Write [cloud] to config.toml
  let rawConfig: Record<string, any> = {};
  if (existsSync(configPath)) {
    rawConfig = parseTOML(readFileSync(configPath, "utf-8")) as Record<string, any>;
  }

  // Strip undefined values before writing
  const cloudToWrite: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cloud)) {
    if (v !== undefined) cloudToWrite[k] = v;
  }
  rawConfig.cloud = cloudToWrite;

  writeFileSync(configPath, stringifyTOML(rawConfig));
  console.log(`\nWrote [cloud] config to ${configPath}`);

  // 4. Push credentials
  console.log(`\nPushing local credentials to ${provider}...`);
  try {
    const local = createLocalBackend();
    const remote = await createBackendFromCloudConfig(cloud);
    const localEntries = await local.list();

    if (localEntries.length === 0) {
      console.log("No local credentials found. Run 'al doctor' to configure them, then 'al doctor -c' to push.");
    } else {
      let pushed = 0;
      for (const entry of localEntries) {
        const value = await local.read(entry.type, entry.instance, entry.field);
        if (value !== undefined) {
          await remote.write(entry.type, entry.instance, entry.field, value);
          pushed++;
        }
      }
      console.log(`Pushed ${pushed} credential field(s).`);

      // 5. Provision IAM
      console.log(`\nProvisioning per-agent IAM resources...`);
      await reconcileCloudIam(projectPath, cloud);
    }
  } catch (err: any) {
    console.log(`\nCloud credential push/IAM failed: ${err.message}`);
    console.log("You can retry later with: al doctor -c");
  }

  console.log("\nCloud setup complete.");
}

// --- ECS auto-discovery setup ---

async function setupEcsCloud(cloud: CloudConfig): Promise<boolean> {
  // Check for AWS credentials before asking any questions
  console.log("Checking for AWS credentials...");
  const probe = new STSClient({});
  try {
    const identity = await probe.send(new GetCallerIdentityCommand({}));
    console.log(`  Authenticated as ${identity.Arn}\n`);
  } catch {
    console.log("\n  No AWS credentials found. To configure them:\n");
    console.log("  1. Install the AWS CLI:");
    console.log("     https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html\n");
    console.log("  2. Run: aws configure\n");
    console.log("  3. Then re-run: al cloud setup\n");
    console.log("  Alternatively, set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.\n");
    return false;
  }

  cloud.awsRegion = await input({ message: "AWS region:", default: "us-east-1" });
  const region = cloud.awsRegion;

  // Create SDK clients with the chosen region
  const stsClient = new STSClient({ region });
  const ecrClient = new ECRClient({ region });
  const ecsClient = new ECSClient({ region });
  const iamClient = new IAMClient({});
  const ec2Client = new EC2Client({ region });

  // Get account ID in the target region
  let accountId: string;
  const identity = await stsClient.send(new GetCallerIdentityCommand({}));
  accountId = identity.Account!;

  cloud.ecrRepository = await pickOrCreateEcrRepo(ecrClient, region, accountId);
  cloud.ecsCluster = await pickOrCreateEcsCluster(ecsClient);
  cloud.executionRoleArn = await pickOrCreateEcsRole(
    iamClient,
    "Execution role (ECR pull + CloudWatch Logs)",
    "al-ecs-execution-role",
    ["arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"],
  );
  cloud.taskRoleArn = await pickOrCreateEcsRole(
    iamClient,
    "Default task role (Secrets Manager access)",
    "al-default-task-role",
    [],
  );

  const result = await pickVpcAndSubnets(ec2Client);
  cloud.subnets = result.subnets;

  const sgs = await pickSecurityGroups(ec2Client, result.vpcId);
  if (sgs.length > 0) cloud.securityGroups = sgs;

  const prefix = await input({ message: "Secret prefix:", default: "action-llama" });
  if (prefix !== "action-llama") cloud.awsSecretPrefix = prefix;
  return true;
}

// --- Resource pickers ---

async function pickOrCreateEcrRepo(ecrClient: ECRClient, region: string, accountId: string): Promise<string> {
  console.log("Looking for ECR repositories...");
  try {
    const data = await ecrClient.send(new DescribeRepositoriesCommand({}));
    const repos = data.repositories || [];

    if (repos.length > 0) {
      const choices = [
        ...repos.map((r) => ({ name: r.repositoryName!, value: r.repositoryUri! })),
        { name: "Create new repository", value: CREATE_NEW },
        { name: "Enter URI manually", value: MANUAL_INPUT },
      ];
      const choice = await select({ message: "ECR repository:", choices });
      if (choice === MANUAL_INPUT) return input({ message: "ECR repository URI:" });
      if (choice !== CREATE_NEW) return choice;
    } else {
      console.log("  No ECR repositories found.");
    }
  } catch {
    console.log("  Could not list ECR repositories.");
  }

  const name = await input({ message: "New ECR repository name:", default: "al-images" });
  try {
    const data = await ecrClient.send(new CreateRepositoryCommand({ repositoryName: name }));
    const uri = data.repository!.repositoryUri!;
    console.log(`  Created: ${uri}`);
    return uri;
  } catch (err: any) {
    if (err.name === "RepositoryAlreadyExistsException") {
      const uri = `${accountId}.dkr.ecr.${region}.amazonaws.com/${name}`;
      console.log(`  Already exists: ${uri}`);
      return uri;
    }
    console.log(`  Failed to create repository: ${err.message}`);
    return input({ message: "ECR repository URI:" });
  }
}

async function pickOrCreateEcsCluster(ecsClient: ECSClient): Promise<string> {
  console.log("\nLooking for ECS clusters...");
  try {
    const listData = await ecsClient.send(new ListClustersCommand({}));
    const arns = listData.clusterArns || [];

    if (arns.length > 0) {
      const descData = await ecsClient.send(new DescribeClustersCommand({ clusters: arns }));
      const clusters = (descData.clusters || []).filter((c) => c.status === "ACTIVE");

      if (clusters.length > 0) {
        const choices = [
          ...clusters.map((c) => ({
            name: `${c.clusterName} (${c.runningTasksCount || 0} running tasks)`,
            value: c.clusterName!,
          })),
          { name: "Create new cluster", value: CREATE_NEW },
          { name: "Enter name manually", value: MANUAL_INPUT },
        ];
        const choice = await select({ message: "ECS cluster:", choices });
        if (choice === MANUAL_INPUT) return input({ message: "ECS cluster name:" });
        if (choice !== CREATE_NEW) return choice;
      } else {
        console.log("  No active ECS clusters found.");
      }
    } else {
      console.log("  No ECS clusters found.");
    }
  } catch {
    console.log("  Could not list ECS clusters.");
  }

  const name = await input({ message: "New ECS cluster name:", default: "al-cluster" });
  try {
    await ecsClient.send(new CreateClusterCommand({ clusterName: name }));
    console.log(`  Created cluster: ${name}`);
    return name;
  } catch (err: any) {
    console.log(`  Failed to create cluster: ${err.message}`);
    return input({ message: "ECS cluster name:" });
  }
}

const ECS_TRUST_POLICY = JSON.stringify({
  Version: "2012-10-17",
  Statement: [{
    Effect: "Allow",
    Principal: { Service: "ecs-tasks.amazonaws.com" },
    Action: "sts:AssumeRole",
  }],
});

async function pickOrCreateEcsRole(iamClient: IAMClient, label: string, defaultName: string, managedPolicies: string[]): Promise<string> {
  console.log(`\nLooking for IAM roles (${label})...`);
  try {
    const data = await iamClient.send(new ListRolesCommand({ MaxItems: 200 }));
    const ecsRoles = (data.Roles || []).filter((r) => {
      try {
        const doc = typeof r.AssumeRolePolicyDocument === "string"
          ? JSON.parse(decodeURIComponent(r.AssumeRolePolicyDocument))
          : r.AssumeRolePolicyDocument;
        return doc?.Statement?.some((s: any) => {
          const svc = s.Principal?.Service;
          return svc === "ecs-tasks.amazonaws.com" ||
            (Array.isArray(svc) && svc.includes("ecs-tasks.amazonaws.com"));
        });
      } catch {
        return false;
      }
    });

    if (ecsRoles.length > 0) {
      const choices = [
        ...ecsRoles.map((r) => ({ name: r.RoleName!, value: r.Arn! })),
        { name: `Create new: ${defaultName}`, value: CREATE_NEW },
        { name: "Enter ARN manually", value: MANUAL_INPUT },
      ];
      const choice = await select({ message: `${label}:`, choices });
      if (choice === MANUAL_INPUT) return input({ message: `${label} ARN:` });
      if (choice !== CREATE_NEW) return choice;
    } else {
      console.log("  No ECS-compatible IAM roles found.");
    }
  } catch {
    console.log("  Could not list IAM roles.");
  }

  const name = await input({ message: "New role name:", default: defaultName });
  try {
    const data = await iamClient.send(new CreateRoleCommand({
      RoleName: name,
      AssumeRolePolicyDocument: ECS_TRUST_POLICY,
    }));
    const arn = data.Role!.Arn!;
    console.log(`  Created role: ${arn}`);

    for (const policyArn of managedPolicies) {
      try {
        await iamClient.send(new AttachRolePolicyCommand({
          RoleName: name,
          PolicyArn: policyArn,
        }));
        console.log(`  Attached: ${policyArn.split("/").pop()}`);
      } catch (attachErr: any) {
        console.log(`  Warning: could not attach ${policyArn.split("/").pop()}: ${attachErr.message}`);
      }
    }

    return arn;
  } catch (err: any) {
    if (err.name === "EntityAlreadyExistsException") {
      try {
        const data = await iamClient.send(new GetRoleCommand({ RoleName: name }));
        const arn = data.Role!.Arn!;
        console.log(`  Role already exists: ${arn}`);
        return arn;
      } catch {
        console.log(`  Role "${name}" exists but could not retrieve ARN.`);
      }
    } else {
      console.log(`  Failed to create role: ${err.message}`);
    }
    return input({ message: `${label} ARN:` });
  }
}

async function pickVpcAndSubnets(ec2Client: EC2Client): Promise<{ subnets: string[]; vpcId: string }> {
  console.log("\nLooking for VPCs...");
  let vpcId: string | undefined;

  try {
    const data = await ec2Client.send(new DescribeVpcsCommand({}));
    const vpcs = data.Vpcs || [];

    if (vpcs.length > 0) {
      if (vpcs.length === 1) {
        vpcId = vpcs[0].VpcId;
        const nameTag = vpcs[0].Tags?.find((t) => t.Key === "Name")?.Value;
        console.log(`  Using VPC: ${nameTag ? `${nameTag} (${vpcId})` : vpcId}`);
      } else {
        const choices = vpcs.map((v) => {
          const nameTag = v.Tags?.find((t) => t.Key === "Name")?.Value;
          const label = nameTag ? `${nameTag} (${v.VpcId})` : v.VpcId!;
          const defaultMarker = v.IsDefault ? " [default]" : "";
          return { name: `${label} — ${v.CidrBlock}${defaultMarker}`, value: v.VpcId! };
        });
        vpcId = await select({ message: "VPC:", choices });
      }
    }
  } catch {
    console.log("  Could not list VPCs.");
  }

  if (!vpcId) {
    const raw = await input({ message: "Subnet IDs (comma-separated):" });
    return { subnets: raw.split(",").map(s => s.trim()).filter(Boolean), vpcId: "" };
  }

  // List subnets in chosen VPC
  console.log(`\nLooking for subnets in ${vpcId}...`);
  try {
    const data = await ec2Client.send(new DescribeSubnetsCommand({
      Filters: [{ Name: "vpc-id", Values: [vpcId] }],
    }));
    const subnets = data.Subnets || [];

    if (subnets.length > 0) {
      for (const s of subnets) {
        const nameTag = s.Tags?.find((t) => t.Key === "Name")?.Value;
        const label = nameTag ? `${nameTag} (${s.SubnetId})` : s.SubnetId;
        console.log(`    ${label} — ${s.AvailabilityZone}, ${s.CidrBlock}`);
      }

      const useAll = await confirm({
        message: `Use all ${subnets.length} subnets? (recommended for multi-AZ)`,
        default: true,
      });

      if (useAll) {
        return { subnets: subnets.map((s) => s.SubnetId!), vpcId };
      }
    } else {
      console.log("  No subnets found in this VPC.");
    }
  } catch {
    console.log("  Could not list subnets.");
  }

  const raw = await input({ message: "Subnet IDs (comma-separated):" });
  return { subnets: raw.split(",").map(s => s.trim()).filter(Boolean), vpcId };
}

async function pickSecurityGroups(ec2Client: EC2Client, vpcId: string): Promise<string[]> {
  if (!vpcId) {
    const raw = await input({ message: "Security group IDs (comma-separated, optional):" });
    return raw.trim() ? raw.split(",").map(s => s.trim()).filter(Boolean) : [];
  }

  console.log(`\nLooking for security groups in ${vpcId}...`);
  try {
    const data = await ec2Client.send(new DescribeSecurityGroupsCommand({
      Filters: [{ Name: "vpc-id", Values: [vpcId] }],
    }));
    const sgs = data.SecurityGroups || [];

    if (sgs.length > 0) {
      const choices = [
        ...sgs.map((sg) => ({
          name: `${sg.GroupName} (${sg.GroupId})${sg.Description ? ` — ${sg.Description}` : ""}`,
          value: sg.GroupId!,
        })),
        { name: "Skip (use VPC default)", value: "" },
      ];
      const choice = await select({ message: "Security group:", choices });
      return choice ? [choice] : [];
    }
  } catch {
    console.log("  Could not list security groups.");
  }

  const raw = await input({ message: "Security group IDs (comma-separated, optional):" });
  return raw.trim() ? raw.split(",").map(s => s.trim()).filter(Boolean) : [];
}
