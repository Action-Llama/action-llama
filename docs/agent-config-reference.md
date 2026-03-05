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
provider = "anthropic"                    # LLM provider
model = "claude-sonnet-4-20250514"        # Model ID
thinkingLevel = "medium"                  # off | minimal | low | medium | high | xhigh
authType = "api_key"                      # api_key | oauth_token | pi_auth

# Optional: webhook triggers (instead of or in addition to schedule)
[[webhooks.filters]]
source = "github"
repos = ["acme/app"]                      # Filter to specific repos
events = ["issues"]                       # GitHub event types
actions = ["labeled"]                     # GitHub event actions
labels = ["agent"]                        # Only trigger on issues with these labels

[[webhooks.filters]]
source = "sentry"
resources = ["error", "event_alert"]      # Sentry resource types

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
| `model.provider` | string | Yes | LLM provider (e.g. "anthropic") |
| `model.model` | string | Yes | Model ID |
| `model.thinkingLevel` | string | Yes | Thinking budget level |
| `model.authType` | string | Yes | Auth method for the provider |
| `webhooks` | table | No* | Webhook trigger configuration |
| `webhooks.filters` | array | Yes (if webhooks) | Array of filter objects |
| `params` | table | No | Custom key-value params for the agent prompt |

*At least one of `schedule` or `webhooks` is required.

## Webhook Filter Fields

### GitHub (`source = "github"`)

| Field | Type | Description |
|-------|------|-------------|
| `repos` | string[] | Filter to specific repos |
| `events` | string[] | Event types: issues, pull_request, push, etc. |
| `actions` | string[] | Event actions: opened, labeled, closed, etc. |
| `labels` | string[] | Only trigger when issue/PR has these labels |
| `assignee` | string | Only trigger when assigned to this user |
| `author` | string | Only trigger for this author |
| `branches` | string[] | Only trigger for these branches |

### Sentry (`source = "sentry"`)

| Field | Type | Description |
|-------|------|-------------|
| `resources` | string[] | Resource types: event_alert, metric_alert, issue, error, comment |
