/**
 * ECS-specific cloud provisioning logic.
 *
 * Extracted from cli/commands/cloud-setup-ecs.ts into the cloud provider module.
 * Contains all AWS resource creation/discovery for ECS Fargate setup.
 */

import { select, input, confirm } from "@inquirer/prompts";

import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import {
  ECRClient,
  DescribeRepositoriesCommand,
  CreateRepositoryCommand,
  SetRepositoryPolicyCommand,
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
  PutRolePolicyCommand,
  PutUserPolicyCommand,
  CreateServiceLinkedRoleCommand,
} from "@aws-sdk/client-iam";
import {
  EC2Client,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
  DescribeSecurityGroupsCommand,
} from "@aws-sdk/client-ec2";
import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  UpdateTimeToLiveCommand,
} from "@aws-sdk/client-dynamodb";

import type { EcsCloudConfig } from "../../shared/config.js";
import { AWS_CONSTANTS } from "./constants.js";
import { buildSchedulerPolicyDocument } from "./iam.js";
import { CONSTANTS } from "../../shared/constants.js";

const CREATE_NEW = "__create_new__";
const MANUAL_INPUT = "__manual_input__";

export async function setupEcsCloud(cloud: EcsCloudConfig): Promise<boolean> {
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
    console.log("  3. Then re-run: al setup cloud\n");
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
  const identity = await stsClient.send(new GetCallerIdentityCommand({}));
  const accountId = identity.Account!;

  // Ensure service-linked roles exist (one-time per AWS account)
  await ensureServiceLinkedRoles(iamClient);

  cloud.ecrRepository = await pickOrCreateEcrRepo(ecrClient, region, accountId);
  await ensureLambdaEcrPolicy(ecrClient, cloud.ecrRepository);
  cloud.ecsCluster = await pickOrCreateEcsCluster(ecsClient);
  cloud.executionRoleArn = await pickOrCreateEcsRole(
    iamClient,
    "Execution role (ECR pull + CloudWatch Logs)",
    AWS_CONSTANTS.EXECUTION_ROLE,
    ["arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"],
  );
  cloud.taskRoleArn = await pickOrCreateEcsRole(
    iamClient,
    "Default task role (Secrets Manager access)",
    AWS_CONSTANTS.DEFAULT_TASK_ROLE,
    [],
    [cloud.executionRoleArn!],
  );

  // Add Secrets Manager + CloudWatch Logs inline policy to execution role
  const executionRoleName = cloud.executionRoleArn!.split("/").pop()!;
  const secretPrefix = CONSTANTS.DEFAULT_SECRET_PREFIX;
  try {
    await iamClient.send(new PutRolePolicyCommand({
      RoleName: executionRoleName,
      PolicyName: "ActionLlamaExecution",
      PolicyDocument: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: "secretsmanager:GetSecretValue",
            Resource: `arn:aws:secretsmanager:${region}:${accountId}:secret:${secretPrefix}/*`,
          },
          {
            Effect: "Allow",
            Action: "logs:CreateLogGroup",
            Resource: `arn:aws:logs:${region}:${accountId}:log-group:${AWS_CONSTANTS.LOG_GROUP}*`,
          },
        ],
      }),
    }));
    console.log(`  Attached ActionLlamaExecution policy to ${executionRoleName}`);
  } catch (err: any) {
    throw new Error(
      `Failed to attach ActionLlamaExecution policy to ${executionRoleName}: ${err.message}\n` +
      `The execution role needs secretsmanager:GetSecretValue and logs:CreateLogGroup permissions.\n` +
      `Either grant your IAM user iam:PutRolePolicy on this role, or attach the policy manually in the AWS Console.`
    );
  }

  // Create CloudWatch log group for ECS task logs
  const cwlClient = new CloudWatchLogsClient({ region });
  try {
    await cwlClient.send(new CreateLogGroupCommand({ logGroupName: AWS_CONSTANTS.LOG_GROUP }));
    console.log(`  Created log group: ${AWS_CONSTANTS.LOG_GROUP}`);
  } catch (err: any) {
    if (err.name === "ResourceAlreadyExistsException") {
      console.log(`  Log group already exists: ${AWS_CONSTANTS.LOG_GROUP}`);
    } else {
      console.log(`  Warning: could not create log group: ${err.message}`);
    }
  }

  // Create DynamoDB state table for scheduler persistence
  await ensureStateTable(region);

  // Create CodeBuild service role for remote image builds
  await ensureCodeBuildRole(iamClient, accountId, region, cloud.ecrRepository!);

  // Create App Runner roles for cloud deploy
  cloud.appRunnerAccessRoleArn = await ensureAppRunnerAccessRole(iamClient);
  cloud.appRunnerInstanceRoleArn = await ensureAppRunnerInstanceRole(
    iamClient, accountId, region, cloud.ecrRepository!,
  );

  const result = await pickVpcAndSubnets(ec2Client);
  cloud.subnets = result.subnets;

  const sgs = await pickSecurityGroups(ec2Client, result.vpcId);
  if (sgs.length > 0) cloud.securityGroups = sgs;

  const prefix = await input({ message: "Secret prefix:", default: CONSTANTS.DEFAULT_SECRET_PREFIX });
  if (prefix !== CONSTANTS.DEFAULT_SECRET_PREFIX) cloud.awsSecretPrefix = prefix;

  // Grant iam:PassRole, logs read, and iam:PutUserPolicy to the calling
  // IAM user so that al start/run can assign roles, al logs can read
  // CloudWatch, and al doctor -c can update this policy later.
  const callerArn = identity.Arn!;
  const userMatch = callerArn.match(/:user\/(.+)$/);
  if (userMatch) {
    const userName = userMatch[1];
    const operatorPolicy = JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: "iam:PassRole",
          Resource: `arn:aws:iam::${accountId}:role/al-*`,
        },
        {
          Effect: "Allow",
          Action: [
            "logs:CreateLogGroup",
            "logs:GetLogEvents",
            "logs:FilterLogEvents",
          ],
          Resource: [
            `arn:aws:logs:${region}:${accountId}:log-group:${AWS_CONSTANTS.LOG_GROUP}*`,
            `arn:aws:logs:${region}:${accountId}:log-group:${AWS_CONSTANTS.LAMBDA_LOG_GROUP}/al-*`,
            `arn:aws:logs:${region}:${accountId}:log-group:${AWS_CONSTANTS.APPRUNNER_LOG_GROUP}*`,
          ],
        },
        {
          Effect: "Allow",
          Action: [
            "apprunner:CreateService",
            "apprunner:UpdateService",
            "apprunner:DescribeService",
            "apprunner:DeleteService",
          ],
          Resource: `arn:aws:apprunner:${region}:${accountId}:service/al-scheduler/*`,
        },
        {
          Effect: "Allow",
          Action: "apprunner:ListServices",
          Resource: "*",
        },
        {
          Effect: "Allow",
          Action: "iam:PutUserPolicy",
          Resource: `arn:aws:iam::${accountId}:user/${userName}`,
        },
        {
          Effect: "Allow",
          Action: "iam:CreateServiceLinkedRole",
          Resource: [
            `arn:aws:iam::${accountId}:role/aws-service-role/ecs.amazonaws.com/*`,
            `arn:aws:iam::${accountId}:role/aws-service-role/apprunner.amazonaws.com/*`,
          ],
        },
      ],
    });
    try {
      await iamClient.send(new PutUserPolicyCommand({
        UserName: userName,
        PolicyName: "ActionLlamaOperator",
        PolicyDocument: operatorPolicy,
      }));
      console.log(`  Granted iam:PassRole + logs read permissions to user ${userName}`);
    } catch (err: any) {
      console.log(`\n  Warning: could not auto-grant operator permissions to user ${userName}: ${err.message}`);
      console.log(`  You must manually attach the ActionLlamaOperator policy to user "${userName}" in the AWS Console.`);
      console.log(`  See docs/ecs.md "Operator IAM policy" for the full policy document.`);
    }
  }

  return true;
}

// --- Service-linked roles ---

async function ensureServiceLinkedRoles(iamClient: IAMClient): Promise<void> {
  const services = [
    { name: "ECS", serviceName: "ecs.amazonaws.com" },
    { name: "App Runner", serviceName: "apprunner.amazonaws.com" },
  ];

  for (const svc of services) {
    try {
      await iamClient.send(new CreateServiceLinkedRoleCommand({
        AWSServiceName: svc.serviceName,
      }));
      console.log(`  Created service-linked role for ${svc.name}`);
    } catch (err: any) {
      if (err.name === "InvalidInputException" && err.message?.includes("already exists")) {
        console.log(`  Service-linked role for ${svc.name} already exists`);
      } else {
        console.log(`  Warning: could not create service-linked role for ${svc.name}: ${err.message}`);
        console.log(`  You may need to run: aws iam create-service-linked-role --aws-service-name ${svc.serviceName}`);
      }
    }
  }
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

  const name = await input({ message: "New ECR repository name:", default: AWS_CONSTANTS.DEFAULT_ECR_REPO });
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

async function ensureLambdaEcrPolicy(ecrClient: ECRClient, ecrRepoUri: string): Promise<void> {
  const repoName = ecrRepoUri.split("/").pop();
  if (!repoName) return;

  const policy = JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Sid: "LambdaECRImageRetrievalPolicy",
      Effect: "Allow",
      Principal: { Service: "lambda.amazonaws.com" },
      Action: [
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
      ],
    }],
  });

  try {
    await ecrClient.send(new SetRepositoryPolicyCommand({
      repositoryName: repoName,
      policyText: policy,
    }));
    console.log(`  ECR repository policy: granted Lambda pull access`);
  } catch (err: any) {
    console.log(`  Warning: could not set ECR repository policy for Lambda: ${err.message}`);
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

  const name = await input({ message: "New ECS cluster name:", default: AWS_CONSTANTS.DEFAULT_CLUSTER });
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

async function pickOrCreateEcsRole(iamClient: IAMClient, label: string, defaultName: string, managedPolicies: string[], excludeArns?: string[]): Promise<string> {
  console.log(`\nLooking for IAM roles (${label})...`);
  try {
    const data = await iamClient.send(new ListRolesCommand({ MaxItems: 200 }));
    const ecsRoles = (data.Roles || []).filter((r) => {
      if (excludeArns?.includes(r.Arn!)) return false;
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
      // Sort so the expected default role appears first
      const sorted = [...ecsRoles].sort((a, b) => {
        const aMatch = a.RoleName === defaultName ? 0 : 1;
        const bMatch = b.RoleName === defaultName ? 0 : 1;
        return aMatch - bMatch || a.RoleName!.localeCompare(b.RoleName!);
      });
      const defaultArn = sorted.find((r) => r.RoleName === defaultName)?.Arn;
      const choices = [
        ...sorted.map((r) => ({ name: r.RoleName!, value: r.Arn! })),
        { name: `Create new: ${defaultName}`, value: CREATE_NEW },
        { name: "Enter ARN manually", value: MANUAL_INPUT },
      ];
      const choice = await select({ message: `${label}:`, choices, default: defaultArn });
      if (choice === MANUAL_INPUT) return input({ message: `${label} ARN:` });
      if (choice !== CREATE_NEW) return choice;
    } else {
      console.log("  No ECS-compatible IAM roles found.");
    }
  } catch {
    // iam:ListRoles not available — try to find the default role directly
    try {
      const data = await iamClient.send(new GetRoleCommand({ RoleName: defaultName }));
      const arn = data.Role!.Arn!;
      console.log(`  Found existing role: ${arn}`);
      const choices = [
        { name: `Use ${defaultName}`, value: arn },
        { name: "Enter ARN manually", value: MANUAL_INPUT },
      ];
      const choice = await select({ message: `${label}:`, choices });
      if (choice === MANUAL_INPUT) return input({ message: `${label} ARN:` });
      return choice;
    } catch {
      console.log("  No existing role found.");
    }
  }

  const name = await input({ message: "New role name:", default: defaultName });

  // Check if the role already exists before trying to create
  try {
    const data = await iamClient.send(new GetRoleCommand({ RoleName: name }));
    const arn = data.Role!.Arn!;
    console.log(`  Role already exists: ${arn}`);
    return arn;
  } catch {
    // Role doesn't exist — create it
  }

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
    console.log(`  Failed to create role: ${err.message}`);
    return input({ message: `${label} ARN:` });
  }
}

async function ensureCodeBuildRole(iamClient: IAMClient, accountId: string, region: string, ecrRepository: string): Promise<void> {
  const roleName = AWS_CONSTANTS.CODEBUILD_ROLE;
  console.log(`\nEnsuring CodeBuild service role (${roleName})...`);

  const trustPolicy = JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Principal: { Service: "codebuild.amazonaws.com" },
      Action: "sts:AssumeRole",
    }],
  });

  try {
    await iamClient.send(new CreateRoleCommand({
      RoleName: roleName,
      AssumeRolePolicyDocument: trustPolicy,
    }));
    console.log(`  Created role: ${roleName}`);
  } catch (err: any) {
    if (err.name === "EntityAlreadyExistsException") {
      console.log(`  Role already exists`);
    } else {
      console.log(`  Warning: could not create ${roleName}: ${err.message}`);
      return;
    }
  }

  // ECR push + S3 read + CloudWatch Logs
  const repoArn = `arn:aws:ecr:${region}:${accountId}:repository/${ecrRepository.split("/").pop()}`;
  const bucketName = AWS_CONSTANTS.buildBucket(accountId, region);

  try {
    await iamClient.send(new PutRolePolicyCommand({
      RoleName: roleName,
      PolicyName: "CodeBuildPermissions",
      PolicyDocument: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: "ecr:GetAuthorizationToken",
            Resource: "*",
          },
          {
            Effect: "Allow",
            Action: [
              "ecr:BatchCheckLayerAvailability",
              "ecr:PutImage",
              "ecr:InitiateLayerUpload",
              "ecr:UploadLayerPart",
              "ecr:CompleteLayerUpload",
              "ecr:GetDownloadUrlForLayer",
              "ecr:BatchGetImage",
            ],
            Resource: repoArn,
          },
          {
            Effect: "Allow",
            Action: "s3:GetObject",
            Resource: `arn:aws:s3:::${bucketName}/*`,
          },
          {
            Effect: "Allow",
            Action: [
              "logs:CreateLogGroup",
              "logs:CreateLogStream",
              "logs:PutLogEvents",
            ],
            Resource: "*",
          },
        ],
      }),
    }));
    console.log(`  Attached CodeBuildPermissions policy`);
  } catch (err: any) {
    console.log(`  Warning: could not attach policy to ${roleName}: ${err.message}`);
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

async function ensureAppRunnerAccessRole(iamClient: IAMClient): Promise<string> {
  const roleName = AWS_CONSTANTS.APPRUNNER_ACCESS_ROLE;
  console.log(`\nEnsuring App Runner access role (${roleName})...`);

  const trustPolicy = JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Principal: { Service: "build.apprunner.amazonaws.com" },
      Action: "sts:AssumeRole",
    }],
  });

  try {
    await iamClient.send(new CreateRoleCommand({
      RoleName: roleName,
      AssumeRolePolicyDocument: trustPolicy,
    }));
    console.log(`  Created role: ${roleName}`);
  } catch (err: any) {
    if (err.name === "EntityAlreadyExistsException") {
      console.log(`  Role already exists`);
    } else {
      console.log(`  Warning: could not create ${roleName}: ${err.message}`);
      return input({ message: "App Runner access role ARN:" });
    }
  }

  try {
    await iamClient.send(new AttachRolePolicyCommand({
      RoleName: roleName,
      PolicyArn: "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess",
    }));
    console.log(`  Attached AWSAppRunnerServicePolicyForECRAccess`);
  } catch (err: any) {
    console.log(`  Warning: could not attach ECR access policy: ${err.message}`);
  }

  const data = await iamClient.send(new GetRoleCommand({ RoleName: roleName }));
  return data.Role!.Arn!;
}

async function ensureAppRunnerInstanceRole(
  iamClient: IAMClient, accountId: string, region: string, ecrRepository: string,
): Promise<string> {
  const roleName = AWS_CONSTANTS.APPRUNNER_INSTANCE_ROLE;
  console.log(`\nEnsuring App Runner instance role (${roleName})...`);

  const trustPolicy = JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Principal: { Service: "tasks.apprunner.amazonaws.com" },
      Action: "sts:AssumeRole",
    }],
  });

  try {
    await iamClient.send(new CreateRoleCommand({
      RoleName: roleName,
      AssumeRolePolicyDocument: trustPolicy,
    }));
    console.log(`  Created role: ${roleName}`);
  } catch (err: any) {
    if (err.name === "EntityAlreadyExistsException") {
      console.log(`  Role already exists`);
    } else {
      console.log(`  Warning: could not create ${roleName}: ${err.message}`);
      return input({ message: "App Runner instance role ARN:" });
    }
  }

  const bucketName = AWS_CONSTANTS.buildBucket(accountId, region);
  const policyDoc = buildSchedulerPolicyDocument(accountId, region, bucketName);

  try {
    await iamClient.send(new PutRolePolicyCommand({
      RoleName: roleName,
      PolicyName: "ActionLlamaScheduler",
      PolicyDocument: JSON.stringify(policyDoc),
    }));
    console.log(`  Attached ActionLlamaScheduler policy`);
  } catch (err: any) {
    console.log(`  Warning: could not attach policy to ${roleName}: ${err.message}`);
  }

  const data = await iamClient.send(new GetRoleCommand({ RoleName: roleName }));
  return data.Role!.Arn!;
}

async function ensureStateTable(region: string): Promise<void> {
  const tableName = AWS_CONSTANTS.STATE_TABLE;
  console.log(`\nEnsuring DynamoDB state table (${tableName})...`);
  const client = new DynamoDBClient({ region });

  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    console.log(`  Table already exists`);
    return;
  } catch (err: any) {
    if (err.name !== "ResourceNotFoundException") {
      console.log(`  Warning: could not check state table: ${err.message}`);
      return;
    }
  }

  try {
    await client.send(new CreateTableCommand({
      TableName: tableName,
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }));
    console.log(`  Created table: ${tableName}`);

    // Wait for ACTIVE status
    for (let i = 0; i < 30; i++) {
      const desc = await client.send(new DescribeTableCommand({ TableName: tableName }));
      if (desc.Table?.TableStatus === "ACTIVE") break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    // Enable TTL
    await client.send(new UpdateTimeToLiveCommand({
      TableName: tableName,
      TimeToLiveSpecification: { Enabled: true, AttributeName: "expiresAt" },
    }));
    console.log(`  Enabled TTL on expiresAt`);
  } catch (err: any) {
    console.log(`  Warning: could not create state table: ${err.message}`);
  }
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
