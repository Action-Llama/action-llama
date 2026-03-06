import { resolve } from "path";
import { existsSync } from "fs";
import { execFileSync } from "child_process";
import { discoverAgents, loadAgentConfig, loadGlobalConfig } from "../../shared/config.js";
import { parseCredentialRef } from "../../shared/credentials.js";

/**
 * `al setup --cloud` — create per-agent IAM resources for cloud runtimes.
 *
 * For Cloud Run (GCP):
 *   Creates per-agent GCP service accounts with GSM secret isolation.
 *
 * For ECS Fargate (AWS):
 *   Creates per-agent IAM task roles with Secrets Manager access policies.
 */
export async function execute(opts: { project: string }): Promise<void> {
  const projectPath = resolve(opts.project);

  if (existsSync(resolve(projectPath, "agent-config.toml")) || existsSync(resolve(projectPath, "PLAYBOOK.md"))) {
    throw new Error(
      `"${projectPath}" looks like an agent directory, not a project directory. ` +
      `Run 'al setup --cloud' from the project root.`
    );
  }

  const globalConfig = loadGlobalConfig(projectPath);
  const dockerConfig = globalConfig.docker;

  if (!dockerConfig || (dockerConfig.runtime !== "cloud-run" && dockerConfig.runtime !== "ecs")) {
    throw new Error(
      "Cloud setup requires docker.runtime = \"cloud-run\" or \"ecs\" in config.toml. " +
      "Set docker.runtime and the required provider-specific fields first."
    );
  }

  if (dockerConfig.runtime === "cloud-run") {
    await executeGcp(projectPath, dockerConfig);
  } else {
    await executeAws(projectPath, dockerConfig);
  }
}

// --- GCP Cloud Run ---

async function executeGcp(
  projectPath: string,
  dockerConfig: { gcpProject?: string; secretPrefix?: string }
): Promise<void> {
  const { gcpProject, secretPrefix: configPrefix } = dockerConfig;
  if (!gcpProject) {
    throw new Error("docker.gcpProject is required in config.toml");
  }

  const secretPrefix = configPrefix || "action-llama";

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

  console.log(`\nSetting up Cloud Run service accounts for ${agents.length} agent(s)...\n`);

  for (const name of agents) {
    const config = loadAgentConfig(projectPath, name);
    const saName = `al-${name}`;
    const saEmail = `${saName}@${gcpProject}.iam.gserviceaccount.com`;

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
      // List fields for this credential from GSM
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
  console.log("\nTo use per-agent SAs, set docker.serviceAccount to the runtime SA (for job creation),");
  console.log("and the per-agent SAs will be used automatically at launch time.");
}

// --- AWS ECS Fargate ---

async function executeAws(
  projectPath: string,
  dockerConfig: { awsRegion?: string; ecrRepository?: string; awsSecretPrefix?: string }
): Promise<void> {
  const { awsRegion, ecrRepository, awsSecretPrefix } = dockerConfig;
  if (!awsRegion) {
    throw new Error("docker.awsRegion is required in config.toml");
  }
  if (!ecrRepository) {
    throw new Error("docker.ecrRepository is required in config.toml");
  }

  const secretPrefix = awsSecretPrefix || "action-llama";

  // Extract account ID from ECR repo URI
  const accountMatch = ecrRepository.match(/^(\d+)\.dkr\.ecr\./);
  if (!accountMatch) {
    throw new Error(
      `Cannot extract AWS account ID from docker.ecrRepository: "${ecrRepository}". ` +
      `Expected format: 123456789012.dkr.ecr.<region>.amazonaws.com/<repo>`
    );
  }
  const accountId = accountMatch[1];

  // Verify AWS CLI is available
  try {
    awsCli(["sts", "get-caller-identity", "--region", awsRegion]);
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

  console.log(`\nSetting up ECS task roles for ${agents.length} agent(s)...\n`);

  for (const name of agents) {
    const config = loadAgentConfig(projectPath, name);
    const roleName = `al-${name}-task-role`;

    console.log(`  Agent: ${name}`);
    console.log(`    Role: ${roleName}`);

    // 1. Create IAM role (idempotent)
    try {
      awsCli([
        "iam", "create-role",
        "--role-name", roleName,
        "--assume-role-policy-document", trustPolicy,
        "--region", awsRegion,
      ]);
      console.log(`    Created IAM role`);
    } catch (err: any) {
      if (err.message?.includes("EntityAlreadyExists")) {
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
      // Wildcard for all fields of this credential
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
        awsCli([
          "iam", "put-role-policy",
          "--role-name", roleName,
          "--policy-name", "SecretsAccess",
          "--policy-document", policy,
          "--region", awsRegion,
        ]);
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

function awsCli(args: string[]): string {
  return execFileSync("aws", args, {
    encoding: "utf-8",
    timeout: 30_000,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
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
