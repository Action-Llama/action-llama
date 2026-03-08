import { resolve } from "path";
import { existsSync } from "fs";
import { confirm } from "@inquirer/prompts";
import { execFileSync } from "child_process";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { IAMClient, CreateRoleCommand, PutRolePolicyCommand, GetRoleCommand } from "@aws-sdk/client-iam";
import { discoverAgents, loadAgentConfig, loadGlobalConfig } from "../../shared/config.js";
import type { CloudConfig } from "../../shared/config.js";
import { resolveCredential } from "../../credentials/registry.js";
import { promptCredential } from "../../credentials/prompter.js";
import { parseCredentialRef, credentialExists, writeCredentialFields } from "../../shared/credentials.js";
import { createLocalBackend, createBackendFromCloudConfig } from "../../shared/remote.js";
import type { CredentialDefinition } from "../../credentials/schema.js";
import { AWS_CONSTANTS } from "../../shared/aws-constants.js";

// Webhook secret credential types — these support multiple named instances
const WEBHOOK_SECRET_TYPES: Record<string, string> = {
  github: "github_webhook_secret",
  sentry: "sentry_client_secret",
};

export async function execute(opts: { project: string; cloud?: boolean; checkOnly?: boolean }): Promise<void> {
  const projectPath = resolve(opts.project);

  // Guard: refuse to run if the project path looks like an agent directory
  if (existsSync(resolve(projectPath, "agent-config.toml")) || existsSync(resolve(projectPath, "PLAYBOOK.md"))) {
    throw new Error(
      `"${projectPath}" looks like an agent directory, not a project directory. ` +
      `Run 'al doctor' from the project root (the parent directory).`
    );
  }

  const agents = discoverAgents(projectPath);
  if (agents.length === 0) {
    console.log("No agents found. Create agents first, then re-run doctor.");
    return;
  }

  // Collect all credential refs from agents (including webhook secrets)
  const credentialRefs = new Set<string>();
  const globalConfig = loadGlobalConfig(projectPath);
  const webhookSources = globalConfig.webhooks ?? {};

  for (const name of agents) {
    const config = loadAgentConfig(projectPath, name);
    for (const ref of config.credentials) {
      credentialRefs.add(ref);
    }
    // Derive webhook secret credential refs from global webhook sources
    for (const trigger of config.webhooks || []) {
      const sourceConfig = webhookSources[trigger.source];
      if (!sourceConfig) continue;
      const credType = WEBHOOK_SECRET_TYPES[sourceConfig.type];
      if (credType && sourceConfig.credential) {
        credentialRefs.add(`${credType}:${sourceConfig.credential}`);
      }
    }
  }

  if (credentialRefs.size === 0) {
    console.log("No credentials required by any agent.");
  } else if (opts.checkOnly) {
    // --- Non-interactive credential check (headless mode) ---
    let okCount = 0;
    const missing: string[] = [];

    if (opts.cloud) {
      // Check cloud backend
      const globalConfig = loadGlobalConfig(projectPath);
      const cloudConfig = globalConfig.cloud;
      if (!cloudConfig) {
        throw new Error(
          "No [cloud] section found in config.toml. " +
          "Run 'al cloud setup' to configure a cloud provider first."
        );
      }

      const remote = await createBackendFromCloudConfig(cloudConfig);
      console.log(`Checking ${credentialRefs.size} credential(s) in ${cloudConfig.provider}...`);

      for (const ref of credentialRefs) {
        const { type, instance } = parseCredentialRef(ref);
        const def = resolveCredential(type);

        if (await remote.exists(type, instance)) {
          console.log(`  [ok] ${def.label} (${ref})`);
          okCount++;
        } else {
          console.log(`  [MISSING] ${def.label} (${ref})`);
          missing.push(ref);
        }
      }

      if (missing.length > 0) {
        throw new Error(
          `${missing.length} credential(s) missing from ${cloudConfig.provider}: ${missing.join(", ")}.\n` +
          `Push them with 'al doctor -c' first.`
        );
      }

      console.log(`${okCount} credential(s) verified in ${cloudConfig.provider}.`);
    } else {
      // Check local filesystem (no prompts)
      console.log(`Checking ${credentialRefs.size} credential(s)...`);

      for (const ref of credentialRefs) {
        const { type, instance } = parseCredentialRef(ref);
        const def = resolveCredential(type);

        if (credentialExists(type, instance)) {
          console.log(`  [ok] ${def.label} (${ref})`);
          okCount++;
        } else {
          console.log(`  [MISSING] ${def.label} (${ref})`);
          missing.push(ref);
        }
      }

      if (missing.length > 0) {
        throw new Error(
          `${missing.length} credential(s) missing: ${missing.join(", ")}.\n` +
          `Run 'al doctor' interactively to configure them.`
        );
      }

      console.log(`${okCount} credential(s) verified.`);
    }
  } else {
    // --- Interactive credential check (used by `al doctor` and `al doctor -c`) ---
    console.log(`\nChecking ${credentialRefs.size} credential(s)...\n`);

    let okCount = 0;
    let promptedCount = 0;

    for (const ref of credentialRefs) {
      const { type, instance } = parseCredentialRef(ref);
      const def = resolveCredential(type);

      if (credentialExists(type, instance)) {
        console.log(`  [ok] ${def.label} (${ref})`);
        okCount++;
        continue;
      }

      const result = await promptCredential(def, instance);
      if (result && Object.keys(result.values).length > 0) {
        writeCredentialFields(type, instance, result.values);
        promptedCount++;
      }
    }

    console.log(`\nDone. ${okCount} already present, ${promptedCount} configured.`);
  }

  // --- Cloud mode: push creds + reconcile IAM (interactive only) ---

  if (opts.cloud && !opts.checkOnly) {
    const globalConfig = loadGlobalConfig(projectPath);
    const cloudConfig = globalConfig.cloud;

    if (!cloudConfig) {
      throw new Error(
        "No [cloud] section found in config.toml. " +
        "Run 'al cloud setup' to configure a cloud provider first."
      );
    }

    // Push local creds to cloud
    console.log(`\nPushing credentials to cloud (${cloudConfig.provider})...`);
    const local = createLocalBackend();
    const remote = await createBackendFromCloudConfig(cloudConfig);
    const localEntries = await local.list();

    if (localEntries.length === 0) {
      console.log("No local credentials found. Run 'al doctor' first to configure them.");
    } else {
      let pushed = 0;
      for (const entry of localEntries) {
        const value = await local.read(entry.type, entry.instance, entry.field);
        if (value !== undefined) {
          await remote.write(entry.type, entry.instance, entry.field, value);
          pushed++;
        }
      }
      console.log(`Pushed ${pushed} credential field(s) to ${cloudConfig.provider}.`);
    }

    // Reconcile IAM
    console.log(`\nReconciling cloud IAM...`);
    await reconcileCloudIam(projectPath, cloudConfig);
    
    // Validate IAM roles exist for ECS mode
    if (cloudConfig.provider === "ecs") {
      console.log(`\nValidating ECS IAM roles...`);
      await validateEcsRoles(projectPath, cloudConfig);
    }
  }
}

// --- Cloud IAM reconciliation ---

export async function reconcileCloudIam(projectPath: string, cloud: CloudConfig): Promise<void> {
  if (cloud.provider === "cloud-run") {
    await reconcileGcp(projectPath, cloud);
  } else if (cloud.provider === "ecs") {
    await reconcileAws(projectPath, cloud);
  } else {
    throw new Error(`Unknown cloud provider: "${cloud.provider}"`);
  }
}

async function reconcileGcp(projectPath: string, cloud: CloudConfig): Promise<void> {
  const { gcpProject, secretPrefix: configPrefix } = cloud;
  if (!gcpProject) {
    throw new Error("cloud.gcpProject is required in config.toml");
  }

  const secretPrefix = configPrefix || AWS_CONSTANTS.DEFAULT_SECRET_PREFIX;

  // Verify gcloud is available and authenticated
  try {
    gcloud(["auth", "print-access-token"], gcpProject);
  } catch (err: any) {
    throw new Error(
      "gcloud CLI is not authenticated. Run 'gcloud auth login' first.\n" +
      `Original error: ${err.message}`
    );
  }

  const agents = discoverAgents(projectPath);
  if (agents.length === 0) {
    console.log("No agents found. Create agents first.");
    return;
  }

  // Pre-flight: check if any secrets exist in GSM with this prefix
  const preflight = listGsmSecretCount(gcpProject, secretPrefix);
  if (preflight === 0) {
    console.log(
      `\nWarning: No secrets found in GSM with prefix "${secretPrefix}".\n` +
      `IAM bindings are created against existing secrets, so you should push credentials first.\n`
    );
    const proceed = await confirm({
      message: "Continue anyway? (Service accounts will be created but no secrets will be bound)",
      default: false,
    });
    if (!proceed) {
      console.log("Aborted. Push credentials first, then re-run.");
      return;
    }
  }

  console.log(`\nSetting up Cloud Run service accounts for ${agents.length} agent(s)...\n`);

  for (const name of agents) {
    const config = loadAgentConfig(projectPath, name);
    const saName = AWS_CONSTANTS.serviceAccountName(name);
    const saEmail = AWS_CONSTANTS.serviceAccountEmail(name, gcpProject);

    console.log(`  Agent: ${name}`);
    console.log(`    SA: ${saEmail}`);

    // 1. Create service account (idempotent)
    try {
      gcloud([
        "iam", "service-accounts", "create", saName,
        "--display-name", `Action Llama agent: ${name}`,
        "--project", gcpProject,
      ], gcpProject);
      console.log(`    Created service account`);
    } catch (err: any) {
      if (err.message?.includes("already exists")) {
        console.log(`    Service account already exists`);
      } else {
        throw err;
      }
    }

    // 2. Collect all secret names this agent needs
    const credRefs = [...new Set(config.credentials)];
    if (config.model.authType !== "pi_auth" && !credRefs.includes("anthropic_key:default")) {
      credRefs.push("anthropic_key:default");
    }

    const secretNames: string[] = [];
    for (const ref of credRefs) {
      const { type, instance } = parseCredentialRef(ref);
      const fields = listGsmFields(gcpProject, secretPrefix, type, instance);
      for (const field of fields) {
        secretNames.push(`${secretPrefix}--${type}--${instance}--${field}`);
      }
    }

    // 3. Grant secretmanager.secretAccessor on each secret
    let boundCount = 0;
    for (const secretName of secretNames) {
      try {
        gcloud([
          "secrets", "add-iam-policy-binding", secretName,
          "--member", `serviceAccount:${saEmail}`,
          "--role", "roles/secretmanager.secretAccessor",
          "--project", gcpProject,
        ], gcpProject);
        boundCount++;
      } catch (err: any) {
        if (err.message?.includes("already exists") || err.message?.includes("already has")) {
          boundCount++;
        } else {
          console.log(`    Warning: failed to bind ${secretName}: ${err.message}`);
        }
      }
    }
    console.log(`    Bound ${boundCount} secret(s)`);

    // 4. Grant the SA permission to act as itself (for Cloud Run job execution)
    try {
      gcloud([
        "iam", "service-accounts", "add-iam-policy-binding", saEmail,
        "--member", `serviceAccount:${saEmail}`,
        "--role", "roles/iam.serviceAccountUser",
        "--project", gcpProject,
      ], gcpProject);
    } catch {
      // May already be bound
    }

    console.log("");
  }

  console.log("Done. Each agent now has an isolated service account with access to only its declared secrets.");
}

async function reconcileAws(projectPath: string, cloud: CloudConfig): Promise<void> {
  const { awsRegion, ecrRepository, awsSecretPrefix } = cloud;
  if (!awsRegion) {
    throw new Error("cloud.awsRegion is required in config.toml");
  }
  if (!ecrRepository) {
    throw new Error("cloud.ecrRepository is required in config.toml");
  }

  const secretPrefix = awsSecretPrefix || AWS_CONSTANTS.DEFAULT_SECRET_PREFIX;

  // Extract account ID from ECR repo URI
  const accountMatch = ecrRepository.match(/^(\d+)\.dkr\.ecr\./);
  if (!accountMatch) {
    throw new Error(
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
    throw new Error(
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
      throw new Error(
        `Failed to attach ActionLlamaExecution policy to ${executionRoleName}: ${err.message}\n` +
        `The execution role needs secretsmanager:GetSecretValue and logs:CreateLogGroup permissions.\n` +
        `Either grant your IAM user iam:PutRolePolicy on this role, or attach the policy manually in the AWS Console.`
      );
    }
  }

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

  console.log("Done. Each agent now has an isolated IAM task role with access to only its declared secrets.");
  console.log(`\nTask roles follow the convention: al-{agentName}-task-role`);
  console.log("The ECS runtime will use them automatically at launch time.");
}

// --- Helpers ---

function gcloud(args: string[], _project: string): string {
  return execFileSync("gcloud", args, {
    encoding: "utf-8",
    timeout: 30_000,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function listGsmSecretCount(gcpProject: string, prefix: string): number {
  try {
    const output = gcloud([
      "secrets", "list",
      "--filter", `name:${prefix}--`,
      "--format", "value(name)",
      "--project", gcpProject,
    ], gcpProject);
    if (!output.trim()) return 0;
    return output.trim().split("\n").length;
  } catch {
    return 0;
  }
}

function listGsmFields(
  gcpProject: string,
  prefix: string,
  type: string,
  instance: string
): string[] {
  const filter = `name:${prefix}--${type}--${instance}--`;
  try {
    const output = gcloud([
      "secrets", "list",
      "--filter", filter,
      "--format", "value(name)",
      "--project", gcpProject,
    ], gcpProject);

    if (!output.trim()) return [];

    const fields: string[] = [];
    for (const line of output.split("\n")) {
      const secretId = line.trim().split("/").pop()!;
      const parts = secretId.split("--");
      if (parts.length === 4 && parts[0] === prefix && parts[1] === type && parts[2] === instance) {
        fields.push(parts[3]);
      }
    }
    return fields;
  } catch {
    return [];
  }
}

async function validateEcsRoles(projectPath: string, cloud: CloudConfig): Promise<void> {
  const { awsRegion } = cloud;
  if (!awsRegion) {
    throw new Error("cloud.awsRegion is required for ECS validation");
  }

  const agents = discoverAgents(projectPath);
  if (agents.length === 0) return;

  const iamClient = new IAMClient({ region: awsRegion });
  const missing: string[] = [];

  for (const name of agents) {
    const roleName = AWS_CONSTANTS.taskRoleName(name);
    
    try {
      await iamClient.send(new GetRoleCommand({ RoleName: roleName }));
      console.log(`  [ok] ${roleName}`);
    } catch (err: any) {
      if (err.name === "NoSuchEntityException") {
        missing.push(roleName);
        console.log(`  [MISSING] ${roleName}`);
      } else {
        console.log(`  [ERROR] ${roleName}: ${err.message}`);
      }
    }
  }

  if (missing.length > 0) {
    console.log(`\n${missing.length} IAM task role(s) are missing.`);
    console.log("These roles are automatically created when you run 'al doctor -c'.");
    console.log("If they're still missing, you may need to create them manually:");
    for (const role of missing) {
      console.log(`  aws iam create-role --role-name ${role} --assume-role-policy-document file://ecs-trust.json`);
    }
    console.log("\nECS task trust policy (save as ecs-trust.json):");
    console.log(JSON.stringify({
      Version: "2012-10-17",
      Statement: [{
        Effect: "Allow",
        Principal: { Service: "ecs-tasks.amazonaws.com" },
        Action: "sts:AssumeRole",
      }],
    }, null, 2));
  } else {
    console.log(`All ${agents.length} IAM task role(s) exist.`);
  }
}
