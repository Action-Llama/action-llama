# ECS Fargate Mode

Run agents as ECS Fargate tasks on AWS instead of local Docker containers. Agents get the same isolation guarantees with the added benefits of managed infrastructure and per-agent secret isolation via IAM task roles.

## Prerequisites

- AWS account with ECS, ECR, Secrets Manager, and CloudWatch Logs access
- AWS CLI configured (`aws configure`) or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` env vars
- Local Docker installed (for building and pushing images to ECR)

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

The execution role also needs `secretsmanager:GetSecretValue` so ECS can inject secrets into the container at launch:

```bash
aws iam put-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-name SecretsManagerRead \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:us-east-1:123456789012:secret:action-llama/*"
    }]
  }'
```

### 4. Push credentials and create per-agent task roles

```bash
al doctor -c -p .
```

This pushes all local credentials to AWS Secrets Manager, then creates a task role for each agent (`al-{agentName}-task-role`) and grants `secretsmanager:GetSecretValue` scoped to only that agent's declared secrets.

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
1. Build agent images locally
2. Push them to ECR
3. Register ECS task definitions with Secrets Manager secret injection
4. Run Fargate tasks on schedule or webhook trigger
5. Stream logs from CloudWatch Logs

## How it works

### Image lifecycle

Images are built locally with Docker and pushed to ECR. Each agent gets its own image tag (`al-{agentName}-latest`). The build and push happen on every `al start -c` to ensure the latest code is deployed.

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
| Image builds | Local Docker | Local Docker + ECR push |
| Scaling | Limited by host resources | Managed, serverless |
| Cost | Free (your hardware) | Pay per task execution |

## AWS permissions summary

### Your machine (scheduler)

The AWS credentials on your machine need:

| Service | Actions |
|---------|---------|
| ECS | `RegisterTaskDefinition`, `RunTask`, `DescribeTasks`, `StopTask` |
| ECR | `GetAuthorizationToken`, `BatchCheckLayerAvailability`, `PutImage`, `InitiateLayerUpload`, `UploadLayerPart`, `CompleteLayerUpload` |
| CloudWatch Logs | `GetLogEvents` |
| Secrets Manager | `ListSecrets` (for credential discovery during `prepareCredentials`) |

### Execution role (ECS infrastructure)

| Service | Actions |
|---------|---------|
| ECR | `GetDownloadUrlForLayer`, `BatchGetImage`, `GetAuthorizationToken` |
| CloudWatch Logs | `CreateLogStream`, `PutLogEvents`, `CreateLogGroup` |
| Secrets Manager | `GetSecretValue` (on all agent secrets, so ECS can inject them) |

### Task role (container, per-agent)

| Service | Actions |
|---------|---------|
| Secrets Manager | `GetSecretValue` (scoped to only that agent's secrets) |

## Troubleshooting

**"ECS runtime requires cloud.awsRegion..."** — Ensure all required fields are set in `config.toml` under `[cloud]`.

**"No AWS credentials found"** — Set `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` env vars or run `aws configure`.

**"Failed to start ECS task"** — Check that the ECS cluster exists, subnets have internet access, and the execution role has the required permissions.

**Image push fails** — Verify ECR repository exists and your AWS credentials have ECR push permissions. Run `aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com` manually to test.

**Logs are delayed** — This is expected. CloudWatch Logs has a ~5-10 second ingestion delay. The TUI shows a warning when running in ECS mode.

**Agent can't access secrets** — Verify the per-agent task role has `secretsmanager:GetSecretValue` on the correct secret ARNs. Check with `aws iam get-role-policy --role-name al-dev-task-role --policy-name SecretsAccess`.

**Task stops immediately with exit code 1** — Check CloudWatch Logs for the error. Common causes: missing credentials in Secrets Manager, missing `PLAYBOOK.md`, invalid model config.
