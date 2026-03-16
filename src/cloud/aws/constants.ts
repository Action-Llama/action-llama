/**
 * AWS-specific resource naming constants.
 *
 * For provider-agnostic constants, see src/shared/constants.ts.
 */

export const AWS_CONSTANTS = {
  /** CloudWatch log group for ECS tasks */
  LOG_GROUP: "/ecs/action-llama",

  /** Per-agent IAM task role name */
  taskRoleName: (agentName: string) => `al-${agentName}-task-role`,

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

  /** Lambda function name for an agent */
  lambdaFunction: (agentName: string) => `al-${agentName}`,

  /** Maximum timeout for Lambda functions (seconds) */
  LAMBDA_MAX_TIMEOUT: 900,

  /** Maximum memory for Lambda functions (MB) */
  LAMBDA_MAX_MEMORY: 3008,

  /** CloudWatch log group for Lambda functions */
  LAMBDA_LOG_GROUP: "/aws/lambda",

  /** Lambda execution role name */
  LAMBDA_EXECUTION_ROLE: "al-lambda-execution-role",

  /** Per-agent Lambda execution role name */
  lambdaRoleName: (agentName: string) => `al-${agentName}-lambda-role`,

  /** App Runner service name for the cloud scheduler */
  SCHEDULER_SERVICE: "al-scheduler",

  /** App Runner instance role name */
  APPRUNNER_INSTANCE_ROLE: "al-apprunner-instance-role",

  /** App Runner ECR access role name */
  APPRUNNER_ACCESS_ROLE: "al-apprunner-access-role",

  /** DynamoDB table for scheduler state (locks, container registry, queues) */
  STATE_TABLE: "al-state",
} satisfies Record<string, string | number | ((...args: any[]) => string)>;
