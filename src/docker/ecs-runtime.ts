import { execFileSync } from "child_process";
import {
  ECSClient,
  RegisterTaskDefinitionCommand,
  RunTaskCommand,
  DescribeTasksCommand,
  StopTaskCommand,
  ListTasksCommand,
} from "@aws-sdk/client-ecs";
import {
  SecretsManagerClient,
  ListSecretsCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import {
  ECRClient,
  GetAuthorizationTokenCommand,
} from "@aws-sdk/client-ecr";
import type { ContainerRuntime, RuntimeLaunchOpts, RuntimeCredentials, SecretMount, BuildImageOpts, RunningAgent } from "./runtime.js";
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
  private prefix: string;
  private ecsClient: ECSClient;
  private smClient: SecretsManagerClient;
  private logsClient: CloudWatchLogsClient;
  private ecrClient: ECRClient;

  constructor(config: ECSFargateConfig) {
    this.config = config;
    this.prefix = config.secretPrefix || "action-llama";

    const clientConfig = { region: config.awsRegion };
    this.ecsClient = new ECSClient(clientConfig);
    this.smClient = new SecretsManagerClient(clientConfig);
    this.logsClient = new CloudWatchLogsClient(clientConfig);
    this.ecrClient = new ECRClient(clientConfig);
  }

  private static readonly STARTED_BY_PREFIX = "action-llama";

  // --- Agent tracking ---

  async isAgentRunning(agentName: string): Promise<boolean> {
    const family = `al-${agentName}`;
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
      const agentName = family.startsWith("al-") ? family.slice(3) : family;
      return {
        agentName,
        taskId: task.taskArn?.split("/").pop() ?? task.taskArn ?? "unknown",
        status: task.lastStatus ?? "UNKNOWN",
        startedAt: task.startedAt,
      };
    });
  }

  // --- Credential preparation ---

  async prepareCredentials(credRefs: string[]): Promise<RuntimeCredentials> {
    const mounts: SecretMount[] = [];

    for (const credRef of credRefs) {
      const { type, instance } = parseCredentialRef(credRef);
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

    execFileSync("docker", [
      "build", "-t", remoteTag,
      "-f", opts.dockerfile, ".",
    ], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "inherit"],
      timeout: 300_000,
      cwd: opts.contextDir,
    });

    await this.ecrLogin();

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

    await this.ecrLogin();

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

    const perAgentRole = this.deriveTaskRoleArn(opts.agentName);
    const taskRoleArn = opts.serviceAccount || perAgentRole || this.config.taskRoleArn;

    const taskDefArn = await this.registerTaskDefinition(family, {
      image: opts.image,
      env: opts.env,
      secretMounts,
      memory: opts.memory || "4096",
      cpus: String((opts.cpus || 2) * 1024),
      taskRoleArn,
    });

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
        reason: "Action Llama timeout",
      }));
    } catch {
      // Task may already be stopped
    }
  }

  async remove(_taskArn: string): Promise<void> {
    // ECS cleans up stopped tasks automatically
  }

  // --- Internal: Secret naming ---

  private awsSecretName(type: string, instance: string, field: string): string {
    return `${this.prefix}/${type}/${instance}/${field}`;
  }

  private async listSecretFields(type: string, instance: string): Promise<string[]> {
    const prefix = `${this.prefix}/${type}/${instance}/`;

    const res = await this.smClient.send(new ListSecretsCommand({
      Filters: [{ Key: "name", Values: [prefix] }],
      MaxResults: 100,
    }));

    const fields: string[] = [];
    for (const secret of res.SecretList || []) {
      if (secret.Name?.startsWith(prefix)) {
        fields.push(secret.Name.slice(prefix.length));
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
    const environment = Object.entries(opts.env).map(([name, value]) => ({ name, value }));

    const secrets = opts.secretMounts.map((mount) => {
      const parts = mount.mountPath.replace("/credentials/", "").split("/");
      const envName = `AL_SECRET_${parts.join("__")}`;
      return {
        name: envName,
        valueFrom: `arn:aws:secretsmanager:${this.config.awsRegion}:${this.getAccountId()}:secret:${mount.secretId}`,
      };
    });

    const res = await this.ecsClient.send(new RegisterTaskDefinitionCommand({
      family,
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"],
      cpu: opts.cpus,
      memory: opts.memory,
      executionRoleArn: this.config.executionRoleArn,
      taskRoleArn: opts.taskRoleArn,
      containerDefinitions: [{
        name: "agent",
        image: opts.image,
        essential: true,
        environment,
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
      }],
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
      throw new Error(`Failed to start ECS task: ${reason}`);
    }

    return tasks[0].taskArn!;
  }

  private async getLogEvents(
    logGroup: string,
    logStream: string,
    nextToken?: string
  ): Promise<{ events: Array<{ message: string }>; nextForwardToken?: string }> {
    const res = await this.logsClient.send(new GetLogEventsCommand({
      logGroupName: logGroup,
      logStreamName: logStream,
      startFromHead: true,
      nextToken,
    }));

    return {
      events: (res.events || []).map((e) => ({ message: e.message?.trimEnd() || "" })),
      nextForwardToken: res.nextForwardToken,
    };
  }

  // --- Internal: Per-agent task role derivation ---

  private deriveTaskRoleArn(agentName: string): string | undefined {
    const accountId = this.getAccountId();
    if (!accountId) return undefined;
    return `arn:aws:iam::${accountId}:role/al-${agentName}-task-role`;
  }

  private getAccountId(): string {
    const match = this.config.ecrRepository.match(/^(\d+)\.dkr\.ecr\./);
    return match?.[1] || "";
  }

  // --- Internal: ECR auth ---

  private async ecrLogin(): Promise<void> {
    const res = await this.ecrClient.send(new GetAuthorizationTokenCommand({}));
    const authData = res.authorizationData?.[0];
    if (!authData?.authorizationToken) {
      throw new Error("Failed to get ECR authorization token");
    }

    // Token is base64-encoded "AWS:<password>"
    const decoded = Buffer.from(authData.authorizationToken, "base64").toString();
    const password = decoded.split(":")[1];

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
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
