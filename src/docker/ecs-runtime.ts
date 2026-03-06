import { execFileSync } from "child_process";
import { createReadStream } from "fs";
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
  FilterLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import {
  CodeBuildClient,
  StartBuildCommand,
  BatchGetBuildsCommand,
  CreateProjectCommand,
} from "@aws-sdk/client-codebuild";
import {
  S3Client,
  PutObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import type { ContainerRuntime, RuntimeLaunchOpts, RuntimeCredentials, SecretMount, BuildImageOpts, RunningAgent } from "./runtime.js";
import { parseCredentialRef } from "../shared/credentials.js";
import { AWS_CONSTANTS } from "../shared/aws-constants.js";

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
  private prefix: string;
  private ecsClient: ECSClient;
  private smClient: SecretsManagerClient;
  private logsClient: CloudWatchLogsClient;
  private cbClient: CodeBuildClient;
  private s3Client: S3Client;

  constructor(config: ECSFargateConfig) {
    this.config = config;
    this.prefix = config.secretPrefix || AWS_CONSTANTS.DEFAULT_SECRET_PREFIX;

    const clientConfig = { region: config.awsRegion };
    this.ecsClient = new ECSClient(clientConfig);
    this.smClient = new SecretsManagerClient(clientConfig);
    this.logsClient = new CloudWatchLogsClient(clientConfig);
    this.cbClient = new CodeBuildClient(clientConfig);
    this.s3Client = new S3Client(clientConfig);
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
    return this.buildImageCodeBuild(opts, remoteTag);
  }

  async pushImage(_localImage: string): Promise<string> {
    // CodeBuild handles build + push in one step; the image is already in ECR
    return `${this.config.ecrRepository}:${_localImage.replace(":", "-")}`;
  }

  private async buildImageCodeBuild(opts: BuildImageOpts, remoteTag: string): Promise<string> {
    const bucket = await this.ensureBuildBucket();
    const projectName = AWS_CONSTANTS.CODEBUILD_PROJECT;
    const registry = this.config.ecrRepository.split("/")[0];

    // Create tarball of build context
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const { randomUUID } = await import("crypto");
    const tarPath = join(tmpdir(), `${AWS_CONSTANTS.BUILD_S3_PREFIX}-${randomUUID().slice(0, 8)}.tar.gz`);

    execFileSync("tar", [
      "czf", tarPath,
      "-C", opts.contextDir,
      ".",
    ], { encoding: "utf-8", timeout: 60_000 });

    // Upload to S3
    const s3Key = `${AWS_CONSTANTS.BUILD_S3_PREFIX}/${opts.tag.replace(":", "-")}-${Date.now()}.tar.gz`;
    await this.s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: createReadStream(tarPath),
    }));

    // Clean up local tarball
    try { const { rmSync } = await import("fs"); rmSync(tarPath); } catch {}

    // Ensure CodeBuild project exists
    await this.ensureCodeBuildProject(projectName, bucket);

    // Start build
    const buildRes = await this.cbClient.send(new StartBuildCommand({
      projectName,
      sourceTypeOverride: "S3",
      sourceLocationOverride: `${bucket}/${s3Key}`,
      environmentVariablesOverride: [
        { name: "IMAGE_URI", value: remoteTag },
        { name: "ECR_REGISTRY", value: registry },
        { name: "DOCKERFILE", value: opts.dockerfile },
      ],
    }));

    const buildId = buildRes.build?.id;
    if (!buildId) throw new Error("CodeBuild did not return a build ID");

    // Poll until complete
    while (true) {
      await sleep(10_000);

      const status = await this.cbClient.send(new BatchGetBuildsCommand({ ids: [buildId] }));
      const build = status.builds?.[0];
      if (!build) throw new Error(`CodeBuild build ${buildId} not found`);

      if (build.buildComplete) {
        if (build.buildStatus !== "SUCCEEDED") {
          const logs = build.logs?.deepLink || "";
          throw new Error(`CodeBuild build failed (${build.buildStatus}). Logs: ${logs}`);
        }
        return remoteTag;
      }
    }
  }

  private async ensureBuildBucket(): Promise<string> {
    if (this.config.buildBucket) {
      return this.config.buildBucket;
    }

    // Derive bucket name from account ID + region
    const accountId = this.getAccountId();
    const bucket = AWS_CONSTANTS.buildBucket(accountId, this.config.awsRegion);

    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (err: any) {
      if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
        await this.s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
      } else if (err.name !== "Forbidden") {
        // Forbidden means bucket exists but we don't own it — try anyway
        throw err;
      }
    }

    return bucket;
  }

  private async ensureCodeBuildProject(projectName: string, bucket: string): Promise<void> {
    const accountId = this.getAccountId();
    const region = this.config.awsRegion;

    try {
      const status = await this.cbClient.send(new BatchGetBuildsCommand({ ids: [`${projectName}:dummy`] }));
      // If the project doesn't exist, BatchGetBuilds returns empty — but we need a better check
      // Actually, just try to create and handle the conflict
      void status;
    } catch {}

    const serviceRole = `arn:aws:iam::${accountId}:role/${AWS_CONSTANTS.CODEBUILD_ROLE}`;

    try {
      await this.cbClient.send(new CreateProjectCommand({
        name: projectName,
        source: {
          type: "S3",
          location: `${bucket}/`,
          buildspec: [
            "version: 0.2",
            "phases:",
            "  pre_build:",
            "    commands:",
            "      - aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY",
            "  build:",
            "    commands:",
            "      - docker build -t $IMAGE_URI -f $DOCKERFILE .",
            "      - docker push $IMAGE_URI",
          ].join("\n"),
        },
        artifacts: { type: "NO_ARTIFACTS" },
        environment: {
          type: "LINUX_CONTAINER",
          computeType: "BUILD_GENERAL1_MEDIUM",
          image: "aws/codebuild/standard:7.0",
          privilegedMode: true,
          environmentVariables: [
            { name: "IMAGE_URI", value: "placeholder" },
            { name: "ECR_REGISTRY", value: "placeholder" },
            { name: "DOCKERFILE", value: "Dockerfile" },
          ],
        },
        serviceRole,
      }));
    } catch (err: any) {
      if (err.name !== "ResourceAlreadyExistsException") {
        throw err;
      }
    }
  }

  // --- Container lifecycle ---

  async launch(opts: RuntimeLaunchOpts): Promise<string> {
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
    const res = await this.logsClient.send(new FilterLogEventsCommand({
      logGroupName: ECSFargateRuntime.LOG_GROUP,
      logStreamNamePrefix: `${AWS_CONSTANTS.agentFamily(agentName)}/`,
      limit,
    }));

    return (res.events ?? [])
      .map((e) => e.message?.trimEnd() ?? "")
      .filter(Boolean);
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
      streamPrefix: string;
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
    return `arn:aws:iam::${accountId}:role/${AWS_CONSTANTS.taskRoleName(agentName)}`;
  }

  private getAccountId(): string {
    const match = this.config.ecrRepository.match(/^(\d+)\.dkr\.ecr\./);
    return match?.[1] || "";
  }

}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
