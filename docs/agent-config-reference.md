# agent-config.toml Reference

Each agent has an `agent-config.toml` file in its directory. The agent name is derived from the directory name and should not be included in the config.

## Full Annotated Example

```toml
# Required: credential IDs the agent needs at runtime
# These must exist in ~/.action-llama/credentials/<type>/<instance>/
credentials = ["github_token:default", "git_ssh:default", "sentry_token:default"]

# Optional: cron schedule (standard cron syntax)
# Agent must have at least one of: schedule, webhooks
schedule = "*/5 * * * *"

# Optional: number of concurrent runs allowed (default: 1)
# When scale > 1, use LOCK/UNLOCK in your actions to coordinate
# and prevent instances from working on the same resource.
scale = 2

# Optional: max runtime in seconds (default: falls back to [local].timeout, then 900)
# On AWS ECS, agents with timeout <= 900 automatically route to Lambda
# for faster cold starts (~1-2s vs ~30-60s on Fargate). Agents with
# timeout > 900 run on ECS Fargate.
timeout = 600

# Required: LLM model configuration
[model]
provider = "anthropic"                    # LLM provider: anthropic, openai, groq, google, xai, mistral, openrouter, or custom
model = "claude-sonnet-4-20250514"        # Model ID (e.g., claude-sonnet-4-20250514, gpt-4o, gemini-2.0-flash-exp)
thinkingLevel = "medium"                  # Optional: off | minimal | low | medium | high | xhigh (for models with reasoning support)
authType = "api_key"                      # api_key | oauth_token | pi_auth

# Optional: webhook triggers (instead of or in addition to schedule)
# Each source references a named webhook defined in the project's config.toml
[[webhooks]]
source = "my-github"                      # Required: references [webhooks.my-github] in config.toml
repos = ["acme/app"]                      # Filter to specific repos (optional)
events = ["issues"]                       # GitHub event types (optional)
actions = ["labeled"]                     # GitHub event actions (optional)
labels = ["agent"]                        # Only trigger on issues with these labels (optional)

[[webhooks]]
source = "my-sentry"                      # Required: references [webhooks.my-sentry] in config.toml
resources = ["error", "event_alert"]      # Sentry resource types (optional)

# Optional: custom parameters injected into the agent prompt
[params]
repos = ["acme/app", "acme/api"]
triggerLabel = "agent"
assignee = "bot-user"
sentryOrg = "acme"
sentryProjects = ["web-app", "api"]
```

## Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `credentials` | string[] | Yes | Credential refs as `"type:instance"` needed at runtime |
| `schedule` | string | No* | Cron expression for polling |
| `scale` | number | No | Number of concurrent runs allowed (default: 1). Set to `0` to disable the agent. Use lock skills in your actions to coordinate instances. See [Resource Locks](agents.md#resource-locks). |
| `timeout` | number | No | Max runtime in seconds. Falls back to `[local].timeout` in project config, then `900`. On AWS ECS, agents with timeout <= 900 auto-route to Lambda for faster startup. See [Timeout](#timeout). |
| `model` | table | No | LLM model configuration (falls back to `[model]` in project `config.toml`) |
| `model.provider` | string | Yes* | LLM provider ("anthropic", "openai", "groq", "google", "xai", "mistral", "openrouter", or "custom") |
| `model.model` | string | Yes* | Model ID |
| `model.thinkingLevel` | string | No | Thinking budget level: off, minimal, low, medium, high, xhigh. Only relevant for Claude Sonnet/Opus. Omit for other models. |
| `model.authType` | string | Yes* | Auth method for the provider |
| `webhooks` | array | No* | Array of webhook trigger objects |
| `params` | table | No | Custom key-value params for the agent prompt |

*At least one of `schedule` or `webhooks` is required (unless `scale = 0`). *Required within `[model]` if the agent defines its own model block (otherwise inherits from project `config.toml`).

## Scale

The `scale` field controls how many instances of an agent can run concurrently. This is useful for agents that handle high-volume workloads or when you want to process multiple tasks simultaneously.

- **Default**: 1 (only one instance can run at a time)
- **Minimum**: 0 (disables the agent — no runners, cron jobs, or webhook bindings are created)
- **Maximum**: No hard limit, but consider system resources and model API rate limits

### How it works

1. **Scheduled runs**: If a cron trigger fires but all agent instances are busy, the scheduled run is skipped with a warning
2. **Webhook events**: If a webhook arrives but all instances are busy, the event is queued (up to `workQueueSize` limit in global config, default: 100)
3. **Agent calls**: If one agent calls another but all target instances are busy, the call is queued in the same work queue and processed when a runner frees up

### Example use cases

- **Dev agent** with `scale = 3`: Handle multiple GitHub issues simultaneously
- **Review agent** with `scale = 2`: Review multiple PRs in parallel
- **Monitoring agent** with `scale = 1`: Ensure only one instance processes alerts at a time
- **Disabled agent** with `scale = 0`: Keep the config in the project but don't run it

### Resource considerations

Each parallel instance:
- Uses separate Docker containers (in Docker mode)
- Has independent logging streams
- May consume LLM API quota concurrently
- Uses system memory and CPU

## Timeout

The `timeout` field controls the maximum runtime for an agent invocation. When the timeout expires, the container is terminated.

**Resolution order:** `agent-config.toml timeout` -> `config.toml [local].timeout` -> `900` (default)

This means you can set a project-wide default in `[local].timeout` and override it per-agent.

### Automatic Lambda routing (AWS ECS)

When using `cloud.provider = "ecs"`, agents are automatically routed to the most efficient AWS compute service based on their effective timeout:

| Effective timeout | Runtime | Cold start | Cost |
|---|---|---|---|
| **<= 900s** (15 min) | **AWS Lambda** | ~1-2s | Lower (pay per 100ms) |
| **> 900s** | **ECS Fargate** | ~30-60s | Higher (pay per second, 1-min minimum) |

This routing is automatic — you don't need to configure anything beyond setting the timeout. Both runtimes use the same ECR images (built via CodeBuild) and the same Secrets Manager credentials.

**Why Lambda is faster:** Lambda keeps your container image warm in a pre-provisioned execution environment. When a function is invoked, Lambda can start executing in 1-2 seconds. ECS Fargate, by contrast, must provision a new VM, pull the container image, and start the container — which takes 30-60 seconds.

**When to use a short timeout:** If your agent typically finishes in under 15 minutes (e.g., responding to a webhook, triaging an issue, reviewing a small PR), set `timeout = 600` or similar. The agent gets faster startup and lower cost on AWS. If an agent needs more than 15 minutes (e.g., large refactoring tasks, long-running monitoring loops), use a longer timeout and it will route to ECS Fargate automatically.

### Lambda IAM roles

When `al doctor -c` runs, it automatically creates Lambda execution roles (`al-{agentName}-lambda-role`) for agents whose effective timeout is <= 900s. These roles include permissions for Secrets Manager access, CloudWatch Logs, and ECR image pull. You can override the role with `cloud.lambdaRoleArn` in `config.toml`.

### Examples

```toml
# Fast webhook responder — routes to Lambda on AWS
timeout = 300       # 5 minutes

# Medium-length task — still fits Lambda
timeout = 900       # 15 minutes (Lambda max)

# Long-running agent — routes to ECS Fargate
timeout = 3600      # 1 hour

# Omit timeout — uses [local].timeout or defaults to 900s
# (routes to Lambda on AWS since 900 <= 900)
```

## Webhook Trigger Fields

Each `[[webhooks]]` entry has the following fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | string | Yes | Name of a webhook source from the project's `config.toml` (e.g. `"my-github"`) |

All filter fields below are optional. Omit all of them to trigger on everything from that source.

### GitHub filter fields

| Field | Type | Description |
|-------|------|-------------|
| `repos` | string[] | Filter to specific repos |
| `events` | string[] | Event types: issues, pull_request, push, etc. |
| `actions` | string[] | Event actions: opened, labeled, closed, etc. |
| `labels` | string[] | Only trigger when issue/PR has these labels |
| `assignee` | string | Only trigger when assigned to this user |
| `author` | string | Only trigger for this author |
| `branches` | string[] | Only trigger for these branches |

### Sentry filter fields

| Field | Type | Description |
|-------|------|-------------|
| `resources` | string[] | Resource types: event_alert, metric_alert, issue, error, comment |

## Model Configuration

The `[model]` section is optional — agents inherit the default model from the project's `config.toml`. Only add `[model]` to an agent config if you want to override the default for that specific agent.

See [Models](models.md) for all supported providers, model IDs, auth types, thinking levels, and credential setup.

## Cloud Runtimes

### Cloud Run (GCP)

When using Cloud Run mode (`cloud.provider = "cloud-run"` in `config.toml`), each agent automatically gets a per-agent service account (`al-{agentName}@{gcpProject}.iam.gserviceaccount.com`) that only has access to the credentials listed in that agent's `credentials` array. Run `al doctor -c` to create the service accounts and IAM bindings. See [Cloud Run docs](cloud-run.md) for details.

### ECS Fargate (AWS)

When using ECS mode (`cloud.provider = "ecs"` in `config.toml`), each agent automatically uses a per-agent IAM task role (`al-{agentName}-task-role`) that only has access to the credentials listed in that agent's `credentials` array. The task role ARN is derived from the ECR repository's account ID. See [ECS docs](ecs.md) for setup instructions including how to create the per-agent task roles.
