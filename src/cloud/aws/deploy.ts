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
  DescribeLogGroupsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { AWS_CONSTANTS } from "./constants.js";
import type { EcsCloudConfig } from "../../shared/config.js";

export interface AppRunnerDeployOpts {
  imageUri: string;
  cloudConfig: EcsCloudConfig;
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
export async function getAppRunnerStatus(cloudConfig: EcsCloudConfig): Promise<AppRunnerServiceInfo | null> {
  const client = new AppRunnerClient({ region: cloudConfig.awsRegion! });
  return findService(client, AWS_CONSTANTS.SCHEDULER_SERVICE);
}

/**
 * Fetch recent scheduler logs from CloudWatch.
 */
export async function getAppRunnerLogs(cloudConfig: EcsCloudConfig, limit: number): Promise<string[]> {
  const logsClient = new CloudWatchLogsClient({ region: cloudConfig.awsRegion! });
  
  // First verify the App Runner service exists
  const serviceInfo = await getAppRunnerStatus(cloudConfig);
  if (!serviceInfo) {
    throw new Error("App Runner service not deployed. Run 'al deploy scheduler -c' first.");
  }

  // Get the service ID from the service ARN for log group discovery
  const serviceId = serviceInfo.serviceArn.split('/').pop();
  const serviceName = AWS_CONSTANTS.SCHEDULER_SERVICE;
  
  // Try to find the correct log group using App Runner's naming convention
  const logGroup = await findAppRunnerLogGroup(logsClient, serviceName, serviceId);
  
  if (!logGroup) {
    throw new Error(
      `No log group found for App Runner service ${serviceName}. ` +
      `The service may not have started logging yet. Try again in a few moments.`
    );
  }

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
export async function teardownAppRunner(cloudConfig: EcsCloudConfig): Promise<void> {
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

/**
 * Find the CloudWatch log group for an App Runner service.
 * App Runner creates log groups with the pattern: /aws/apprunner/{service-name}/{service-id}/application
 */
async function findAppRunnerLogGroup(
  logsClient: CloudWatchLogsClient,
  serviceName: string,
  serviceId?: string
): Promise<string | null> {
  try {
    let nextToken: string | undefined;
    const logGroupPatterns = [
      // Current App Runner naming pattern
      serviceId ? `/aws/apprunner/${serviceName}/${serviceId}/application` : null,
      // Fallback: scan for any log group matching the service name pattern
      `/aws/apprunner/${serviceName}`,
      // Legacy pattern (in case it still works somewhere)
      `/apprunner/${serviceName}`,
    ].filter(Boolean) as string[];

    // First try exact patterns
    for (const pattern of logGroupPatterns) {
      const res = await logsClient.send(new DescribeLogGroupsCommand({
        logGroupNamePrefix: pattern,
        limit: 10,
      }));

      if (res.logGroups && res.logGroups.length > 0) {
        // Return the most recent log group
        const sortedGroups = res.logGroups
          .filter(g => g.logGroupName)
          .sort((a, b) => (b.creationTime || 0) - (a.creationTime || 0));
        
        if (sortedGroups[0]?.logGroupName) {
          return sortedGroups[0].logGroupName;
        }
      }
    }

    // Fallback: scan for any App Runner log groups containing the service name
    do {
      const res = await logsClient.send(new DescribeLogGroupsCommand({
        logGroupNamePrefix: "/aws/apprunner/",
        ...(nextToken ? { nextToken } : {}),
        limit: 50,
      }));

      for (const group of res.logGroups ?? []) {
        if (group.logGroupName?.includes(serviceName)) {
          return group.logGroupName;
        }
      }

      nextToken = res.nextToken;
    } while (nextToken);

    return null;
  } catch (err: any) {
    // If we can't list log groups, fall back to the legacy pattern
    console.warn(`Warning: Could not list CloudWatch log groups (${err.message}). Trying legacy pattern.`);
    return AWS_CONSTANTS.APPRUNNER_LOG_GROUP;
  }
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
