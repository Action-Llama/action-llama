/**
 * AWS Lambda runtime.
 *
 * Automatically used for ECS-provider agents with timeout <= 900s (15 min).
 * Uses the same ECR images and Secrets Manager credentials as ECS Fargate,
 * but runs as Lambda functions for faster cold starts and lower cost.
 */

import {
  LambdaClient,
  GetFunctionCommand,
  CreateFunctionCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  InvokeCommand,
  PutFunctionEventInvokeConfigCommand,
} from "@aws-sdk/client-lambda";
import type { ContainerRuntime, RuntimeLaunchOpts, RuntimeCredentials, BuildImageOpts, RunningAgent } from "./runtime.js";
import { AwsSharedUtils } from "./aws-shared.js";
import { AWS_CONSTANTS } from "../shared/aws-constants.js";

export interface LambdaRuntimeConfig {
  awsRegion: string;
  ecrRepository: string;
  secretPrefix?: string;
  buildBucket?: string;
  lambdaRoleArn?: string;
  lambdaSubnets?: string[];
  lambdaSecurityGroups?: string[];
}

export class LambdaRuntime implements ContainerRuntime {
  readonly needsGateway = false;

  private config: LambdaRuntimeConfig;
  private lambdaClient: LambdaClient;
  private shared: AwsSharedUtils;

  constructor(config: LambdaRuntimeConfig) {
    this.config = config;
    this.lambdaClient = new LambdaClient({ region: config.awsRegion });
    this.shared = new AwsSharedUtils({
      awsRegion: config.awsRegion,
      ecrRepository: config.ecrRepository,
      secretPrefix: config.secretPrefix,
      buildBucket: config.buildBucket,
    });
  }

  // --- Agent tracking ---

  async isAgentRunning(_agentName: string): Promise<boolean> {
    // Lambda invocations are fire-and-forget; we don't track running state
    return false;
  }

  async listRunningAgents(): Promise<RunningAgent[]> {
    // Lambda doesn't expose running invocations
    return [];
  }

  // --- Credential preparation ---

  async prepareCredentials(credRefs: string[]): Promise<RuntimeCredentials> {
    // Use the same secrets-manager strategy as ECS for consistency.
    // Actual secret values are resolved at launch time and passed as env vars.
    return this.shared.prepareCredentials(credRefs);
  }

  cleanupCredentials(_creds: RuntimeCredentials): void {
    // No-op
  }

  // --- Image management (delegates to shared CodeBuild/ECR) ---

  async buildImage(opts: BuildImageOpts): Promise<string> {
    return this.shared.buildImageCodeBuild(opts, opts.onProgress);
  }

  async pushImage(_localImage: string): Promise<string> {
    return `${this.config.ecrRepository}:${_localImage.replace(":", "-")}`;
  }

  // --- Container lifecycle ---

  async launch(opts: RuntimeLaunchOpts): Promise<string> {
    const functionName = AWS_CONSTANTS.lambdaFunction(opts.agentName);
    const timeout = parseInt(opts.env.TIMEOUT_SECONDS || "900", 10);
    const memoryMb = Math.min(
      parseInt(opts.memory || "512", 10),
      AWS_CONSTANTS.LAMBDA_MAX_MEMORY,
    );

    // Resolve secrets from Secrets Manager on the scheduler side and pass
    // them in the invoke payload (256 KB limit) instead of env vars (4 KB
    // limit).  The Lambda handler injects them as AL_SECRET_* env vars
    // before calling runAgent(), so the container itself never needs
    // Secrets Manager access — each agent can only see its own credentials.
    const credRefs = opts.credentials.strategy === "secrets-manager"
      ? opts.credentials.mounts.map((m) => {
          // Reconstruct credential ref from mount path
          const parts = m.mountPath.replace("/credentials/", "").split("/");
          return `${parts[0]}:${parts[1]}`;
        })
      : [];
    const uniqueCredRefs = [...new Set(credRefs)];
    const secretEnv = await this.shared.resolveSecretValues(uniqueCredRefs);

    const environment = {
      Variables: {
        ...opts.env,
      },
    };

    const roleArn = this.deriveLambdaRoleArn(opts.agentName);

    // Check if function exists
    let functionExists = false;
    try {
      await this.lambdaClient.send(new GetFunctionCommand({
        FunctionName: functionName,
      }));
      functionExists = true;
    } catch (err: any) {
      if (err.name !== "ResourceNotFoundException") throw err;
    }

    if (functionExists) {
      // Update code first, then configuration
      await this.lambdaClient.send(new UpdateFunctionCodeCommand({
        FunctionName: functionName,
        ImageUri: opts.image,
      }));

      // Wait for code update to complete before updating config
      await this.waitForFunctionReady(functionName);

      await this.lambdaClient.send(new UpdateFunctionConfigurationCommand({
        FunctionName: functionName,
        Timeout: Math.min(timeout, AWS_CONSTANTS.LAMBDA_MAX_TIMEOUT),
        MemorySize: memoryMb,
        Environment: environment,
        ImageConfig: {
          EntryPoint: ["node", "/app/dist/agents/lambda-handler.js"],
        },
        ...(this.config.lambdaSubnets?.length ? {
          VpcConfig: {
            SubnetIds: this.config.lambdaSubnets,
            SecurityGroupIds: this.config.lambdaSecurityGroups || [],
          },
        } : {}),
      }));
    } else {
      // Create new function — override ENTRYPOINT to use the Lambda Runtime
      // API handler instead of the default container-entry.js direct runner.
      await this.lambdaClient.send(new CreateFunctionCommand({
        FunctionName: functionName,
        PackageType: "Image",
        Code: { ImageUri: opts.image },
        Role: roleArn,
        Timeout: Math.min(timeout, AWS_CONSTANTS.LAMBDA_MAX_TIMEOUT),
        MemorySize: memoryMb,
        Environment: environment,
        ImageConfig: {
          EntryPoint: ["node", "/app/dist/agents/lambda-handler.js"],
        },
        ...(this.config.lambdaSubnets?.length ? {
          VpcConfig: {
            SubnetIds: this.config.lambdaSubnets,
            SecurityGroupIds: this.config.lambdaSecurityGroups || [],
          },
        } : {}),
      }));
    }

    // Disable automatic async invocation retries — the scheduler handles
    // retry/rerun logic itself; Lambda's default 2 retries cause duplicate
    // container starts on transient failures.
    await this.lambdaClient.send(new PutFunctionEventInvokeConfigCommand({
      FunctionName: functionName,
      MaximumRetryAttempts: 0,
    }));

    // Wait for function to be ready before invoking
    await this.waitForFunctionReady(functionName);

    const launchTime = Date.now();

    // Invoke asynchronously — pass resolved secrets in the payload so the
    // container doesn't need Secrets Manager access (least-privilege).
    const payload: Record<string, any> = { source: "action-llama" };
    if (Object.keys(secretEnv).length > 0) {
      payload.secrets = secretEnv;
    }
    const invokeRes = await this.lambdaClient.send(new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify(payload)),
    }));

    // Return a synthetic ID: functionName + requestId + launchTime for tracking
    const requestId = invokeRes.$metadata.requestId || `${functionName}-${launchTime}`;
    return `lambda:${functionName}:${requestId}:${launchTime}`;
  }

  streamLogs(
    containerId: string,
    onLine: (line: string) => void,
    onStderr?: (text: string) => void
  ): { stop: () => void } {
    let stopped = false;
    const functionName = this.parseFunctionName(containerId);
    const launchTime = this.parseLaunchTime(containerId);
    const logGroupName = `${AWS_CONSTANTS.LAMBDA_LOG_GROUP}/${functionName}`;

    const poll = async () => {
      // Wait a bit for logs to become available
      await sleep(5000);

      let nextToken: string | undefined;

      while (!stopped) {
        try {
          const res = await this.shared.filterLogEventsRaw(logGroupName, "", nextToken, launchTime);
          for (const line of res.events) {
            onLine(line);
          }
          if (res.nextToken) {
            nextToken = res.nextToken;
          }
        } catch (err: any) {
          if (!stopped && onStderr && err.name !== "ResourceNotFoundException") {
            onStderr(`Lambda log polling error: ${err.message}`);
          }
        }
        if (!stopped) await sleep(5000);
      }
    };

    poll();

    return { stop: () => { stopped = true; } };
  }

  async waitForExit(containerId: string, timeoutSeconds: number): Promise<number> {
    const functionName = this.parseFunctionName(containerId);
    const launchTime = this.parseLaunchTime(containerId);
    const logGroupName = `${AWS_CONSTANTS.LAMBDA_LOG_GROUP}/${functionName}`;
    const deadline = Date.now() + timeoutSeconds * 1000;

    // Poll CloudWatch Logs for the REPORT line indicating completion.
    // Scan for structured signal-result logs emitted by container-entry
    // to detect rerun requests, since the async streamLogs poller may
    // not have delivered them before we return.
    // Only look at logs since launch time to avoid matching stale REPORT
    // lines from previous invocations.
    let sawRerun = false;
    while (Date.now() < deadline) {
      try {
        const lines = await this.shared.filterLogEvents(logGroupName, "", 200, launchTime);
        for (const line of lines) {
          // Detect structured signal-result log from container-entry
          try {
            const parsed = JSON.parse(line);
            if (parsed._log && parsed.msg === "signal-result" && parsed.type === "rerun") {
              sawRerun = true;
            }
          } catch {
            // Not JSON — skip
          }
          if (line.includes("REPORT RequestId:")) {
            // Check for errors in the report
            if (line.includes("Error") || line.includes("Timeout")) {
              return 1;
            }
            return sawRerun ? 42 : 0;
          }
        }
      } catch {
        // Log group may not exist yet
      }
      await sleep(10_000);
    }

    // Lambda will timeout on its own; we just report it
    return 1;
  }

  async kill(_containerId: string): Promise<void> {
    // Lambda will timeout naturally; there's no way to cancel an async invocation
  }

  async remove(_containerId: string): Promise<void> {
    // Lambda functions are persistent — no cleanup needed per invocation
  }

  async fetchLogs(agentName: string, limit: number): Promise<string[]> {
    const functionName = AWS_CONSTANTS.lambdaFunction(agentName);
    const logGroupName = `${AWS_CONSTANTS.LAMBDA_LOG_GROUP}/${functionName}`;
    return this.shared.tailLogEvents(logGroupName, "", limit);
  }

  followLogs(
    agentName: string,
    onLine: (line: string) => void,
    onStderr?: (text: string) => void
  ): { stop: () => void } {
    let stopped = false;
    const functionName = AWS_CONSTANTS.lambdaFunction(agentName);
    const logGroupName = `${AWS_CONSTANTS.LAMBDA_LOG_GROUP}/${functionName}`;
    const startTime = Date.now() - 60_000; // start from 1 minute ago

    const poll = async () => {
      let nextToken: string | undefined;

      while (!stopped) {
        try {
          const res = await this.shared.filterLogEventsRaw(logGroupName, "", nextToken, startTime);
          for (const line of res.events) {
            onLine(line);
          }
          if (res.nextToken) {
            nextToken = res.nextToken;
          }
        } catch (err: any) {
          if (!stopped && onStderr && err.name !== "ResourceNotFoundException") {
            onStderr(`Lambda log polling error: ${err.message}`);
          }
        }
        if (!stopped) await sleep(5000);
      }
    };

    poll();

    return { stop: () => { stopped = true; } };
  }

  getTaskUrl(containerId: string): string | null {
    const functionName = this.parseFunctionName(containerId);
    return `https://${this.config.awsRegion}.console.aws.amazon.com/lambda/home?region=${this.config.awsRegion}#/functions/${functionName}`;
  }

  // --- Internal ---

  private parseFunctionName(containerId: string): string {
    // containerId format: lambda:<functionName>:<requestId>:<launchTime>
    const parts = containerId.split(":");
    return parts.length >= 2 ? parts[1] : containerId;
  }

  private parseLaunchTime(containerId: string): number | undefined {
    // containerId format: lambda:<functionName>:<requestId>:<launchTime>
    const parts = containerId.split(":");
    if (parts.length >= 4) {
      const ts = parseInt(parts[3], 10);
      return Number.isFinite(ts) ? ts : undefined;
    }
    return undefined;
  }

  private deriveLambdaRoleArn(agentName: string): string {
    if (this.config.lambdaRoleArn) {
      return this.config.lambdaRoleArn;
    }
    const accountId = this.shared.getAccountId();
    return `arn:aws:iam::${accountId}:role/${AWS_CONSTANTS.lambdaRoleName(agentName)}`;
  }

  private async waitForFunctionReady(functionName: string): Promise<void> {
    for (let i = 0; i < 30; i++) {
      try {
        const res = await this.lambdaClient.send(new GetFunctionCommand({
          FunctionName: functionName,
        }));
        const state = res.Configuration?.State;
        const updateStatus = res.Configuration?.LastUpdateStatus;
        if (state === "Active" && (!updateStatus || updateStatus === "Successful")) {
          return;
        }
        if (state === "Failed") {
          throw new Error(`Lambda function ${functionName} is in Failed state: ${res.Configuration?.StateReason}`);
        }
      } catch (err: any) {
        if (err.name === "ResourceNotFoundException") {
          // Function still being created
        } else if (err.message?.includes("Failed state")) {
          throw err;
        }
      }
      await sleep(2000);
    }
    throw new Error(`Lambda function ${functionName} did not become ready within 60s`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
