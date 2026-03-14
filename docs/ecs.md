# ECS Fargate Mode

Run agents as ECS Fargate tasks on AWS instead of local Docker containers. Agents get the same isolation guarantees with the added benefits of managed infrastructure and per-agent secret isolation via IAM task roles.

## Prerequisites

- AWS account with ECS, ECR, Secrets Manager, and CloudWatch Logs access
- AWS CLI configured (`aws configure`) or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` env vars
- Docker is **not** required — images are built remotely via AWS CodeBuild and pushed directly to ECR
- The IAM user running `al setup cloud` needs `iam:CreateServiceLinkedRole` permission (or the service-linked roles for ECS and App Runner must already exist — see [Service-linked roles](#service-linked-roles))

## Configuration

In your project's `config.toml`:

```toml
[cloud]
provider = "ecs"
awsRegion = "us-east-1"
ecsCluster = "al-cluster"
ecrRepository = "123456789012.dkr.ecr.us-east-1.amazonaws.com/al-images"
executionRoleArn = "arn:aws:iam::123456789012:role/ecsTaskExecutionRole"
taskRoleArn = "arn:aws:iam::123456789012:role/al-default-task-role"
subnets = ["subnet-abc123"]
# securityGroups = ["sg-abc123"]       # optional
# awsSecretPrefix = "action-llama"     # optional, default: "action-llama"
```

| Key | Required | Description |
|-----|----------|-------------|
| `cloud.provider` | Yes | Set to `"ecs"` |
| `cloud.awsRegion` | Yes | AWS region (e.g. `us-east-1`) |
| `cloud.ecsCluster` | Yes | ECS cluster name or ARN |
| `cloud.ecrRepository` | Yes | Full ECR repository URI |
| `cloud.executionRoleArn` | Yes | IAM role for task execution (ECR pull + CloudWatch Logs) |
| `cloud.taskRoleArn` | Yes | Default IAM task role (Secrets Manager access) |
| `cloud.subnets` | Yes | VPC subnet IDs for Fargate tasks |
| `cloud.securityGroups` | No | Security group IDs for Fargate tasks |
| `cloud.awsSecretPrefix` | No | Secrets Manager name prefix (default: `"action-llama"`) |
| `cloud.buildBucket` | No | S3 bucket for CodeBuild source uploads (auto-created if omitted) |

Local Docker settings (`[local]`) control resource limits:

| Key | Default | Description |
|-----|---------|-------------|
| `local.memory` | `"4096"` | Memory per task in MiB |
| `local.cpus` | `2` | CPUs per task |
| `local.timeout` | `900` | Default max execution time in seconds (overridable per-agent) |

Individual agents can override the timeout in their `agent-config.toml` with the `timeout` field. On ECS, agents with effective timeout <= 900s automatically route to Lambda for faster startup. See [Per-agent timeout](#per-agent-timeout-and-lambda-routing).

Optional Lambda configuration (for agents that auto-route to Lambda):

| Key | Required | Default | Description |
|-----|----------|---------|-------------|
| `cloud.lambdaRoleArn` | No | auto-derived | Lambda execution role ARN (overrides per-agent role derivation) |
| `cloud.lambdaSubnets` | No | — | VPC subnet IDs for Lambda (only if Lambda needs VPC access) |
| `cloud.lambdaSecurityGroups` | No | — | Security groups for Lambda (only with `lambdaSubnets`) |

Optional cloud scheduler configuration (for `al cloud deploy`):

| Key | Required | Default | Description |
|-----|----------|---------|-------------|
| `cloud.schedulerCpu` | No | `"256"` | App Runner instance CPU (valid: `256`, `512`, `1024`, `2048`, `4096`) |
| `cloud.schedulerMemory` | No | `"512"` | App Runner instance memory in MB (valid depends on CPU — see [App Runner docs](https://docs.aws.amazon.com/apprunner/latest/dg/manage-configure.html)) |
| `cloud.appRunnerInstanceRoleArn` | No | — | IAM role assumed by the scheduler container (needs ECS, Lambda, Secrets Manager, ECR, CodeBuild, S3, CloudWatch Logs permissions) |
| `cloud.appRunnerAccessRoleArn` | Yes* | — | IAM role that allows App Runner to pull images from ECR (*required only when using `al cloud deploy`) |

## Service-linked roles

AWS requires service-linked roles for ECS and App Runner. These are account-level roles that AWS services use internally — they only need to be created once per AWS account.

`al setup cloud` automatically creates both:

- `AWSServiceRoleForECS` (for ECS Fargate task execution)
- `AWSServiceRoleForAppRunner` (for App Runner service management)

If your IAM user lacks `iam:CreateServiceLinkedRole` permission, create them manually:

```bash
aws iam create-service-linked-role --aws-service-name ecs.amazonaws.com
aws iam create-service-linked-role --aws-service-name apprunner.amazonaws.com
```

These commands are safe to re-run — they return an error if the role already exists.

## Quick Setup

The fastest way to get started:

```bash
al setup cloud -p .
```

This interactive wizard prompts for all required fields, writes the `[cloud]` config, pushes credentials, and provisions IAM in one step.

## Manual Setup

### 1. Create an ECS cluster

```bash
aws ecs create-cluster --cluster-name al-cluster --region us-east-1
```

### 2. Create an ECR repository

```bash
aws ecr create-repository --repository-name al-images --region us-east-1
```

### 3. Create the execution role

The execution role allows ECS to pull images from ECR and write logs to CloudWatch. Create `ecs-execution-trust.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "ecs-tasks.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
```

```bash
aws iam create-role \
  --role-name ecsTaskExecutionRole \
  --assume-role-policy-document file://ecs-execution-trust.json

aws iam attach-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
```

The execution role also needs `secretsmanager:GetSecretValue` (so ECS can inject secrets at launch) and `logs:CreateLogGroup` (so ECS can create the CloudWatch log group on first run):

```bash
aws iam put-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-name ActionLlamaExecution \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": "secretsmanager:GetSecretValue",
        "Resource": "arn:aws:secretsmanager:us-east-1:123456789012:secret:action-llama/*"
      },
      {
        "Effect": "Allow",
        "Action": "logs:CreateLogGroup",
        "Resource": "arn:aws:logs:us-east-1:123456789012:log-group:/ecs/action-llama*"
      }
    ]
  }'
```

### 4. Push credentials and create per-agent task roles

```bash
al doctor -c -p .
```

This pushes all local credentials to AWS Secrets Manager, then creates a task role for each agent (`al-{agentName}-task-role`) and grants `secretsmanager:GetSecretValue` scoped to only that agent's declared secrets.

> **Re-run after adding agents:** Whenever you add a new agent to your project, re-run `al doctor -c` to create the task role for the new agent. Without this, the new agent will fail to access its credentials at runtime.

Alternatively, create roles manually:

```bash
# Create the role
aws iam create-role \
  --role-name al-dev-task-role \
  --assume-role-policy-document file://ecs-execution-trust.json

# Grant access to only this agent's secrets
aws iam put-role-policy \
  --role-name al-dev-task-role \
  --policy-name SecretsAccess \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": [
        "arn:aws:secretsmanager:us-east-1:123456789012:secret:action-llama/github_token/default/*",
        "arn:aws:secretsmanager:us-east-1:123456789012:secret:action-llama/anthropic_key/default/*"
      ]
    }]
  }'
```

Repeat for each agent (`al-reviewer-task-role`, `al-devops-task-role`, etc.), scoping each role's policy to only that agent's credential paths.

### 5. Ensure VPC networking

Fargate tasks need a VPC subnet with internet access (for pulling images, calling APIs). Use a public subnet with `assignPublicIp: ENABLED` (the default) or a private subnet with a NAT gateway.

### 6. Start

```bash
al start -c -p .
```

The scheduler will:
1. Build agent images remotely via CodeBuild and push to ECR
2. Create the CloudWatch log group if it doesn't exist
3. Register ECS task definitions with Secrets Manager secret injection
4. Run Fargate tasks on schedule or webhook trigger
5. Stream logs from CloudWatch Logs

## Per-agent timeout and Lambda routing

When using the ECS provider, agents are automatically routed to the most efficient AWS compute service based on their timeout:

- **Timeout <= 900s (15 min):** Routes to **AWS Lambda** — cold starts in ~1-2 seconds, pay-per-100ms pricing
- **Timeout > 900s:** Routes to **ECS Fargate** — cold starts in ~30-60 seconds, pay-per-second pricing

This happens automatically. You control it by setting `timeout` in each agent's `agent-config.toml`:

```toml
# agent-config.toml for a fast webhook responder
timeout = 300    # 5 minutes — will use Lambda on AWS
```

```toml
# agent-config.toml for a long-running refactoring agent
timeout = 3600   # 1 hour — will use ECS Fargate
```

If an agent doesn't set `timeout`, it falls back to `[local].timeout` in `config.toml`, then to the default of 900s. Since 900s is the Lambda maximum, agents without an explicit timeout default to Lambda.

### Lambda memory

Lambda functions default to 512 MB of memory, which is sufficient for typical LLM agent workloads (HTTP calls to LLM APIs). Lambda's maximum is 3008 MB — the `local.memory` config value is clamped to this limit for Lambda-routed agents.

To increase memory for a specific agent, set `memory` in project `config.toml`:

```toml
[local]
memory = "2048"  # 2 GB — clamped to 3008 for Lambda, used as-is for ECS
```

### Why Lambda is faster

Lambda keeps container images warm in pre-provisioned execution environments. When invoked, Lambda starts executing in ~1-2 seconds. ECS Fargate must provision a fresh VM, pull the image, and start the container — taking 30-60 seconds.

For agents that respond to webhooks (e.g., triaging issues, reviewing PRs, responding to alerts), this means the agent starts working almost immediately after the event arrives.

### Shared infrastructure

Both Lambda and ECS Fargate use the same infrastructure:

- **Same ECR images** — built once via CodeBuild, referenced by both runtimes
- **Same Secrets Manager credentials** — Lambda resolves secrets at invocation time and passes them as environment variables using the same `AL_SECRET_*` naming convention
- **Same CodeBuild pipeline** — no separate build step needed

### Lambda IAM roles

`al doctor -c` automatically creates Lambda execution roles (`al-{agentName}-lambda-role`) for agents with timeout <= 900s. These roles include:

- `secretsmanager:GetSecretValue` scoped to the agent's declared secrets
- `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents` for CloudWatch
- `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer` for pulling images

To use a shared role instead of per-agent roles, set `cloud.lambdaRoleArn` in `config.toml`.

### Operator IAM additions for Lambda

If your agents route to Lambda, add these permissions to your operator IAM policy:

```json
{
  "Sid": "Lambda",
  "Effect": "Allow",
  "Action": [
    "lambda:GetFunction",
    "lambda:CreateFunction",
    "lambda:UpdateFunctionCode",
    "lambda:UpdateFunctionConfiguration",
    "lambda:PutFunctionEventInvokeConfig",
    "lambda:InvokeFunction"
  ],
  "Resource": "arn:aws:iam::<ACCOUNT_ID>:function:al-*"
}
```

And extend the `PassRole` condition to include `lambda.amazonaws.com` and `apprunner.amazonaws.com`:

```json
"Condition": {
  "StringEquals": {
    "iam:PassedToService": [
      "ecs-tasks.amazonaws.com",
      "codebuild.amazonaws.com",
      "lambda.amazonaws.com",
      "apprunner.amazonaws.com"
    ]
  }
}
```

## How it works

### Image lifecycle

Images are built remotely via AWS CodeBuild and pushed directly to ECR — no local Docker required. This means the scheduler can run anywhere (your machine, Railway, EC2, etc.).

Each agent gets its own image tag (`al-{agentName}-latest`). The build happens on every `al start -c` to ensure the latest code is deployed.

### How CodeBuild works

On each build, the ECS runtime:

1. Creates a tarball of the build context
2. Uploads it to S3 (bucket: `buildBucket` from config, or auto-created as `al-builds-<accountId>-<region>`)
3. Creates a CodeBuild project (`al-image-builder`) if it doesn't exist
4. Starts a build that produces and pushes the Docker image to ECR

This requires:

- An IAM role `al-codebuild-role` that CodeBuild can assume, with ECR push and S3 read permissions
- The operator IAM policy must include CodeBuild and S3 permissions (see below)

To create the CodeBuild service role:

```bash
# Trust policy
aws iam create-role \
  --role-name al-codebuild-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": { "Service": "codebuild.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }]
  }'

# ECR push permissions
aws iam put-role-policy \
  --role-name al-codebuild-role \
  --policy-name ECRPush \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": "ecr:GetAuthorizationToken",
        "Resource": "*"
      },
      {
        "Effect": "Allow",
        "Action": [
          "ecr:BatchCheckLayerAvailability",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage"
        ],
        "Resource": "arn:aws:ecr:<REGION>:<ACCOUNT_ID>:repository/<REPO_NAME>"
      },
      {
        "Effect": "Allow",
        "Action": "s3:GetObject",
        "Resource": "arn:aws:s3:::al-builds-<ACCOUNT_ID>-<REGION>/*"
      },
      {
        "Effect": "Allow",
        "Action": [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ],
        "Resource": "*"
      }
    ]
  }'
```

### Secret injection

ECS injects secrets from AWS Secrets Manager as environment variables using the naming convention `AL_SECRET_{type}__{instance}__{field}`. The container entry point reads these environment variables and writes them to `/credentials/{type}/{instance}/{field}` for compatibility with the standard credential layout.

Secret names in Secrets Manager follow the convention: `{prefix}/{type}/{instance}/{field}` (e.g. `action-llama/github_token/default/token`).

### Per-agent task roles

Each agent runs with its own IAM task role:

```
al-dev-task-role           -> github_token, git_ssh, anthropic_key
al-reviewer-task-role      -> github_token, git_ssh, anthropic_key
al-devops-task-role        -> github_token, sentry_token, anthropic_key
```

Each role only has `secretsmanager:GetSecretValue` on its declared secrets. Even if an agent container is compromised and accesses the ECS task metadata endpoint to obtain the role's credentials, it can only read its own secrets.

The per-agent role ARN is derived automatically from the ECR repository's account ID: `arn:aws:iam::{accountId}:role/al-{agentName}-task-role`.

### Gateway

The gateway is **not required** for ECS mode. Containers get their credentials via native Secrets Manager injection (not the gateway's HTTP endpoint), and ECS handles task timeouts natively. The gateway still starts if you have webhooks configured, since webhooks are received by the scheduler process.

### Log streaming

Logs are streamed from CloudWatch Logs by polling. There is a ~5-10 second delay inherent to CloudWatch Logs ingestion. The TUI displays a warning about this delay when running in ECS mode.

## Comparison with local Docker

| Aspect | Local Docker | ECS Fargate | Lambda (auto, <=900s) |
|--------|-------------|-------------|----------------------|
| Where containers run | Your machine | AWS | AWS |
| Cold start | Instant (image cached) | ~30-60s | ~1-2s |
| Max runtime | Unlimited | Unlimited | 15 minutes |
| Credential delivery | Volume mount | Secrets Manager env vars | Secrets Manager env vars |
| Secret isolation | Mount-level | IAM task roles | IAM Lambda roles |
| Log latency | Real-time | ~5-10s | ~5-10s |
| Image builds | Local Docker | Remote via CodeBuild | Remote via CodeBuild |
| Cost | Free (your hardware) | Pay per second | Pay per 100ms |

## AWS permissions summary

There are six IAM principals involved:

1. **Operator** — your machine or CI (runs `al` commands)
2. **Execution role** — used by ECS itself to pull images, write logs, and inject secrets
3. **Task role** — one per agent on ECS Fargate, used by the container to read its own secrets
4. **Lambda execution role** — one per short-timeout agent, used by Lambda to read secrets and write logs
5. **App Runner access role** — allows App Runner to pull scheduler images from ECR (only for `al cloud deploy`)
6. **App Runner instance role** — assumed by the scheduler container, needs operator-level permissions (only for `al cloud deploy`)

### Operator IAM policy

This is the minimum policy for the IAM user or role running `al` commands. Replace `<REGION>`, `<ACCOUNT_ID>`, and `<REPO_NAME>` with your values.

> **Note:** `al setup cloud` automatically grants the PassRole and Logs statements via the `ActionLlamaOperator` inline policy. You still need to attach the remaining statements (ECS, SecretsManager, ECR, CodeBuild, Lambda, S3, IAM) manually or via your own IaC.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Identity",
      "Effect": "Allow",
      "Action": "sts:GetCallerIdentity",
      "Resource": "*"
    },
    {
      "Sid": "ECSRuntime",
      "Effect": "Allow",
      "Action": [
        "ecs:RegisterTaskDefinition",
        "ecs:RunTask",
        "ecs:DescribeTasks",
        "ecs:ListTasks",
        "ecs:StopTask"
      ],
      "Resource": "*"
    },
    {
      "Sid": "Logs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:GetLogEvents",
        "logs:FilterLogEvents"
      ],
      "Resource": [
        "arn:aws:logs:<REGION>:<ACCOUNT_ID>:log-group:/ecs/action-llama*",
        "arn:aws:logs:<REGION>:<ACCOUNT_ID>:log-group:/aws/lambda/al-*",
        "arn:aws:logs:<REGION>:<ACCOUNT_ID>:log-group:/apprunner/al-scheduler*"
      ]
    },
    {
      "Sid": "SecretsManager",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:ListSecrets",
        "secretsmanager:CreateSecret",
        "secretsmanager:PutSecretValue",
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "*"
    },
    {
      "Sid": "PassRole",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": [
        "arn:aws:iam::<ACCOUNT_ID>:role/al-*"
      ],
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": [
            "ecs-tasks.amazonaws.com",
            "codebuild.amazonaws.com",
            "lambda.amazonaws.com",
            "apprunner.amazonaws.com"
          ]
        }
      }
    },
    {
      "Sid": "IAMAgentRoles",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:GetRole",
        "iam:GetRolePolicy",
        "iam:PutRolePolicy",
        "iam:DeleteRole",
        "iam:DeleteRolePolicy",
        "iam:AttachRolePolicy"
      ],
      "Resource": [
        "arn:aws:iam::<ACCOUNT_ID>:role/al-*"
      ]
    },
    {
      "Sid": "IAMListRoles",
      "Effect": "Allow",
      "Action": "iam:ListRoles",
      "Resource": "*"
    },
    {
      "Sid": "ECR",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchGetImage",
        "ecr:SetRepositoryPolicy"
      ],
      "Resource": "arn:aws:ecr:<REGION>:<ACCOUNT_ID>:repository/<REPO_NAME>"
    },
    {
      "Sid": "SetupWizardReadOnly",
      "Effect": "Allow",
      "Action": [
        "ecr:DescribeRepositories",
        "ecr:CreateRepository",
        "ecs:ListClusters",
        "ecs:DescribeClusters",
        "ecs:CreateCluster",
        "ec2:DescribeVpcs",
        "ec2:DescribeSubnets",
        "ec2:DescribeSecurityGroups"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CodeBuild",
      "Effect": "Allow",
      "Action": [
        "codebuild:StartBuild",
        "codebuild:BatchGetBuilds",
        "codebuild:CreateProject"
      ],
      "Resource": "arn:aws:codebuild:<REGION>:<ACCOUNT_ID>:project/al-image-builder"
    },
    {
      "Sid": "Lambda",
      "Effect": "Allow",
      "Action": [
        "lambda:GetFunction",
        "lambda:CreateFunction",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:PutFunctionEventInvokeConfig",
        "lambda:InvokeFunction"
      ],
      "Resource": "arn:aws:lambda:<REGION>:<ACCOUNT_ID>:function:al-*"
    },
    {
      "Sid": "S3BuildContext",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:PutObject",
        "s3:ListBucket"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AppRunner",
      "Effect": "Allow",
      "Action": [
        "apprunner:CreateService",
        "apprunner:UpdateService",
        "apprunner:DescribeService",
        "apprunner:DeleteService"
      ],
      "Resource": "arn:aws:apprunner:<REGION>:<ACCOUNT_ID>:service/al-scheduler/*"
    },
    {
      "Sid": "AppRunnerList",
      "Effect": "Allow",
      "Action": "apprunner:ListServices",
      "Resource": "*"
    },
    {
      "Sid": "ServiceLinkedRoles",
      "Effect": "Allow",
      "Action": "iam:CreateServiceLinkedRole",
      "Resource": [
        "arn:aws:iam::<ACCOUNT_ID>:role/aws-service-role/ecs.amazonaws.com/*",
        "arn:aws:iam::<ACCOUNT_ID>:role/aws-service-role/apprunner.amazonaws.com/*"
      ]
    }
  ]
}
```

The `SetupWizardReadOnly` statement is only needed for `al setup cloud`. You can remove it after initial setup if you prefer a tighter policy.

The `CodeBuild` and `S3BuildContext` statements are required for image builds via CodeBuild.

The `SecretsManager` statement can be scoped to `arn:aws:secretsmanager:<REGION>:<ACCOUNT_ID>:secret:action-llama/*` if you use the default secret prefix.

The `IAMAgentRoles` statement is scoped to `al-*` roles, so it cannot modify unrelated IAM resources.

The `AppRunner` statement is only needed for `al cloud deploy` / `al teardown cloud`. You can omit it if you only run the scheduler locally.

### Execution role (ECS infrastructure)

Attach the AWS managed policy `AmazonECSTaskExecutionRolePolicy`, plus an inline policy for secret injection:

| Service | Actions |
|---------|---------|
| ECR | `GetDownloadUrlForLayer`, `BatchGetImage`, `GetAuthorizationToken` |
| CloudWatch Logs | `CreateLogStream`, `PutLogEvents`, `CreateLogGroup` |
| Secrets Manager | `GetSecretValue` (on all agent secrets, so ECS can inject them) |

### Task role (container, per-agent)

Created automatically by `al doctor -c`. Each agent gets its own role scoped to only its secrets:

| Service | Actions |
|---------|---------|
| Secrets Manager | `GetSecretValue` (scoped to only that agent's secrets) |

## Deploying the scheduler

### Using `al cloud deploy` (recommended)

Deploy the scheduler as an AWS App Runner service:

```bash
al cloud deploy -p .
```

This builds a container image with the AL CLI and all project files baked in, pushes it to ECR, and creates an App Runner service. The scheduler runs in headless mode with the gateway enabled, providing a public HTTPS endpoint for webhooks.

The deployed service URL is printed on completion. Use it to configure webhook endpoints in GitHub/Sentry/Linear:

```
https://<service-id>.<region>.awsapprunner.com/webhooks/github
```

#### App Runner IAM roles

`al cloud deploy` requires two additional IAM roles:

**1. Access role** — allows App Runner to pull images from ECR:

```bash
aws iam create-role \
  --role-name al-apprunner-access-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": { "Service": "build.apprunner.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }]
  }'

aws iam attach-role-policy \
  --role-name al-apprunner-access-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
```

Set `cloud.appRunnerAccessRoleArn` to this role's ARN in `config.toml`.

**2. Instance role** — the IAM role assumed by the scheduler container. It needs the same permissions as the operator (ECS, Lambda, Secrets Manager, ECR, CodeBuild, S3, CloudWatch Logs):

```bash
aws iam create-role \
  --role-name al-apprunner-instance-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": { "Service": "tasks.apprunner.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }]
  }'
```

Attach the same policy statements from the [operator IAM policy](#operator-iam-policy) to this role (ECS, Lambda, Secrets Manager, ECR, CodeBuild, S3, CloudWatch Logs, PassRole, IAM agent roles). Set `cloud.appRunnerInstanceRoleArn` to this role's ARN.

#### Managing the cloud scheduler

```bash
al stat -c            # Show scheduler service status + running agents
al logs scheduler -c  # Tail scheduler logs from CloudWatch
al teardown cloud     # Tear down scheduler + all cloud resources
```

### Manual deployment (alternative)

You can also deploy the scheduler manually to any platform that runs Node.js (Railway, Fly, EC2, etc.):

**Required environment variables:**

| Env var | Description |
|---------|-------------|
| `AWS_ACCESS_KEY_ID` | AWS access key for the operator IAM user/role |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key |

These provide the scheduler with the same permissions as running `al` locally. Use the [operator IAM policy](#operator-iam-policy) below to scope the access.

**Start command:**

```
al start -c --headless --gateway
```

**What needs to be in the deploy:**

- Your project repo (with `config.toml`, agent directories containing `agent-config.toml` and `ACTIONS.md`)
- `@action-llama/action-llama` as a dependency in `package.json`

The scheduler builds images via CodeBuild, launches containers on ECS Fargate, and streams logs from CloudWatch — all remotely. No local Docker is needed.

## Troubleshooting

**"ECS runtime requires cloud.awsRegion..."** — Ensure all required fields are set in `config.toml` under `[cloud]`.

**"No AWS credentials found"** — Set `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` env vars or run `aws configure`.

**"Unable to assume the service linked role"** — ECS needs a service-linked role the first time it's used in an account. `al setup cloud` creates this automatically, but if you set up manually: `aws iam create-service-linked-role --aws-service-name ecs.amazonaws.com`.

**"Couldn't create a service-linked role for App Runner"** — Same issue for App Runner. `al setup cloud` creates this automatically, but if you set up manually: `aws iam create-service-linked-role --aws-service-name apprunner.amazonaws.com`. If `al setup cloud` itself fails with this error, your IAM user needs `iam:CreateServiceLinkedRole` permission — see [Service-linked roles](#service-linked-roles).

**"ECS was unable to assume the role 'arn:aws:iam::...:role/al-AGENT-task-role'"** — This is the most common issue with multiple agents. It means the IAM task role for your second (or subsequent) agent doesn't exist or has incorrect permissions. This typically happens because:

1. You ran `al setup cloud` with only one agent, then added more agents later
2. The per-agent role creation failed during setup
3. The role exists but has an incorrect trust policy

**Solutions:**
- **Quick fix:** Run `al doctor -c` to validate and create missing roles
- **Verify setup:** Run `al doctor -c --check-only` to see what's missing without making changes
- **Manual check:** Run `aws iam get-role --role-name al-AGENT-task-role` to see if the role exists

**Prevention:** Always run `al doctor -c` after adding new agents to ensure their IAM roles are created.

**"Failed to start ECS task"** — Check that the ECS cluster exists, subnets have internet access, and the execution role has the required permissions.

**CodeBuild build fails** — Check the build logs linked in the error message. Common causes: the `al-codebuild-role` is missing or lacks ECR push permissions, or the S3 bucket doesn't exist. Verify the role exists and has the permissions listed in the "How CodeBuild works" section above.

**"The specified log group does not exist"** — The CloudWatch log group `/ecs/action-llama` hasn't been created. The runtime creates it automatically on first launch, but the operator IAM user needs `logs:CreateLogGroup` permission. Either re-run `al setup cloud` (which creates it), or create it manually:

```bash
aws logs create-log-group --log-group-name /ecs/action-llama --region us-east-1
```

If you get `AccessDeniedException`, add the `logs:CreateLogGroup` action to your operator IAM policy (see the operator policy above).

**"not authorized to perform: logs:FilterLogEvents"** — Your operator IAM user is missing CloudWatch Logs read permissions. Running `al setup cloud` grants these automatically (the `ActionLlamaOperator` inline policy). If you set up before this was added, re-run `al setup cloud` or manually add the Logs statement from the operator policy above.

**Logs are delayed** — This is expected. CloudWatch Logs has a ~5-10 second ingestion delay. The TUI shows a warning when running in ECS mode.

**Agent can't access secrets** — Verify the per-agent task role has `secretsmanager:GetSecretValue` on the correct secret ARNs. Check with `aws iam get-role-policy --role-name al-dev-task-role --policy-name SecretsAccess`.

**Task stops immediately with exit code 1** — Check CloudWatch Logs for the error. Common causes: missing credentials in Secrets Manager, missing `ACTIONS.md`, invalid model config.
