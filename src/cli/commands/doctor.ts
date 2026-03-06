import { resolve } from "path";
import { existsSync } from "fs";
import { input, confirm } from "@inquirer/prompts";
import { execFileSync } from "child_process";
import { discoverAgents, loadAgentConfig, loadGlobalConfig } from "../../shared/config.js";
import type { CloudConfig } from "../../shared/config.js";
import { resolveCredential } from "../../credentials/registry.js";
import { promptCredential } from "../../credentials/prompter.js";
import { parseCredentialRef, credentialExists, listCredentialInstances, writeCredentialFields } from "../../shared/credentials.js";
import { createLocalBackend, createBackendFromCloudConfig } from "../../shared/remote.js";
import type { CredentialDefinition } from "../../credentials/schema.js";

// Webhook secret credential types — these support multiple named instances
const WEBHOOK_SECRET_TYPES: Record<string, string> = {
  github: "github_webhook_secret",
  sentry: "sentry_client_secret",
};

export async function execute(opts: { project: string; cloud?: boolean }): Promise<void> {
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

  // --- Local credential check ---

  // Collect all credential refs from agents
  const credentialRefs = new Set<string>();

  for (const name of agents) {
    const config = loadAgentConfig(projectPath, name);
    for (const ref of config.credentials) {
      credentialRefs.add(ref);
    }
  }

  // Detect which webhook credential types are needed from trigger types
  const neededWebhookCredTypes = new Set<string>();
  for (const name of agents) {
    const config = loadAgentConfig(projectPath, name);
    for (const trigger of config.webhooks || []) {
      const credType = WEBHOOK_SECRET_TYPES[trigger.type];
      if (credType) neededWebhookCredTypes.add(credType);
    }
  }

  const totalItems = credentialRefs.size + neededWebhookCredTypes.size;
  if (totalItems === 0) {
    console.log("No credentials required by any agent.");
  } else {
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

    // Handle webhook secrets separately — these support multiple named instances
    for (const credType of neededWebhookCredTypes) {
      const def = resolveCredential(credType);
      const instances = listCredentialInstances(credType);

      if (instances.length > 0) {
        for (const inst of instances) {
          console.log(`  [ok] ${def.label} (${credType}:${inst})`);
          okCount++;
        }

        const addMore = await confirm({
          message: `Add another ${def.label}? (for a different org/project)`,
          default: false,
        });

        if (addMore) {
          const added = await promptWebhookSecret(def, credType);
          if (added) promptedCount++;
        }
      } else {
        const result = await promptWebhookSecret(def, credType);
        if (result) promptedCount++;
      }
    }

    console.log(`\nDone. ${okCount} already present, ${promptedCount} configured.`);
  }

  // --- Cloud mode ---

  if (opts.cloud) {
    const globalConfig = loadGlobalConfig(projectPath);
    const cloudConfig = globalConfig.cloud;

    if (!cloudConfig) {
      throw new Error(
        "No [cloud] section found in config.toml. " +
        "Run 'al cloud init' to configure a cloud provider first."
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
  }
}

async function promptWebhookSecret(def: CredentialDefinition, credType: string): Promise<boolean> {
  const name = await input({
    message: `${def.label} — name (e.g. "MyOrg", "my-project"):`,
    validate: (v: string) => {
      const trimmed = v.trim();
      if (!trimmed) return "Name is required";
      if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return "Use only letters, numbers, hyphens, and underscores";
      if (credentialExists(credType, trimmed)) return `"${trimmed}" already exists`;
      return true;
    },
  });

  const result = await promptCredential(def, name.trim());
  if (result && Object.keys(result.values).length > 0) {
    writeCredentialFields(credType, name.trim(), result.values);
    return true;
  }
  return false;
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

  const secretPrefix = awsSecretPrefix || "action-llama";

  // Extract account ID from ECR repo URI
  const accountMatch = ecrRepository.match(/^(\d+)\.dkr\.ecr\./);
  if (!accountMatch) {
    throw new Error(
      `Cannot extract AWS account ID from cloud.ecrRepository: "${ecrRepository}". ` +
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
