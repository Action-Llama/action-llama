/**
 * Centralized AWS resource naming constants.
 *
 * Every AWS resource name that Action Llama creates or references
 * should be derived from this file to prevent inconsistencies.
 */

export const AWS_CONSTANTS = {
  /** Default prefix for Secrets Manager secret names */
  DEFAULT_SECRET_PREFIX: "action-llama",

  /** CloudWatch log group for ECS tasks */
  LOG_GROUP: "/ecs/action-llama",

  /** ECS `startedBy` tag for filtering our tasks */
  STARTED_BY: "action-llama",

  /** ECS task family / Cloud Run job name for an agent */
  agentFamily: (agentName: string) => `al-${agentName}`,

  /** Strip the `al-` prefix to recover the agent name */
  agentNameFromFamily: (family: string) => family.startsWith("al-") ? family.slice(3) : family,

  /** Per-agent IAM task role name */
  taskRoleName: (agentName: string) => `al-${agentName}-task-role`,

  /** Per-agent GCP service account name */
  serviceAccountName: (agentName: string) => `al-${agentName}`,

  /** Per-agent GCP service account email */
  serviceAccountEmail: (agentName: string, gcpProject: string) =>
    `al-${agentName}@${gcpProject}.iam.gserviceaccount.com`,

  /** CodeBuild project name for image builds */
  CODEBUILD_PROJECT: "al-image-builder",

  /** CodeBuild IAM role name */
  CODEBUILD_ROLE: "al-codebuild-role",

  /** ECS execution role name (default) */
  EXECUTION_ROLE: "al-ecs-execution-role",

  /** ECS default task role name */
  DEFAULT_TASK_ROLE: "al-default-task-role",

  /** Default ECR repository name */
  DEFAULT_ECR_REPO: "al-images",

  /** Default ECS cluster name */
  DEFAULT_CLUSTER: "al-cluster",

  /** S3 bucket name for CodeBuild source */
  buildBucket: (accountId: string, region: string) => `al-builds-${accountId}-${region}`,

  /** S3 key prefix for build artifacts */
  BUILD_S3_PREFIX: "al-builds",

  /** Docker container name for a local agent run */
  containerName: (agentName: string, runId: string) => `al-${agentName}-${runId}`,

  /** Docker container name filter prefix */
  CONTAINER_FILTER: "al-",

  /** Docker network name */
  NETWORK_NAME: "al-net",

  /** Default base Docker image */
  DEFAULT_IMAGE: "al-agent:latest",

  /** Agent-specific Docker image tag */
  agentImage: (agentName: string) => `al-${agentName}:latest`,

  /** Temp directory prefix for credential staging */
  CREDS_TEMP_PREFIX: "al-creds-",

  /** Default GCP Cloud Run service account */
  defaultGcpRunner: (gcpProject: string) => `al-runner@${gcpProject}.iam.gserviceaccount.com`,

  /** Lambda function name for an agent */
  lambdaFunction: (agentName: string) => `al-${agentName}`,

  /** Maximum timeout for Lambda functions (seconds) */
  LAMBDA_MAX_TIMEOUT: 900,

  /** CloudWatch log group for Lambda functions */
  LAMBDA_LOG_GROUP: "/aws/lambda",

  /** Lambda execution role name */
  LAMBDA_EXECUTION_ROLE: "al-lambda-execution-role",

  /** Per-agent Lambda execution role name */
  lambdaRoleName: (agentName: string) => `al-${agentName}-lambda-role`,
} satisfies Record<string, string | number | ((...args: any[]) => string)>;
