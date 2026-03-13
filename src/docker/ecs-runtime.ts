import {
  ECSClient,
  RegisterTaskDefinitionCommand,
  RunTaskCommand,
  DescribeTasksCommand,
  StopTaskCommand,
  ListTasksCommand,
} from "@aws-sdk/client-ecs";
import type { ContainerRuntime, RuntimeLaunchOpts, RuntimeCredentials, SecretMount, BuildImageOpts, AssembleImageOpts, RunningAgent } from "./runtime.js";
import { AwsSharedUtils } from "./aws-shared.js";
import { AWS_CONSTANTS } from "../shared/aws-constants.js";
import { sanitizeEnvPart } from "../shared/credentials.js";
import type { TelemetryConfig } from "../shared/config.js";

export interface ECSFargateConfig {
  awsRegion: string;
  ecsCluster: string;              // ECS cluster name or ARN
  ecrRepository: string;           // ECR repo URI (e.g. "123456789.dkr.ecr.us-east-1.amazonaws.com/al-images")
  executionRoleArn: string;        // IAM role for task execution (ECR pull + CW Logs)
  taskRoleArn: string;             // Default IAM role for the container (Secrets Manager access)
  subnets: string[];               // VPC subnet IDs for Fargate
  securityGroups?: string[];       // Security group IDs
  secretPrefix?: string;           // Secrets Manager name prefix
  buildBucket?: string;            // S3 bucket for CodeBuild source (remote builds)
}

/**
 * AWS ECS Fargate runtime.
 *
 * Launches agents as ECS Fargate tasks with AWS Secrets Manager secrets
 * injected as environment variables or mounted via container definitions.
 *
 * Auth: AWS SDK default credential provider chain
 * 1. AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars
 * 2. AWS_PROFILE / ~/.aws/credentials
 * 3. SSO / IAM instance role (EC2/ECS/Lambda)
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
  private ecsClient: ECSClient;
  private shared: AwsSharedUtils;

  constructor(config: ECSFargateConfig) {
    this.config = config;
    this.ecsClient = new ECSClient({ region: config.awsRegion });
    this.shared = new AwsSharedUtils({
      awsRegion: config.awsRegion,
      ecrRepository: config.ecrRepository,
      secretPrefix: config.secretPrefix,
      buildBucket: config.buildBucket,
    });
  }

  private static readonly STARTED_BY_PREFIX = AWS_CONSTANTS.STARTED_BY;
  static readonly LOG_GROUP = AWS_CONSTANTS.LOG_GROUP;

  // --- Agent tracking ---

  async isAgentRunning(agentName: string): Promise<boolean> {
    const family = AWS_CONSTANTS.agentFamily(agentName);
    const res = await this.ecsClient.send(new ListTasksCommand({
      cluster: this.config.ecsCluster,
      family,
      desiredStatus: "RUNNING",
    }));
    return (res.taskArns?.length ?? 0) > 0;
  }

  async listRunningAgents(): Promise<RunningAgent[]> {
    const res = await this.ecsClient.send(new ListTasksCommand({
      cluster: this.config.ecsCluster,
      startedBy: ECSFargateRuntime.STARTED_BY_PREFIX,
      desiredStatus: "RUNNING",
    }));

    const taskArns = res.taskArns ?? [];
    if (taskArns.length === 0) return [];

    const desc = await this.ecsClient.send(new DescribeTasksCommand({
      cluster: this.config.ecsCluster,
      tasks: taskArns,
    }));

    return (desc.tasks ?? []).map((task) => {
      const family = task.taskDefinitionArn?.split("/").pop()?.split(":")[0] ?? "";
      const agentName = AWS_CONSTANTS.agentNameFromFamily(family);
      return {
        agentName,
        taskId: task.taskArn?.split("/").pop() ?? task.taskArn ?? "unknown",
        status: task.lastStatus ?? "UNKNOWN",
        startedAt: task.startedAt,
      };
    });
  }

  // --- Credential preparation (delegates to shared) ---

  async prepareCredentials(credRefs: string[]): Promise<RuntimeCredentials> {
    return this.shared.prepareCredentials(credRefs);
  }

  cleanupCredentials(_creds: RuntimeCredentials): void {
    // No-op
  }

  // --- Image management (delegates to shared) ---

  async buildImage(opts: BuildImageOpts): Promise<string> {
    return this.shared.buildImageCodeBuild(opts, opts.onProgress);
  }

  async pushImage(image: string): Promise<string> {
    // CodeBuild handles build + push in one step; the image is already in ECR
    return image;
  }

  async assembleImageDirect(opts: AssembleImageOpts): Promise<string> {
    return this.shared.assembleImageDirect(opts);
  }

  async buildMultipleImages(builds: BuildImageOpts[], onProgress?: (message: string) => void): Promise<string[]> {
    return this.shared.buildMultipleImagesCodeBuild(builds, onProgress);
  }

  // --- Container lifecycle ---

  async launch(opts: RuntimeLaunchOpts): Promise<string> {
    await this.shared.ensureLogGroup(ECSFargateRuntime.LOG_GROUP);

    const family = AWS_CONSTANTS.agentFamily(opts.agentName);

    const secretMounts = opts.credentials.strategy === "secrets-manager"
      ? opts.credentials.mounts
      : [];

    const perAgentRole = this.deriveTaskRoleArn(opts.agentName);
    const taskRoleArn = opts.serviceAccount || perAgentRole || this.config.taskRoleArn;

    const taskDefArn = await this.registerTaskDefinition(family, {
      image: opts.image,
      env: opts.env,
      secretMounts,
      memory: opts.memory || "4096",
      cpus: String((opts.cpus || 2) * 1024),
      taskRoleArn,
      streamPrefix: family,
      telemetry: opts.telemetry,
    });

    try {
      const taskArn = await this.runTask(taskDefArn);
      return taskArn;
    } catch (err: any) {
      // Improve error message for common IAM role issues
      if (err.message?.includes("Unable to assume the service linked role") ||
          err.message?.includes("Unable to assume the role")) {
        const roleName = AWS_CONSTANTS.taskRoleName(opts.agentName);
        const accountId = this.shared.getAccountId();
        const roleArn = `arn:aws:iam::${accountId}:role/${roleName}`;

        const betterMessage = `❌ Failed to start ECS task for agent "${opts.agentName}"\n\n` +
          `🔍 Problem: ECS cannot assume the IAM task role "${roleName}"\n` +
          `   Expected role ARN: ${roleArn}\n\n` +
          `This typically happens with the second agent in a project when the role wasn't ` +
          `created during initial setup, or the trust policy is incorrect.\n\n` +
          `🔧 Recommended solution:\n` +
          `   al doctor -c\n\n` +
          `This validates and creates missing IAM roles with correct permissions.\n\n` +
          `🔍 Manual diagnosis:\n` +
          `   1. Check if role exists: aws iam get-role --role-name ${roleName}\n` +
          `   2. If it exists, verify trust policy allows "ecs-tasks.amazonaws.com"\n` +
          `   3. If missing, role will be created by 'al doctor -c'\n\n` +
          `💡 Common causes:\n` +
          `   • Role doesn't exist (most common for 2nd+ agents)\n` +
          `   • Role exists but trust policy doesn't allow ECS\n` +
          `   • Permissions on the role are insufficient\n\n` +
          `Original error: ${err.message}`;
        throw new Error(betterMessage);
      }
      throw err;
    }
  }

  streamLogs(
    taskArn: string,
    onLine: (line: string) => void,
    onStderr?: (text: string) => void
  ): { stop: () => void } {
    let stopped = false;
    let nextToken: string | undefined;

    const poll = async () => {
      const taskId = taskArn.split("/").pop()!;
      const logGroup = ECSFargateRuntime.LOG_GROUP;

      // Describe the task to get the family (used as stream prefix)
      const desc = await this.ecsClient.send(new DescribeTasksCommand({
        cluster: this.config.ecsCluster,
        tasks: [taskArn],
      }));
      const family = desc.tasks?.[0]?.taskDefinitionArn?.split("/").pop()?.split(":")[0] ?? AWS_CONSTANTS.agentFamily("agent");
      // awslogs stream format: <prefix>/<container-name>/<task-id>
      const logStream = `${family}/agent/${taskId}`;

      while (!stopped) {
        try {
          const result = await this.shared.getLogEvents(logGroup, logStream, nextToken);
          for (const event of result.events) {
            onLine(event.message);
          }
          if (result.nextForwardToken) {
            nextToken = result.nextForwardToken;
          }
        } catch (err: any) {
          if (!stopped && onStderr && err.name !== "ResourceNotFoundException") {
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
      const res = await this.ecsClient.send(new DescribeTasksCommand({
        cluster: this.config.ecsCluster,
        tasks: [taskArn],
      }));

      const task = res.tasks?.[0];
      if (!task) throw new Error(`Task ${taskArn} not found`);

      if (task.lastStatus === "STOPPED") {
        const exitCode = task.containers?.[0]?.exitCode;
        return exitCode ?? 1;
      }

      await sleep(10_000);
    }

    await this.kill(taskArn);
    throw new Error(`ECS task ${taskArn} timed out after ${timeoutSeconds}s`);
  }

  async kill(taskArn: string): Promise<void> {
    try {
      await this.ecsClient.send(new StopTaskCommand({
        cluster: this.config.ecsCluster,
        task: taskArn,
        reason: "action-llama timeout",
      }));
    } catch {
      // Task may already be stopped
    }
  }

  async remove(_taskArn: string): Promise<void> {
    // ECS cleans up stopped tasks automatically
  }

  async fetchLogs(agentName: string, limit: number): Promise<string[]> {
    return this.shared.tailLogEvents(
      ECSFargateRuntime.LOG_GROUP,
      `${AWS_CONSTANTS.agentFamily(agentName)}/`,
      limit,
    );
  }

  followLogs(
    agentName: string,
    onLine: (line: string) => void,
    onStderr?: (text: string) => void
  ): { stop: () => void } {
    let stopped = false;
    const logGroup = ECSFargateRuntime.LOG_GROUP;
    const streamPrefix = `${AWS_CONSTANTS.agentFamily(agentName)}/`;
    const startTime = Date.now() - 60_000; // start from 1 minute ago

    const poll = async () => {
      let nextToken: string | undefined;

      while (!stopped) {
        try {
          const res = await this.shared.filterLogEventsRaw(logGroup, streamPrefix, nextToken, startTime);
          for (const line of res.events) {
            onLine(line);
          }
          if (res.nextToken) {
            nextToken = res.nextToken;
          }
        } catch (err: any) {
          if (!stopped && onStderr && err.name !== "ResourceNotFoundException") {
            onStderr(`Log polling error: ${err.message}`);
          }
        }
        if (!stopped) await sleep(5000);
      }
    };

    poll();

    return { stop: () => { stopped = true; } };
  }

  getTaskUrl(taskArn: string): string | null {
    // taskArn format: arn:aws:ecs:{region}:{account}:task/{cluster}/{taskId}
    const arnParts = taskArn.split(":");
    if (arnParts.length >= 6) {
      const region = arnParts[3];
      const resourceParts = arnParts[5].split("/"); // task/{cluster}/{taskId}
      if (resourceParts.length >= 3) {
        const cluster = resourceParts[1];
        const taskId = resourceParts[2];
        return `https://${region}.console.aws.amazon.com/ecs/v2/clusters/${cluster}/tasks/${taskId}?region=${region}`;
      }
    }
    return null;
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
      streamPrefix: string;
      telemetry?: TelemetryConfig;
    }
  ): Promise<string> {
    const environment = Object.entries(opts.env).map(([name, value]) => ({ name, value }));

    const secrets = opts.secretMounts.map((mount) => {
      const parts = mount.mountPath.replace("/credentials/", "").split("/");
      const envName = `AL_SECRET_${parts.map(sanitizeEnvPart).join("__")}`;
      return {
        name: envName,
        valueFrom: `arn:aws:secretsmanager:${this.config.awsRegion}:${this.shared.getAccountId()}:secret:${mount.secretId}`,
      };
    });

    // Build container definitions - start with the main agent container
    const containerDefinitions: any[] = [{
      name: "agent",
      image: opts.image,
      essential: true,
      environment: [
        ...environment,
        // Add telemetry collector endpoint if telemetry is enabled
        ...(opts.telemetry?.enabled ? [{
          name: "OTEL_EXPORTER_OTLP_ENDPOINT",
          value: "http://localhost:4317"
        }] : [])
      ],
      secrets,
      logConfiguration: {
        logDriver: "awslogs",
        options: {
          "awslogs-group": ECSFargateRuntime.LOG_GROUP,
          "awslogs-region": this.config.awsRegion,
          "awslogs-stream-prefix": opts.streamPrefix,
          "awslogs-create-group": "true",
        },
      },
      user: "1000:1000",
      linuxParameters: {
        initProcessEnabled: true,
      },
      // Agent depends on telemetry collector if enabled
      ...(opts.telemetry?.enabled ? {
        dependsOn: [{
          containerName: "adot-collector",
          condition: "START"
        }]
      } : {})
    }];

    // Add ADOT collector sidecar if telemetry is enabled
    if (opts.telemetry?.enabled && (opts.telemetry.provider === "otel" || opts.telemetry.provider === "xray")) {
      containerDefinitions.push({
        name: "adot-collector",
        image: "public.ecr.aws/aws-observability/aws-otel-collector:latest",
        essential: false, // Non-essential so agent failure doesn't kill sidecar
        environment: [
          { name: "AWS_REGION", value: this.config.awsRegion }
        ],
        command: ["--config=/etc/otelcol-contrib/otel-collector-config.yaml"],
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": ECSFargateRuntime.LOG_GROUP,
            "awslogs-region": this.config.awsRegion,
            "awslogs-stream-prefix": `${opts.streamPrefix}-adot`,
            "awslogs-create-group": "true",
          },
        },
        portMappings: [
          { containerPort: 4317, protocol: "tcp" }, // gRPC
          { containerPort: 4318, protocol: "tcp" }  // HTTP
        ]
      });
    }

    const res = await this.ecsClient.send(new RegisterTaskDefinitionCommand({
      family,
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"],
      cpu: opts.cpus,
      memory: opts.memory,
      executionRoleArn: this.config.executionRoleArn,
      taskRoleArn: opts.taskRoleArn,
      containerDefinitions,
    }));

    return res.taskDefinition!.taskDefinitionArn!;
  }

  private async runTask(taskDefinitionArn: string): Promise<string> {
    const res = await this.ecsClient.send(new RunTaskCommand({
      cluster: this.config.ecsCluster,
      taskDefinition: taskDefinitionArn,
      launchType: "FARGATE",
      startedBy: ECSFargateRuntime.STARTED_BY_PREFIX,
      count: 1,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: this.config.subnets,
          securityGroups: this.config.securityGroups || [],
          assignPublicIp: "ENABLED",
        },
      },
    }));

    const tasks = res.tasks || [];
    if (tasks.length === 0) {
      const failures = res.failures || [];
      const reason = failures[0]?.reason || "unknown";

      // Extract agent name from task definition ARN for better error messages
      const family = taskDefinitionArn.split("/").pop()?.split(":")[0] ?? "";
      const agentName = AWS_CONSTANTS.agentNameFromFamily(family);

      // Provide specific guidance for role assumption failures
      if (reason.includes("Unable to assume the role") ||
          reason.includes("arn:aws:iam::") && reason.includes("role/al-")) {

        const roleName = AWS_CONSTANTS.taskRoleName(agentName);
        const accountId = this.shared.getAccountId();
        const roleArn = `arn:aws:iam::${accountId}:role/${roleName}`;

        throw new Error(
          `❌ ECS failed to start task for agent "${agentName}"\n\n` +
          `🔍 Root cause: ECS cannot assume IAM role "${roleName}"\n` +
          `   Role ARN: ${roleArn}\n\n` +
          `This is a common issue when setting up multiple agents. The second (and subsequent) ` +
          `agents often fail because their IAM roles weren't created during initial setup.\n\n` +
          `🔧 Quick fix (recommended):\n` +
          `   al doctor -c\n\n` +
          `This will create the missing role and set up proper permissions.\n\n` +
          `🔧 Alternative manual fix:\n` +
          `   1. Create the role:\n` +
          `      aws iam create-role --role-name ${roleName} --assume-role-policy-document file://ecs-trust.json\n` +
          `   2. Add secrets access policy:\n` +
          `      aws iam put-role-policy --role-name ${roleName} --policy-name SecretsAccess --policy-document file://secrets-policy.json\n\n` +
          `🔍 To diagnose the exact issue:\n` +
          `   aws iam get-role --role-name ${roleName}\n\n` +
          `Original ECS error: ${reason}`
        );
      }

      throw new Error(`Failed to start ECS task: ${reason}`);
    }

    return tasks[0].taskArn!;
  }

  // --- Internal: Per-agent task role derivation ---

  private deriveTaskRoleArn(agentName: string): string | undefined {
    const accountId = this.shared.getAccountId();
    if (!accountId) return undefined;
    return `arn:aws:iam::${accountId}:role/${AWS_CONSTANTS.taskRoleName(agentName)}`;
  }

}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
