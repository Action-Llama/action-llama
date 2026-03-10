/**
 * AWS App Runner deployment for the cloud scheduler.
 *
 * Creates or updates an App Runner service that runs the scheduler as a
 * long-running container with an HTTPS endpoint for webhooks.
 */

import {
  AppRunnerClient,
  CreateServiceCommand,
  UpdateServiceCommand,
  DescribeServiceCommand,
  DeleteServiceCommand,
  ListServicesCommand,
} from "@aws-sdk/client-apprunner";
import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { AWS_CONSTANTS } from "../shared/aws-constants.js";
import type { CloudConfig } from "../shared/config.js";

export interface AppRunnerDeployOpts {
  imageUri: string;
  cloudConfig: CloudConfig;
  port?: number;
  envVars?: Record<string, string>;
}

export interface AppRunnerServiceInfo {
  serviceArn: string;
  serviceUrl: string;
  status: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Deploy (create or update) the scheduler as an App Runner service.
 */
export async function deployAppRunner(opts: AppRunnerDeployOpts): Promise<AppRunnerServiceInfo> {
  const { imageUri, cloudConfig, port = 8080, envVars = {} } = opts;
  const region = cloudConfig.awsRegion!;
  const client = new AppRunnerClient({ region });

  const serviceName = AWS_CONSTANTS.SCHEDULER_SERVICE;
  const cpu = cloudConfig.schedulerCpu || "256";      // 0.25 vCPU
  const memory = cloudConfig.schedulerMemory || "512"; // 512 MB

  const instanceRoleArn = cloudConfig.appRunnerInstanceRoleArn;
  const accessRoleArn = cloudConfig.appRunnerAccessRoleArn;

  if (!accessRoleArn) {
    throw new Error(
      "cloud.appRunnerAccessRoleArn is required for App Runner deployment. " +
      "This IAM role allows App Runner to pull images from ECR."
    );
  }

  const existing = await findService(client, serviceName);

  const runtimeEnvVars = Object.entries(envVars).map(([name, value]) => ({ Name: name, Value: value }));

  if (existing) {
    // Update existing service
    const res = await client.send(new UpdateServiceCommand({
      ServiceArn: existing.serviceArn,
      SourceConfiguration: {
        ImageRepository: {
          ImageIdentifier: imageUri,
          ImageRepositoryType: "ECR",
          ImageConfiguration: {
            Port: String(port),
            RuntimeEnvironmentVariables: Object.fromEntries(
              runtimeEnvVars.map(e => [e.Name, e.Value])
            ),
          },
        },
        AuthenticationConfiguration: {
          AccessRoleArn: accessRoleArn,
        },
      },
      InstanceConfiguration: {
        Cpu: cpu,
        Memory: memory,
        ...(instanceRoleArn ? { InstanceRoleArn: instanceRoleArn } : {}),
      },
      HealthCheckConfiguration: {
        Protocol: "HTTP",
        Path: "/health",
        Interval: 10,
        Timeout: 5,
        HealthyThreshold: 1,
        UnhealthyThreshold: 5,
      },
    }));

    return await waitForService(client, res.Service!.ServiceArn!);
  }

  // Create new service
  const res = await client.send(new CreateServiceCommand({
    ServiceName: serviceName,
    SourceConfiguration: {
      ImageRepository: {
        ImageIdentifier: imageUri,
        ImageRepositoryType: "ECR",
        ImageConfiguration: {
          Port: String(port),
          RuntimeEnvironmentVariables: Object.fromEntries(
            runtimeEnvVars.map(e => [e.Name, e.Value])
          ),
        },
      },
      AuthenticationConfiguration: {
        AccessRoleArn: accessRoleArn,
      },
      AutoDeploymentsEnabled: false,
    },
    InstanceConfiguration: {
      Cpu: cpu,
      Memory: memory,
      ...(instanceRoleArn ? { InstanceRoleArn: instanceRoleArn } : {}),
    },
    HealthCheckConfiguration: {
      Protocol: "HTTP",
      Path: "/health",
      Interval: 10,
      Timeout: 5,
      HealthyThreshold: 1,
      UnhealthyThreshold: 5,
    },
  }));

  return await waitForService(client, res.Service!.ServiceArn!);
}

/**
 * Get the current status of the scheduler App Runner service.
 */
export async function getAppRunnerStatus(cloudConfig: CloudConfig): Promise<AppRunnerServiceInfo | null> {
  const client = new AppRunnerClient({ region: cloudConfig.awsRegion! });
  return findService(client, AWS_CONSTANTS.SCHEDULER_SERVICE);
}

/**
 * Fetch recent scheduler logs from CloudWatch.
 */
export async function getAppRunnerLogs(cloudConfig: CloudConfig, limit: number): Promise<string[]> {
  const logsClient = new CloudWatchLogsClient({ region: cloudConfig.awsRegion! });
  const logGroup = AWS_CONSTANTS.APPRUNNER_LOG_GROUP;

  try {
    const allEvents: string[] = [];
    let nextToken: string | undefined;

    do {
      const res = await logsClient.send(new FilterLogEventsCommand({
        logGroupName: logGroup,
        startTime: Date.now() - 24 * 3600_000,
        ...(nextToken ? { nextToken } : {}),
      }));

      for (const e of res.events ?? []) {
        const msg = e.message?.trimEnd();
        if (msg) allEvents.push(msg);
      }

      nextToken = res.nextToken;
    } while (nextToken);

    return allEvents.slice(-limit);
  } catch (err: any) {
    if (err.name === "ResourceNotFoundException") {
      return [];
    }
    throw err;
  }
}

/**
 * Delete the scheduler App Runner service.
 */
export async function teardownAppRunner(cloudConfig: CloudConfig): Promise<void> {
  const client = new AppRunnerClient({ region: cloudConfig.awsRegion! });
  const existing = await findService(client, AWS_CONSTANTS.SCHEDULER_SERVICE);

  if (!existing) {
    console.log("  App Runner service not found (already deleted)");
    return;
  }

  console.log(`  Deleting App Runner service: ${existing.serviceArn}`);
  await client.send(new DeleteServiceCommand({
    ServiceArn: existing.serviceArn,
  }));
  console.log("  App Runner service deletion initiated");
}

// --- Internal helpers ---

async function findService(client: AppRunnerClient, serviceName: string): Promise<AppRunnerServiceInfo | null> {
  let nextToken: string | undefined;

  do {
    const res = await client.send(new ListServicesCommand({
      ...(nextToken ? { NextToken: nextToken } : {}),
    }));

    for (const svc of res.ServiceSummaryList ?? []) {
      if (svc.ServiceName === serviceName) {
        // Get full details
        const detail = await client.send(new DescribeServiceCommand({
          ServiceArn: svc.ServiceArn!,
        }));
        const s = detail.Service!;
        return {
          serviceArn: s.ServiceArn!,
          serviceUrl: `https://${s.ServiceUrl}`,
          status: s.Status!,
          createdAt: s.CreatedAt,
          updatedAt: s.UpdatedAt,
        };
      }
    }

    nextToken = res.NextToken;
  } while (nextToken);

  return null;
}

async function waitForService(client: AppRunnerClient, serviceArn: string): Promise<AppRunnerServiceInfo> {
  const maxWait = 10 * 60_000; // 10 minutes
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const res = await client.send(new DescribeServiceCommand({ ServiceArn: serviceArn }));
    const s = res.Service!;
    const status = s.Status!;

    if (status === "RUNNING") {
      return {
        serviceArn: s.ServiceArn!,
        serviceUrl: `https://${s.ServiceUrl}`,
        status,
        createdAt: s.CreatedAt,
        updatedAt: s.UpdatedAt,
      };
    }

    if (status === "CREATE_FAILED" || status === "DELETE_FAILED") {
      throw new Error(`App Runner service entered ${status} state`);
    }

    await sleep(10_000);
  }

  throw new Error("Timed out waiting for App Runner service to become RUNNING");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
