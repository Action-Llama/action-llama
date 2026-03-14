/**
 * AWS IAM reconciliation for ECS cloud agents.
 *
 * Extracted from cli/commands/cloud-iam.ts into the cloud provider module.
 * Handles per-agent IAM task roles, Lambda roles, and ECR policies.
 */

import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import {
  IAMClient,
  CreateRoleCommand,
  PutRolePolicyCommand,
  PutUserPolicyCommand,
  GetRoleCommand,
} from "@aws-sdk/client-iam";
import { ECRClient, SetRepositoryPolicyCommand } from "@aws-sdk/client-ecr";
import { discoverAgents, loadAgentConfig, loadGlobalConfig } from "../../shared/config.js";
import type { EcsCloudConfig } from "../../shared/config.js";
import { parseCredentialRef } from "../../shared/credentials.js";
import { AWS_CONSTANTS } from "./constants.js";
import { CONSTANTS } from "../../shared/constants.js";
import { ConfigError, CloudProviderError } from "../../shared/errors.js";

/**
 * Reconcile per-agent ECS task roles and Secrets Manager policies.
 *
 * Creates an IAM task role for each agent with a trust policy for
 * ecs-tasks.amazonaws.com, then attaches an inline policy granting
 * secretsmanager:GetSecretValue on each agent's declared credentials.
 */
export async function reconcileAwsAgents(projectPath: string, cloud: EcsCloudConfig): Promise<void> {
  const { awsRegion, ecrRepository, awsSecretPrefix } = cloud;
  if (!awsRegion) {
    throw new ConfigError("cloud.awsRegion is required in config.toml");
  }
  if (!ecrRepository) {
    throw new ConfigError("cloud.ecrRepository is required in config.toml");
  }

  const secretPrefix = awsSecretPrefix || CONSTANTS.DEFAULT_SECRET_PREFIX;

  // Extract account ID from ECR repo URI
  const accountMatch = ecrRepository.match(/^(\d+)\.dkr\.ecr\./);
  if (!accountMatch) {
    throw new ConfigError(
      `Cannot extract AWS account ID from cloud.ecrRepository: "${ecrRepository}". ` +
      `Expected format: 123456789012.dkr.ecr.<region>.amazonaws.com/<repo>`
    );
  }
  const accountId = accountMatch[1];

  // Verify AWS credentials are valid
  const stsClient = new STSClient({ region: awsRegion });
  try {
    await stsClient.send(new GetCallerIdentityCommand({}));
  } catch (err: any) {
    throw new CloudProviderError(
      "AWS CLI is not authenticated. Run 'aws configure' or set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY.\n" +
      `Original error: ${err.message}`
    );
  }

  const agents = discoverAgents(projectPath);
  if (agents.length === 0) {
    console.log("No agents found. Create agents first.");
    return;
  }

  // Trust policy for ECS tasks
  const trustPolicy = JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Principal: { Service: "ecs-tasks.amazonaws.com" },
      Action: "sts:AssumeRole",
    }],
  });

  const iamClient = new IAMClient({ region: awsRegion });

  // Ensure execution role has Secrets Manager access (ECS uses this role to inject secrets)
  if (cloud.executionRoleArn) {
    const executionRoleName = cloud.executionRoleArn.split("/").pop()!;
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
              Resource: `arn:aws:secretsmanager:${awsRegion}:${accountId}:secret:${secretPrefix}/*`,
            },
            {
              Effect: "Allow",
              Action: "logs:CreateLogGroup",
              Resource: `arn:aws:logs:${awsRegion}:${accountId}:log-group:${AWS_CONSTANTS.LOG_GROUP}*`,
            },
          ],
        }),
      }));
      console.log(`Execution role (${executionRoleName}): Secrets Manager + CloudWatch policy applied`);
    } catch (err: any) {
      throw new CloudProviderError(
        `Failed to attach ActionLlamaExecution policy to ${executionRoleName}: ${err.message}\n` +
        `The execution role needs secretsmanager:GetSecretValue and logs:CreateLogGroup permissions.\n` +
        `Either grant your IAM user iam:PutRolePolicy on this role, or attach the policy manually in the AWS Console.`
      );
    }
  }

  // Ensure ECR repository policy grants Lambda pull access
  await ensureLambdaEcrPolicy(awsRegion, ecrRepository);

  console.log(`\nSetting up ECS task roles for ${agents.length} agent(s)...\n`);

  for (const name of agents) {
    const config = loadAgentConfig(projectPath, name);
    const roleName = AWS_CONSTANTS.taskRoleName(name);

    console.log(`  Agent: ${name}`);
    console.log(`    Role: ${roleName}`);

    // 1. Create IAM role (idempotent)
    try {
      await iamClient.send(new CreateRoleCommand({
        RoleName: roleName,
        AssumeRolePolicyDocument: trustPolicy,
      }));
      console.log(`    Created IAM role`);
    } catch (err: any) {
      if (err.name === "EntityAlreadyExistsException") {
        console.log(`    IAM role already exists`);
      } else {
        throw err;
      }
    }

    // 2. Collect secret ARNs this agent needs
    const credRefs = [...new Set(config.credentials)];
    if (config.model.authType !== "pi_auth" && !credRefs.includes("anthropic_key:default")) {
      credRefs.push("anthropic_key:default");
    }

    const secretArns: string[] = [];
    for (const ref of credRefs) {
      const { type, instance } = parseCredentialRef(ref);
      secretArns.push(
        `arn:aws:secretsmanager:${awsRegion}:${accountId}:secret:${secretPrefix}/${type}/${instance}/*`
      );
    }

    // 3. Put inline policy for Secrets Manager access
    if (secretArns.length > 0) {
      const policy = JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Action: "secretsmanager:GetSecretValue",
          Resource: secretArns,
        }],
      });

      try {
        await iamClient.send(new PutRolePolicyCommand({
          RoleName: roleName,
          PolicyName: "SecretsAccess",
          PolicyDocument: policy,
        }));
        console.log(`    Bound ${secretArns.length} secret path(s)`);
      } catch (err: any) {
        console.log(`    Warning: failed to put policy: ${err.message}`);
      }
    } else {
      console.log(`    No secrets to bind`);
    }

    console.log("");
  }

  // Grant iam:PassRole on ECS task roles + execution role to the calling identity
  const taskRoleArns = agents.map(
    (name) => `arn:aws:iam::${accountId}:role/${AWS_CONSTANTS.taskRoleName(name)}`
  );
  if (cloud.executionRoleArn) {
    taskRoleArns.push(cloud.executionRoleArn);
  }
  if (taskRoleArns.length > 0) {
    await grantPassRole(awsRegion, iamClient, taskRoleArns, "ActionLlamaEcsPassRole");
  }

  console.log("Done. Each agent now has an isolated IAM task role with access to only its declared secrets.");
  console.log(`\nTask roles follow the convention: al-{agentName}-task-role`);
  console.log("The ECS runtime will use them automatically at launch time.");
}

// --- Helpers ---

/**
 * Grant iam:PassRole on the given role ARNs to the calling IAM user.
 * Required so the CLI can assign roles to ECS tasks and Lambda functions.
 */
export async function grantPassRole(
  awsRegion: string,
  iamClient: IAMClient,
  roleArns: string[],
  policyName: string,
): Promise<void> {
  const stsClient = new STSClient({ region: awsRegion });
  const identity = await stsClient.send(new GetCallerIdentityCommand({}));
  const callerArn = identity.Arn!;

  // Extract user name from ARN (arn:aws:iam::ACCOUNT:user/USERNAME)
  const userMatch = callerArn.match(/:user\/(.+)$/);
  if (!userMatch) {
    console.log(`\n  Note: Caller ${callerArn} is not an IAM user — skipping iam:PassRole auto-grant.`);
    console.log(`  If you get PassRole errors, add this policy to your IAM identity:`);
    console.log(JSON.stringify({
      Version: "2012-10-17",
      Statement: [{
        Effect: "Allow",
        Action: "iam:PassRole",
        Resource: roleArns,
      }],
    }, null, 2));
    return;
  }

  const userName = userMatch[1];
  const policy = JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Action: "iam:PassRole",
      Resource: roleArns,
    }],
  });

  try {
    await iamClient.send(new PutUserPolicyCommand({
      UserName: userName,
      PolicyName: policyName,
      PolicyDocument: policy,
    }));
    console.log(`  Granted iam:PassRole on ${roleArns.length} role(s) to user ${userName}`);
  } catch (err: any) {
    console.log(`  Warning: could not grant iam:PassRole to user ${userName}: ${err.message}`);
    console.log(`  You may need to manually add iam:PassRole permission for these roles:`);
    for (const arn of roleArns) {
      console.log(`    - ${arn}`);
    }
  }
}

/**
 * Validate that per-agent ECS task roles exist and have correct trust policies.
 */
export async function validateEcsRoles(projectPath: string, cloud: EcsCloudConfig): Promise<void> {
  const { awsRegion } = cloud;
  if (!awsRegion) {
    throw new ConfigError("cloud.awsRegion is required for ECS validation");
  }

  const agents = discoverAgents(projectPath);
  if (agents.length === 0) return;

  const iamClient = new IAMClient({ region: awsRegion });
  const missing: string[] = [];
  const hasIncorrectTrust: string[] = [];

  for (const name of agents) {
    const roleName = AWS_CONSTANTS.taskRoleName(name);

    try {
      const role = await iamClient.send(new GetRoleCommand({ RoleName: roleName }));

      // Check if the role has the correct trust policy for ECS tasks
      const trustPolicy = JSON.parse(decodeURIComponent(role.Role!.AssumeRolePolicyDocument!));
      const hasEcsTrust = trustPolicy.Statement?.some((stmt: any) =>
        stmt.Effect === "Allow" &&
        stmt.Principal?.Service === "ecs-tasks.amazonaws.com" &&
        (stmt.Action === "sts:AssumeRole" || stmt.Action?.includes("sts:AssumeRole"))
      );

      if (!hasEcsTrust) {
        hasIncorrectTrust.push(roleName);
        console.log(`  [TRUST ISSUE] ${roleName} - missing ECS task trust policy`);
      } else {
        console.log(`  [ok] ${roleName}`);
      }
    } catch (err: any) {
      if (err.name === "NoSuchEntityException") {
        missing.push(roleName);
        console.log(`  [MISSING] ${roleName}`);
      } else {
        console.log(`  [ERROR] ${roleName}: ${err.message}`);
      }
    }
  }

  if (missing.length > 0 || hasIncorrectTrust.length > 0) {
    console.log(`\nFound IAM role issues that will cause ECS task failures:`);

    if (missing.length > 0) {
      console.log(`\n${missing.length} IAM task role(s) are missing:`);
      missing.forEach(role => console.log(`  - ${role}`));
      console.log(`\nFix: Run 'al doctor -c' to create missing roles automatically.`);
    }

    if (hasIncorrectTrust.length > 0) {
      console.log(`\n${hasIncorrectTrust.length} IAM role(s) have incorrect trust policies:`);
      hasIncorrectTrust.forEach(role => console.log(`  - ${role}`));
      console.log(`\nFix: Update trust policy to allow ECS tasks to assume the role:`);
      console.log(`For each role above, run:`);
      console.log(`  aws iam update-assume-role-policy --role-name ROLE_NAME --policy-document file://ecs-trust.json`);
    }

    console.log(`\nECS task trust policy (save as ecs-trust.json):`);
    console.log(JSON.stringify({
      Version: "2012-10-17",
      Statement: [{
        Effect: "Allow",
        Principal: { Service: "ecs-tasks.amazonaws.com" },
        Action: "sts:AssumeRole",
      }],
    }, null, 2));

    console.log(`\nAlternatively, re-run the cloud setup to fix all issues:`);
    console.log(`  al setup cloud`);

    // Throw error to prevent proceeding with invalid configuration
    throw new CloudProviderError(`${missing.length + hasIncorrectTrust.length} IAM task role(s) have issues that will prevent ECS tasks from starting. Fix the roles above before proceeding.`);
  } else {
    console.log(`All ${agents.length} IAM task role(s) exist and have correct trust policies.`);
  }
}

/**
 * Ensure the ECR repository policy grants Lambda pull access.
 */
export async function ensureLambdaEcrPolicy(awsRegion: string, ecrRepoUri: string): Promise<void> {
  const repoName = ecrRepoUri.split("/").pop();
  if (!repoName) return;

  const ecrClient = new ECRClient({ region: awsRegion });
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
    console.log(`ECR repository policy: granted Lambda pull access`);
  } catch (err: any) {
    console.log(`Warning: could not set ECR repository policy for Lambda: ${err.message}`);
  }
}

/**
 * Reconcile per-agent Lambda execution roles for agents with short timeouts.
 *
 * Agents with timeout <= LAMBDA_MAX_TIMEOUT are automatically routed to Lambda.
 * Each gets an IAM role with Secrets Manager, ECR, and CloudWatch Logs access.
 */
export async function reconcileLambdaRoles(projectPath: string, cloud: EcsCloudConfig): Promise<void> {
  const { awsRegion, ecrRepository, awsSecretPrefix } = cloud;
  if (!awsRegion || !ecrRepository) return;

  const secretPrefix = awsSecretPrefix || CONSTANTS.DEFAULT_SECRET_PREFIX;
  const accountMatch = ecrRepository.match(/^(\d+)\.dkr\.ecr\./);
  if (!accountMatch) return;
  const accountId = accountMatch[1];

  const globalConfig = loadGlobalConfig(projectPath);
  const agents = discoverAgents(projectPath);
  const iamClient = new IAMClient({ region: awsRegion });

  // Trust policy for Lambda
  const trustPolicy = JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Principal: { Service: "lambda.amazonaws.com" },
      Action: "sts:AssumeRole",
    }],
  });

  let created = 0;
  for (const name of agents) {
    const config = loadAgentConfig(projectPath, name);
    const effectiveTimeout = config.timeout ?? globalConfig.local?.timeout ?? 900;

    // Only create Lambda roles for agents that will route to Lambda
    if (effectiveTimeout > AWS_CONSTANTS.LAMBDA_MAX_TIMEOUT) continue;

    const roleName = AWS_CONSTANTS.lambdaRoleName(name);

    // Create role
    try {
      await iamClient.send(new CreateRoleCommand({
        RoleName: roleName,
        AssumeRolePolicyDocument: trustPolicy,
      }));
      console.log(`  Created Lambda role: ${roleName}`);
      created++;
    } catch (err: any) {
      if (err.name === "EntityAlreadyExistsException") {
        console.log(`  [ok] ${roleName}`);
      } else {
        console.log(`  [ERROR] ${roleName}: ${err.message}`);
        continue;
      }
    }

    // Add secrets + ECR + logs policy
    const credRefs = [...new Set(config.credentials)];
    if (config.model.authType !== "pi_auth" && !credRefs.includes("anthropic_key:default")) {
      credRefs.push("anthropic_key:default");
    }

    const secretArns: string[] = credRefs.map((ref) => {
      const { type, instance } = parseCredentialRef(ref);
      return `arn:aws:secretsmanager:${awsRegion}:${accountId}:secret:${secretPrefix}/${type}/${instance}/*`;
    });

    const policy = JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: "secretsmanager:GetSecretValue",
          Resource: secretArns,
        },
        {
          Effect: "Allow",
          Action: [
            "logs:CreateLogGroup",
            "logs:CreateLogStream",
            "logs:PutLogEvents",
          ],
          Resource: `arn:aws:logs:${awsRegion}:${accountId}:*`,
        },
        {
          Effect: "Allow",
          Action: "ecr:GetAuthorizationToken",
          Resource: "*",
        },
        {
          Effect: "Allow",
          Action: [
            "ecr:BatchGetImage",
            "ecr:GetDownloadUrlForLayer",
          ],
          Resource: `arn:aws:ecr:${awsRegion}:${accountId}:repository/*`,
        },
      ],
    });

    try {
      await iamClient.send(new PutRolePolicyCommand({
        RoleName: roleName,
        PolicyName: "LambdaExecution",
        PolicyDocument: policy,
      }));
    } catch (err: any) {
      console.log(`  Warning: failed to put policy on ${roleName}: ${err.message}`);
    }
  }

  if (created > 0) {
    console.log(`Created ${created} Lambda execution role(s).`);
  } else {
    console.log(`All Lambda roles up to date.`);
  }

  // Grant iam:PassRole on Lambda roles to the calling identity
  const lambdaRoleArns = agents
    .filter((name) => {
      const config = loadAgentConfig(projectPath, name);
      const effectiveTimeout = config.timeout ?? globalConfig.local?.timeout ?? 900;
      return effectiveTimeout <= AWS_CONSTANTS.LAMBDA_MAX_TIMEOUT;
    })
    .map((name) => `arn:aws:iam::${accountId}:role/${AWS_CONSTANTS.lambdaRoleName(name)}`);

  if (lambdaRoleArns.length > 0) {
    await grantPassRole(awsRegion, iamClient, lambdaRoleArns, "ActionLlamaLambdaPassRole");
  }
}
