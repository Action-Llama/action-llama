# ECS Fargate Mode

Run agents as ECS Fargate tasks on AWS instead of local Docker containers. Agents get the same isolation guarantees with the added benefits of managed infrastructure and per-agent secret isolation via IAM task roles.

## Prerequisites

- AWS account with ECS, ECR, Secrets Manager, and CloudWatch Logs access
- AWS CLI configured (`aws configure`) or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` env vars
- Docker is **not** required — images are built remotely via AWS CodeBuild and pushed directly to ECR

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
| `local.timeout` | `3600` | Max execution time in seconds |

## Quick Setup

The fastest way to get started:

```bash
al cloud setup -p .
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

| Aspect | Local Docker | ECS Fargate |
|--------|-------------|-------------|
| Where containers run | Your machine | AWS |
| Credential delivery | Volume mount from temp dir | Secrets Manager env var injection |
| Secret isolation | Mount-level (same trust boundary) | IAM-enforced per-agent task roles |
| Gateway needed | Yes (kill switch, cred serving) | No (optional for webhooks) |
| Log latency | Real-time | ~5-10s delay |
| Image builds | Local Docker | Remote via CodeBuild |
| Scaling | Limited by host resources | Managed, serverless |
| Cost | Free (your hardware) | Pay per task execution |

## AWS permissions summary

There are three IAM principals involved:

1. **Operator** — your machine or CI (runs `al` commands)
2. **Execution role** — used by ECS itself to pull images, write logs, and inject secrets
3. **Task role** — one per agent, used by the container to read its own secrets

### Operator IAM policy

This is the minimum policy for the IAM user or role running `al` commands. Replace `<REGION>`, `<ACCOUNT_ID>`, and `<REPO_NAME>` with your values.

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
      "Resource": "arn:aws:logs:<REGION>:<ACCOUNT_ID>:log-group:/ecs/action-llama*"
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
            "codebuild.amazonaws.com"
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
      "Sid": "ECRImageCheck",
      "Effect": "Allow",
      "Action": "ecr:BatchGetImage",
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
      "Sid": "S3BuildContext",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:PutObject",
        "s3:ListBucket"
      ],
      "Resource": "*"
    }
  ]
}
```

The `SetupWizardReadOnly` statement is only needed for `al cloud setup`. You can remove it after initial setup if you prefer a tighter policy.

The `CodeBuild` and `S3BuildContext` statements are required for image builds via CodeBuild.

The `SecretsManager` statement can be scoped to `arn:aws:secretsmanager:<REGION>:<ACCOUNT_ID>:secret:action-llama/*` if you use the default secret prefix.

The `IAMAgentRoles` statement is scoped to `al-*` roles, so it cannot modify unrelated IAM resources.

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

The scheduler is a plain Node.js process — it doesn't need Docker locally. You can deploy it to any platform that runs Node.js (Railway, Fly, EC2, etc.). The scheduler orchestrates remote ECS tasks and reads credentials from Secrets Manager.

**Required environment variables:**

| Env var | Description |
|---------|-------------|
| `AWS_ACCESS_KEY_ID` | AWS access key for the operator IAM user/role |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key |

These provide the scheduler with the same permissions as running `al` locally. Use the [operator IAM policy](#operator-iam-policy) below to scope the access.

**Start command:**

```
al start -c
```

**What needs to be in the deploy:**

- Your project repo (with `config.toml`, agent directories containing `agent-config.toml` and `PLAYBOOK.md`)
- `@action-llama/action-llama` as a dependency in `package.json`

The scheduler builds images via CodeBuild, launches containers on ECS Fargate, and streams logs from CloudWatch — all remotely. No local Docker is needed.

## Troubleshooting

**"ECS runtime requires cloud.awsRegion..."** — Ensure all required fields are set in `config.toml` under `[cloud]`.

**"No AWS credentials found"** — Set `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` env vars or run `aws configure`.

**"Unable to assume the service linked role"** — ECS needs a service-linked role the first time it's used in an account. Run `aws iam create-service-linked-role --aws-service-name ecs.amazonaws.com`. This is a one-time setup; the command is safe to re-run (it'll error if the role already exists).

**"ECS was unable to assume the role 'arn:aws:iam::...:role/al-AGENT-task-role'"** — This is the most common issue with multiple agents. It means the IAM task role for your second (or subsequent) agent doesn't exist or has incorrect permissions. This typically happens because:

1. You ran `al cloud setup` with only one agent, then added more agents later
2. The per-agent role creation failed during setup
3. The role exists but has an incorrect trust policy

**Solutions:**
- **Quick fix:** Run `al doctor -c` to validate and create missing roles
- **Verify setup:** Run `al doctor -c --check-only` to see what's missing without making changes
- **Manual check:** Run `aws iam get-role --role-name al-AGENT-task-role` to see if the role exists

**Prevention:** Always run `al doctor -c` after adding new agents to ensure their IAM roles are created.

**"Failed to start ECS task"** — Check that the ECS cluster exists, subnets have internet access, and the execution role has the required permissions.

**CodeBuild build fails** — Check the build logs linked in the error message. Common causes: the `al-codebuild-role` is missing or lacks ECR push permissions, or the S3 bucket doesn't exist. Verify the role exists and has the permissions listed in the "How CodeBuild works" section above.

**"The specified log group does not exist"** — The CloudWatch log group `/ecs/action-llama` hasn't been created. The runtime creates it automatically on first launch, but the operator IAM user needs `logs:CreateLogGroup` permission. Either re-run `al cloud setup` (which creates it), or create it manually:

```bash
aws logs create-log-group --log-group-name /ecs/action-llama --region us-east-1
```

If you get `AccessDeniedException`, add the `logs:CreateLogGroup` action to your operator IAM policy (see the operator policy above).

**Logs are delayed** — This is expected. CloudWatch Logs has a ~5-10 second ingestion delay. The TUI shows a warning when running in ECS mode.

**Agent can't access secrets** — Verify the per-agent task role has `secretsmanager:GetSecretValue` on the correct secret ARNs. Check with `aws iam get-role-policy --role-name al-dev-task-role --policy-name SecretsAccess`.

**Task stops immediately with exit code 1** — Check CloudWatch Logs for the error. Common causes: missing credentials in Secrets Manager, missing `PLAYBOOK.md`, invalid model config.
