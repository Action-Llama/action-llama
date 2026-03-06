import { execFileSync } from "child_process";
import { createHash, createHmac } from "crypto";
import type { ContainerRuntime, RuntimeLaunchOpts, RuntimeCredentials, SecretMount, BuildImageOpts } from "./runtime.js";
import { parseCredentialRef } from "../shared/credentials.js";

export interface ECSFargateConfig {
  awsRegion: string;
  ecsCluster: string;              // ECS cluster name or ARN
  ecrRepository: string;           // ECR repo URI (e.g. "123456789.dkr.ecr.us-east-1.amazonaws.com/al-images")
  executionRoleArn: string;        // IAM role for task execution (ECR pull + CW Logs)
  taskRoleArn: string;             // Default IAM role for the container (Secrets Manager access)
  subnets: string[];               // VPC subnet IDs for Fargate
  securityGroups?: string[];       // Security group IDs
  secretPrefix?: string;           // Secrets Manager name prefix (default: "action-llama")
}

/**
 * AWS ECS Fargate runtime.
 *
 * Launches agents as ECS Fargate tasks with AWS Secrets Manager secrets
 * injected as environment variables or mounted via container definitions.
 *
 * Auth: standard AWS credential chain
 * 1. AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars
 * 2. AWS_PROFILE / ~/.aws/credentials
 * 3. IAM instance role (EC2/ECS/Lambda)
 *
 * The runtime credentials (your machine) need:
 *   - ecs:RegisterTaskDefinition, ecs:RunTask, ecs:DescribeTasks, ecs:StopTask
 *   - ecr:GetAuthorizationToken, ecr:BatchCheckLayerAvailability, ecr:PutImage, etc.
 *   - logs:GetLogEvents
 *
 * The task role (container) needs per-agent:
 *   - secretsmanager:GetSecretValue on its specific secrets
 */
export class ECSFargateRuntime implements ContainerRuntime {
  readonly needsGateway = false;

  private config: ECSFargateConfig;
  private prefix: string;

  constructor(config: ECSFargateConfig) {
    this.config = config;
    this.prefix = config.secretPrefix || "action-llama";
  }

  // --- Credential preparation ---

  async prepareCredentials(credRefs: string[]): Promise<RuntimeCredentials> {
    const mounts: SecretMount[] = [];

    for (const credRef of credRefs) {
      const { type, instance } = parseCredentialRef(credRef);

      // List all fields for this credential by querying Secrets Manager
      const fields = await this.listSecretFields(type, instance);

      for (const field of fields) {
        const secretName = this.awsSecretName(type, instance, field);
        mounts.push({
          secretId: secretName,
          mountPath: `/credentials/${type}/${instance}/${field}`,
        });
      }
    }

    return { strategy: "secrets-manager", mounts };
  }

  cleanupCredentials(_creds: RuntimeCredentials): void {
    // No-op
  }

  // --- Image management ---

  async buildImage(opts: BuildImageOpts): Promise<string> {
    const remoteTag = `${this.config.ecrRepository}:${opts.tag.replace(":", "-")}`;

    // Build locally and push to ECR
    execFileSync("docker", [
      "build", "-t", remoteTag,
      "-f", opts.dockerfile, ".",
    ], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "inherit"],
      timeout: 300_000,
      cwd: opts.contextDir,
    });

    // Authenticate Docker to ECR
    this.ecrLogin();

    execFileSync("docker", ["push", remoteTag], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "inherit"],
      timeout: 300_000,
    });

    return remoteTag;
  }

  async pushImage(localImage: string): Promise<string> {
    const remoteTag = `${this.config.ecrRepository}:${localImage.replace(":", "-")}`;

    execFileSync("docker", ["tag", localImage, remoteTag], {
      encoding: "utf-8",
      timeout: 30_000,
    });

    this.ecrLogin();

    execFileSync("docker", ["push", remoteTag], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "inherit"],
      timeout: 300_000,
    });

    return remoteTag;
  }

  // --- Container lifecycle ---

  async launch(opts: RuntimeLaunchOpts): Promise<string> {
    const family = `al-${opts.agentName}`;

    const secretMounts = opts.credentials.strategy === "secrets-manager"
      ? opts.credentials.mounts
      : [];

    // Use per-agent task role if available, otherwise default
    const perAgentRole = this.deriveTaskRoleArn(opts.agentName);
    const taskRoleArn = opts.serviceAccount || perAgentRole || this.config.taskRoleArn;

    // Register task definition
    const taskDefArn = await this.registerTaskDefinition(family, {
      image: opts.image,
      env: opts.env,
      secretMounts,
      memory: opts.memory || "4096",
      cpus: String((opts.cpus || 2) * 1024), // ECS uses CPU units (1024 = 1 vCPU)
      taskRoleArn,
    });

    // Run task
    const taskArn = await this.runTask(taskDefArn);
    return taskArn;
  }

  streamLogs(
    taskArn: string,
    onLine: (line: string) => void,
    onStderr?: (text: string) => void
  ): { stop: () => void } {
    let stopped = false;
    let nextToken: string | undefined;

    const poll = async () => {
      // Extract task ID from ARN for the log stream name
      const taskId = taskArn.split("/").pop()!;
      const logGroup = `/ecs/al-agent`;
      const logStream = `al-agent/${taskId}`;

      while (!stopped) {
        try {
          const result = await this.getLogEvents(logGroup, logStream, nextToken);
          for (const event of result.events) {
            onLine(event.message);
          }
          if (result.nextForwardToken) {
            nextToken = result.nextForwardToken;
          }
        } catch (err: any) {
          // Log stream may not exist yet
          if (!stopped && onStderr && !err.message?.includes("ResourceNotFoundException")) {
            onStderr(`Log polling error: ${err.message}`);
          }
        }
        if (!stopped) await sleep(5000);
      }
    };

    poll();

    return { stop: () => { stopped = true; } };
  }

  async waitForExit(taskArn: string, timeoutSeconds: number): Promise<number> {
    const deadline = Date.now() + timeoutSeconds * 1000;

    while (Date.now() < deadline) {
      const status = await this.describeTask(taskArn);

      if (status.lastStatus === "STOPPED") {
        // Check container exit code
        const exitCode = status.containers?.[0]?.exitCode;
        return exitCode ?? 1;
      }

      await sleep(10_000);
    }

    await this.kill(taskArn);
    throw new Error(`ECS task ${taskArn} timed out after ${timeoutSeconds}s`);
  }

  async kill(taskArn: string): Promise<void> {
    try {
      await this.awsRequest("ecs", "AmazonEC2ContainerServiceV20141113.StopTask", {
        cluster: this.config.ecsCluster,
        task: taskArn,
        reason: "Action Llama timeout",
      });
    } catch {
      // Task may already be stopped
    }
  }

  async remove(_taskArn: string): Promise<void> {
    // ECS cleans up stopped tasks automatically
  }

  // --- Internal: Secret naming ---

  private awsSecretName(type: string, instance: string, field: string): string {
    // AWS Secrets Manager allows [a-zA-Z0-9/_+=.@-]
    return `${this.prefix}/${type}/${instance}/${field}`;
  }

  private async listSecretFields(type: string, instance: string): Promise<string[]> {
    const prefix = `${this.prefix}/${type}/${instance}/`;

    const data = await this.awsRequest("secretsmanager", "secretsmanager.ListSecrets", {
      Filters: [{ Key: "name", Values: [prefix] }],
      MaxResults: 100,
    });

    const fields: string[] = [];
    for (const secret of data.SecretList || []) {
      const name: string = secret.Name;
      if (name.startsWith(prefix)) {
        fields.push(name.slice(prefix.length));
      }
    }

    return fields;
  }

  // --- Internal: ECS operations ---

  private async registerTaskDefinition(
    family: string,
    opts: {
      image: string;
      env: Record<string, string>;
      secretMounts: SecretMount[];
      memory: string;
      cpus: string;
      taskRoleArn: string;
    }
  ): Promise<string> {
    const envVars = Object.entries(opts.env).map(([name, value]) => ({ name, value }));

    // Map secret mounts to ECS secrets (injected as env vars or files)
    // ECS supports injecting secrets as environment variables from Secrets Manager
    // For file-based injection, we use an init container pattern
    // For simplicity, we mount secrets as env vars with a naming convention
    // The container entry point will handle writing them to /credentials/
    const secrets = opts.secretMounts.map((mount) => {
      // Convert mount path to env var name: /credentials/type/instance/field → AL_SECRET_type__instance__field
      const parts = mount.mountPath.replace("/credentials/", "").split("/");
      const envName = `AL_SECRET_${parts.join("__")}`;
      return {
        name: envName,
        valueFrom: `arn:aws:secretsmanager:${this.config.awsRegion}:${this.getAccountId()}:secret:${mount.secretId}`,
      };
    });

    const containerDef = {
      name: "agent",
      image: opts.image,
      essential: true,
      environment: envVars,
      secrets,
      logConfiguration: {
        logDriver: "awslogs",
        options: {
          "awslogs-group": "/ecs/al-agent",
          "awslogs-region": this.config.awsRegion,
          "awslogs-stream-prefix": "al-agent",
          "awslogs-create-group": "true",
        },
      },
      readonlyRootFilesystem: true,
      user: "1000:1000",
      linuxParameters: {
        initProcessEnabled: true,
        maxSwap: 0,
      },
      tmpfs: [
        { containerPath: "/tmp", size: 512 },
        { containerPath: "/workspace", size: 2048 },
        { containerPath: "/home/node", size: 64 },
      ],
    };

    const data = await this.awsRequest("ecs", "AmazonEC2ContainerServiceV20141113.RegisterTaskDefinition", {
      family,
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"],
      cpu: opts.cpus,
      memory: opts.memory,
      executionRoleArn: this.config.executionRoleArn,
      taskRoleArn: opts.taskRoleArn,
      containerDefinitions: [containerDef],
    });

    return data.taskDefinition.taskDefinitionArn;
  }

  private async runTask(taskDefinitionArn: string): Promise<string> {
    const networkConfig = {
      awsvpcConfiguration: {
        subnets: this.config.subnets,
        securityGroups: this.config.securityGroups || [],
        assignPublicIp: "ENABLED",
      },
    };

    const data = await this.awsRequest("ecs", "AmazonEC2ContainerServiceV20141113.RunTask", {
      cluster: this.config.ecsCluster,
      taskDefinition: taskDefinitionArn,
      launchType: "FARGATE",
      count: 1,
      networkConfiguration: networkConfig,
    });

    const tasks = data.tasks || [];
    if (tasks.length === 0) {
      const failures = data.failures || [];
      const reason = failures[0]?.reason || "unknown";
      throw new Error(`Failed to start ECS task: ${reason}`);
    }

    return tasks[0].taskArn;
  }

  private async describeTask(taskArn: string): Promise<{
    lastStatus: string;
    containers?: Array<{ exitCode?: number }>;
  }> {
    const data = await this.awsRequest("ecs", "AmazonEC2ContainerServiceV20141113.DescribeTasks", {
      cluster: this.config.ecsCluster,
      tasks: [taskArn],
    });

    const task = data.tasks?.[0];
    if (!task) throw new Error(`Task ${taskArn} not found`);

    return {
      lastStatus: task.lastStatus,
      containers: task.containers,
    };
  }

  private async getLogEvents(
    logGroup: string,
    logStream: string,
    nextToken?: string
  ): Promise<{ events: Array<{ message: string }>; nextForwardToken?: string }> {
    const params: Record<string, unknown> = {
      logGroupName: logGroup,
      logStreamName: logStream,
      startFromHead: true,
    };
    if (nextToken) params.nextToken = nextToken;

    const data = await this.awsRequest("logs", "Logs_20140328.GetLogEvents", params);

    return {
      events: (data.events || []).map((e: any) => ({ message: e.message?.trimEnd() || "" })),
      nextForwardToken: data.nextForwardToken,
    };
  }

  // --- Internal: Per-agent task role derivation ---

  private deriveTaskRoleArn(agentName: string): string | undefined {
    // Convention: al-{agentName}-task-role in the same account
    const accountId = this.getAccountId();
    if (!accountId) return undefined;
    return `arn:aws:iam::${accountId}:role/al-${agentName}-task-role`;
  }

  private getAccountId(): string {
    // Extract account ID from ECR repo URI: 123456789.dkr.ecr.region.amazonaws.com/repo
    const match = this.config.ecrRepository.match(/^(\d+)\.dkr\.ecr\./);
    return match?.[1] || "";
  }

  // --- Internal: ECR auth ---

  private ecrLogin(): void {
    // Get ECR login password and pipe to docker login
    const password = execFileSync("aws", [
      "ecr", "get-login-password",
      "--region", this.config.awsRegion,
    ], { encoding: "utf-8", timeout: 15_000 }).trim();

    const registry = this.config.ecrRepository.split("/")[0];
    execFileSync("docker", [
      "login", "--username", "AWS", "--password-stdin", registry,
    ], {
      encoding: "utf-8",
      input: password,
      timeout: 15_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  // --- Internal: AWS API ---

  private async awsRequest(service: string, target: string, body: unknown): Promise<any> {
    const region = this.config.awsRegion;
    const host = `${service}.${region}.amazonaws.com`;
    const url = `https://${host}/`;

    const bodyStr = JSON.stringify(body);
    const headers = await this.signRequest("POST", url, host, service, target, bodyStr);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": target,
      },
      body: bodyStr,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AWS ${service} ${target} failed: ${res.status} ${text}`);
    }

    return res.json();
  }

  private async signRequest(
    method: string,
    url: string,
    host: string,
    service: string,
    _target: string,
    body: string
  ): Promise<Record<string, string>> {
    const { accessKeyId, secretAccessKey, sessionToken } = this.getAwsCredentials();
    const region = this.config.awsRegion;

    const now = new Date();
    const dateStamp = now.toISOString().replace(/[-:]/g, "").slice(0, 8);
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z/, "Z");

    const bodyHash = createHash("sha256").update(body).digest("hex");

    const canonicalHeaders = `host:${host}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = "host;x-amz-date";

    const canonicalRequest = [
      method,
      "/",
      "",
      canonicalHeaders,
      signedHeaders,
      bodyHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");

    const signingKey = this.getSignatureKey(secretAccessKey, dateStamp, region, service);
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

    const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const headers: Record<string, string> = {
      "Host": host,
      "X-Amz-Date": amzDate,
      "Authorization": authHeader,
    };

    if (sessionToken) {
      headers["X-Amz-Security-Token"] = sessionToken;
    }

    return headers;
  }

  private getSignatureKey(key: string, dateStamp: string, region: string, service: string): Buffer {
    const kDate = createHmac("sha256", `AWS4${key}`).update(dateStamp).digest();
    const kRegion = createHmac("sha256", kDate).update(region).digest();
    const kService = createHmac("sha256", kRegion).update(service).digest();
    return createHmac("sha256", kService).update("aws4_request").digest();
  }

  private getAwsCredentials(): {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  } {
    // Check env vars first
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    if (accessKeyId && secretAccessKey) {
      return {
        accessKeyId,
        secretAccessKey,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      };
    }

    // Fall back to AWS CLI
    try {
      const output = execFileSync("aws", [
        "sts", "get-caller-identity",
        "--output", "json",
        "--region", this.config.awsRegion,
      ], { encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] });

      // If this succeeds, the AWS CLI has credentials configured
      // We need the actual credentials from the config
      const credsOutput = execFileSync("aws", [
        "configure", "export-credentials",
        "--format", "env",
      ], { encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] });

      const creds: Record<string, string> = {};
      for (const line of credsOutput.split("\n")) {
        const match = line.match(/^export\s+(\w+)=(.+)$/);
        if (match) creds[match[1]] = match[2].replace(/^"|"$/g, "");
      }

      if (creds.AWS_ACCESS_KEY_ID && creds.AWS_SECRET_ACCESS_KEY) {
        return {
          accessKeyId: creds.AWS_ACCESS_KEY_ID,
          secretAccessKey: creds.AWS_SECRET_ACCESS_KEY,
          sessionToken: creds.AWS_SESSION_TOKEN,
        };
      }
    } catch { /* fall through */ }

    throw new Error(
      "No AWS credentials found. Either:\n" +
      "  1. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY env vars, or\n" +
      "  2. Configure AWS CLI: aws configure"
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
