# config.toml Reference

The project-level `config.toml` lives at the root of your Action Llama project. All sections and fields are optional — sensible defaults are used for anything you omit. If the file doesn't exist at all, an empty config is assumed.

## Full Annotated Example

```toml
# Default model for all agents (agents can override in their own agent-config.toml)
[model]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
thinkingLevel = "medium"
authType = "api_key"

# Local Docker container settings
[local]
image = "al-agent:latest"   # Base image name (default: "al-agent:latest")
memory = "4g"               # Memory limit per container (default: "4g")
cpus = 2                    # CPU limit per container (default: 2)
timeout = 900               # Default max container runtime in seconds (default: 900, overridable per-agent)

# Cloud provider config (optional — only needed for `al start -c`)
[cloud]
provider = "cloud-run"      # "cloud-run" or "ecs"
# ... provider-specific fields (see below)

# Gateway HTTP server settings
[gateway]
port = 8080                 # Gateway port (default: 8080)
lockTimeout = 1800          # Lock TTL in seconds (default: 1800 / 30 minutes)

# Webhook sources — named webhook endpoints with provider type and credential
[webhooks.my-github]
type = "github"
credential = "MyOrg"              # credential instance for HMAC validation

# Scheduler settings
maxReruns = 10              # Max consecutive reruns for successful agent runs (default: 10)
maxTriggerDepth = 3         # Max depth for agent-to-agent trigger chains (default: 3)
```

## Field Reference

### Top-level fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxReruns` | number | `10` | Maximum consecutive reruns when an agent requests a rerun via `[RERUN]` before stopping |
| `maxTriggerDepth` | number | `3` | Maximum depth for agent-to-agent `[TRIGGER]` chains (A triggers B triggers C = depth 2) |

### `[model]` — Default LLM

Default model configuration inherited by all agents that don't define their own `[model]` section in `agent-config.toml`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | string | Yes | LLM provider: `"anthropic"`, `"openai"`, `"groq"`, `"google"`, `"xai"`, `"mistral"`, `"openrouter"`, or `"custom"` |
| `model` | string | Yes | Model ID (e.g. `"claude-sonnet-4-20250514"`, `"gpt-4o"`, `"gemini-2.0-flash-exp"`) |
| `authType` | string | Yes | Auth method: `"api_key"`, `"oauth_token"`, or `"pi_auth"` |
| `thinkingLevel` | string | No | Thinking budget: `"off"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`. Only applies to Anthropic models with reasoning support. Ignored for other providers. |

See [Models](models.md) for all supported providers, model IDs, auth types, and thinking levels.

### `[local]` — Docker Container Settings

Controls local Docker container isolation. These settings also apply as resource limits for Cloud Run jobs and ECS Fargate tasks.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `image` | string | `"al-agent:latest"` | Base Docker image name |
| `memory` | string | `"4g"` | Memory limit per container (e.g. `"4g"`, `"8g"`, `"4096"` for ECS in MiB) |
| `cpus` | number | `2` | CPU limit per container |
| `timeout` | number | `900` | Default max container runtime in seconds. Individual agents can override this with `timeout` in their `agent-config.toml`. On AWS ECS, agents with effective timeout <= 900s automatically route to Lambda for faster cold starts. See [agent timeout docs](agent-config-reference.md#timeout). |

### `[cloud]` — Cloud Provider

Only needed when running agents on cloud infrastructure with `al start -c`. Configure using `al cloud setup` (interactive wizard) or manually.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | string | Yes | `"cloud-run"` (GCP) or `"ecs"` (AWS) |

#### Cloud Run fields (`provider = "cloud-run"`)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `gcpProject` | string | Yes | — | GCP project ID |
| `region` | string | Yes | — | Cloud Run region (e.g. `"us-central1"`) |
| `artifactRegistry` | string | Yes | — | Full Artifact Registry repo path (e.g. `"us-central1-docker.pkg.dev/my-project/al-images"`) |
| `serviceAccount` | string | No | — | Runtime service account for job creation. Per-agent SAs are used for execution. |
| `secretPrefix` | string | No | `"action-llama"` | Google Secret Manager name prefix |

See [Cloud Run docs](cloud-run.md) for full setup.

#### ECS Fargate fields (`provider = "ecs"`)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `awsRegion` | string | Yes | — | AWS region (e.g. `"us-east-1"`) |
| `ecsCluster` | string | Yes | — | ECS cluster name or ARN |
| `ecrRepository` | string | Yes | — | Full ECR repository URI (e.g. `"123456789012.dkr.ecr.us-east-1.amazonaws.com/al-images"`) |
| `executionRoleArn` | string | Yes | — | IAM role ARN for task execution (ECR pull + CloudWatch Logs) |
| `taskRoleArn` | string | Yes | — | Default IAM task role ARN (Secrets Manager access) |
| `subnets` | string[] | Yes | — | VPC subnet IDs for Fargate tasks |
| `securityGroups` | string[] | No | — | Security group IDs for Fargate tasks |
| `awsSecretPrefix` | string | No | `"action-llama"` | AWS Secrets Manager name prefix |
| `buildBucket` | string | No | auto-created | S3 bucket for CodeBuild source uploads |
| `lambdaRoleArn` | string | No | auto-derived | Lambda execution role ARN. If omitted, per-agent roles (`al-{agentName}-lambda-role`) are derived automatically. |
| `lambdaSubnets` | string[] | No | — | VPC subnet IDs for Lambda functions (only needed if Lambda must access VPC resources) |
| `lambdaSecurityGroups` | string[] | No | — | Security group IDs for Lambda functions (only needed with `lambdaSubnets`) |

See [ECS docs](ecs.md) for full setup.

### `[gateway]` — HTTP Server

The gateway starts automatically when Docker mode or webhooks are enabled. It handles health checks, webhook reception, credential serving (local Docker only), resource locking, and the shutdown kill switch.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | number | `8080` | Port for the gateway HTTP server |
| `lockTimeout` | number | `1800` | Default lock TTL in seconds. Locks expire automatically after this duration unless refreshed via heartbeat. |

### `[webhooks.*]` — Webhook Sources

Named webhook sources that agents can reference in their `[[webhooks]]` triggers. Each source defines a provider type and an optional credential for signature validation.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Provider type: `"github"` or `"sentry"` |
| `credential` | string | No | Credential instance name for HMAC signature validation (e.g. `"MyOrg"` maps to `github_webhook_secret:MyOrg`). Omit for unsigned webhooks. |

```toml
[webhooks.my-github]
type = "github"
credential = "MyOrg"              # uses github_webhook_secret:MyOrg for HMAC validation

[webhooks.my-sentry]
type = "sentry"
credential = "SentryProd"         # uses sentry_client_secret:SentryProd

[webhooks.unsigned-github]
type = "github"                   # no credential — accepts unsigned webhooks
```

Agents reference these sources by name in their `agent-config.toml`:

```toml
[[webhooks]]
source = "my-github"
events = ["issues"]
```

## Minimal Examples

### Anthropic with Docker (typical dev setup)

```toml
[model]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
thinkingLevel = "medium"
authType = "api_key"
```

Everything else uses defaults: Docker enabled, 4GB memory, 2 CPUs, 15min timeout, gateway on port 8080.

### Cloud Run production

```toml
[model]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
thinkingLevel = "medium"
authType = "api_key"

[local]
memory = "8g"
cpus = 4
timeout = 7200

[cloud]
provider = "cloud-run"
gcpProject = "my-gcp-project"
region = "us-central1"
artifactRegistry = "us-central1-docker.pkg.dev/my-gcp-project/al-images"

[gateway]
port = 3000
```

### ECS Fargate production

```toml
[model]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
thinkingLevel = "medium"
authType = "api_key"

[cloud]
provider = "ecs"
awsRegion = "us-east-1"
ecsCluster = "al-cluster"
ecrRepository = "123456789012.dkr.ecr.us-east-1.amazonaws.com/al-images"
executionRoleArn = "arn:aws:iam::123456789012:role/ecsTaskExecutionRole"
taskRoleArn = "arn:aws:iam::123456789012:role/al-default-task-role"
subnets = ["subnet-abc123"]

maxReruns = 5
maxTriggerDepth = 2
```
