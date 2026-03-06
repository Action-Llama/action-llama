# agent-config.toml Reference

Each agent has an `agent-config.toml` file in its directory. The agent name is derived from the directory name and should not be included in the config.

## Full Annotated Example

```toml
# Required: credential IDs the agent needs at runtime
# These must exist in ~/.action-llama-credentials/<type>/<instance>/
credentials = ["github_token:default", "git_ssh:default", "sentry_token:default"]

# Required: GitHub repos the agent operates on (owner/repo format)
repos = ["acme/app", "acme/api"]

# Optional: cron schedule (standard cron syntax)
# Agent must have at least one of: schedule, webhooks
schedule = "*/5 * * * *"

# Required: LLM model configuration
[model]
provider = "anthropic"                    # LLM provider: anthropic, openai
model = "claude-sonnet-4-20250514"        # Model ID (e.g., claude-3-5-sonnet-20241022, gpt-4, o1-preview, codex-davinci-002)
thinkingLevel = "medium"                  # off | minimal | low | medium | high | xhigh
authType = "api_key"                      # api_key | oauth_token | pi_auth

# Optional: webhook triggers (instead of or in addition to schedule)
[[webhooks]]
type = "github"                           # Required: provider type
source = "MyOrg"                          # Optional: credential instance name for org scoping
repos = ["acme/app"]                      # Filter to specific repos (optional)
events = ["issues"]                       # GitHub event types (optional)
actions = ["labeled"]                     # GitHub event actions (optional)
labels = ["agent"]                        # Only trigger on issues with these labels (optional)

[[webhooks]]
type = "sentry"                           # Required: provider type
resources = ["error", "event_alert"]      # Sentry resource types (optional)

# Optional: custom parameters injected into the agent prompt
[params]
triggerLabel = "agent"
assignee = "bot-user"
sentryOrg = "acme"
sentryProjects = ["web-app", "api"]
```

## Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `credentials` | string[] | Yes | Credential refs as `"type:instance"` needed at runtime |
| `repos` | string[] | Yes | GitHub repos (owner/repo) |
| `schedule` | string | No* | Cron expression for polling |
| `model` | table | Yes | LLM model configuration |
| `model.provider` | string | Yes | LLM provider ("anthropic" or "openai") |
| `model.model` | string | Yes | Model ID |
| `model.thinkingLevel` | string | Yes | Thinking budget level |
| `model.authType` | string | Yes | Auth method for the provider |
| `webhooks` | array | No* | Array of webhook trigger objects |
| `params` | table | No | Custom key-value params for the agent prompt |

*At least one of `schedule` or `webhooks` is required.

## Webhook Trigger Fields

Each `[[webhooks]]` entry has the following fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Provider type: `"github"`, `"sentry"`, etc. |
| `source` | string | No | Credential instance name (e.g. `"MyOrg"`) for org scoping |

All filter fields below are optional. Omit all of them to trigger on everything from that type.

### GitHub (`type = "github"`)

| Field | Type | Description |
|-------|------|-------------|
| `repos` | string[] | Filter to specific repos |
| `events` | string[] | Event types: issues, pull_request, push, etc. |
| `actions` | string[] | Event actions: opened, labeled, closed, etc. |
| `labels` | string[] | Only trigger when issue/PR has these labels |
| `assignee` | string | Only trigger when assigned to this user |
| `author` | string | Only trigger for this author |
| `branches` | string[] | Only trigger for these branches |

### Sentry (`type = "sentry"`)

| Field | Type | Description |
|-------|------|-------------|
| `resources` | string[] | Resource types: event_alert, metric_alert, issue, error, comment |

## Model Configuration Examples

### Anthropic Claude

```toml
[model]
provider = "anthropic"
model = "claude-3-5-sonnet-20241022"      # or claude-3-opus-20240229, claude-3-haiku-20240307
thinkingLevel = "medium"
authType = "api_key"
```

### OpenAI GPT/Codex

```toml
[model]
provider = "openai"
model = "gpt-4o"                          # or gpt-4, o1-preview, gpt-3.5-turbo, codex-davinci-002
thinkingLevel = "medium"
authType = "api_key"
```

For OpenAI Codex specifically:

```toml
[model]
provider = "openai"
model = "codex-davinci-002"               # Legacy Codex model (note: deprecated by OpenAI)
thinkingLevel = "low"                     # Codex works better with lower thinking levels
authType = "api_key"
```

**Note:** OpenAI has deprecated the original Codex models. For code generation, consider using `gpt-4` or `gpt-4o` which have excellent coding capabilities.

## Cloud Runtimes

### Cloud Run (GCP)

When using Cloud Run mode (`cloud.provider = "cloud-run"` in `config.toml`), each agent automatically gets a per-agent service account (`al-{agentName}@{gcpProject}.iam.gserviceaccount.com`) that only has access to the credentials listed in that agent's `credentials` array. Run `al doctor -c` to create the service accounts and IAM bindings. See [Cloud Run docs](cloud-run.md) for details.

### ECS Fargate (AWS)

When using ECS mode (`cloud.provider = "ecs"` in `config.toml`), each agent automatically uses a per-agent IAM task role (`al-{agentName}-task-role`) that only has access to the credentials listed in that agent's `credentials` array. The task role ARN is derived from the ECR repository's account ID. See [ECS docs](ecs.md) for setup instructions including how to create the per-agent task roles.
