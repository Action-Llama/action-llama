# agent-config.toml Reference

Each agent has an `agent-config.toml` file in its directory. The agent name is derived from the directory name and should not be included in the config.

## Full Annotated Example

```toml
# Required: credential IDs the agent needs at runtime
# These must exist in ~/.action-llama-credentials/<type>/<instance>/
credentials = ["github_token:default", "git_ssh:default", "sentry_token:default"]

# Optional: cron schedule (standard cron syntax)
# Agent must have at least one of: schedule, webhooks
schedule = "*/5 * * * *"

# Optional: number of parallel instances (default: 1)
# Allows the agent to handle multiple tasks simultaneously
parallelism = 2

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
| `parallelism` | number | No | Number of parallel instances for concurrent execution (default: 1) |
| `model` | table | No | LLM model configuration (falls back to `[model]` in project `config.toml`) |
| `model.provider` | string | Yes* | LLM provider ("anthropic", "openai", "groq", "google", "xai", "mistral", "openrouter", or "custom") |
| `model.model` | string | Yes* | Model ID |
| `model.thinkingLevel` | string | No | Thinking budget level: off, minimal, low, medium, high, xhigh. Only relevant for models with reasoning support (e.g. Claude Sonnet/Opus). Omit for other models. |
| `model.authType` | string | Yes* | Auth method for the provider |
| `webhooks` | array | No* | Array of webhook trigger objects |
| `params` | table | No | Custom key-value params for the agent prompt |

*At least one of `schedule` or `webhooks` is required. *Required within `[model]` if the agent defines its own model block (otherwise inherits from project `config.toml`).

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
