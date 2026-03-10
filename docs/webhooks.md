# Webhooks

Action Llama agents can be triggered by webhooks in addition to (or instead of) cron schedules.

## Defining Webhook Sources

Webhook sources are defined once in the project's `config.toml`. Each source has a name, a provider type, and an optional credential for signature validation:

```toml
[webhooks.my-github]
type = "github"
credential = "MyOrg"          # credential instance name (github_webhook_secret:MyOrg)

[webhooks.my-sentry]
type = "sentry"
credential = "SentryProd"     # credential instance name (sentry_client_secret:SentryProd)

[webhooks.my-linear]
type = "linear"
credential = "LinearMain"     # credential instance name (linear_webhook_secret:LinearMain)
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Provider type: `"github"`, `"sentry"`, or `"linear"` |
| `credential` | string | No | Credential instance name for HMAC signature validation. Omit for unsigned webhooks. |

## Agent Webhook Triggers

Agents reference a webhook source by name and add filters in their `agent-config.toml`:

```toml
[[webhooks]]
source = "my-github"
repos = ["acme/app"]
events = ["issues"]
actions = ["labeled"]
labels = ["agent"]
```

Each `[[webhooks]]` entry is a trigger. The `source` field (referencing a name from `config.toml`) is required. All filter fields (`repos`, `events`, `actions`, `labels`, etc.) are optional — omit all of them to trigger on everything from that source.

An agent must have at least one of `schedule` or `webhooks` (or both).

## GitHub Webhooks

### Filter Fields (all optional)

| Field | Type | Description |
|-------|------|-------------|
| `repos` | string[] | Only trigger for these repos |
| `events` | string[] | GitHub event types (issues, pull_request, push, etc.) |
| `actions` | string[] | Event actions (opened, labeled, closed, etc.) |
| `labels` | string[] | Only when issue/PR has these labels |
| `assignee` | string | Only when assigned to this user |
| `author` | string | Only for this author |
| `branches` | string[] | Only for these branches |

### Setup

1. In your GitHub repo, go to **Settings > Webhooks > Add webhook**
2. Set the payload URL to your Action Llama gateway (e.g. `https://your-server:8080/webhooks/github`)
3. Set content type to `application/json`
4. Set the secret to match the `github_webhook_secret` credential instance referenced by the webhook source in `config.toml`
5. Select the events you want to receive

### Using ngrok for Local Development

```bash
ngrok http 8080
```

Use the ngrok URL as your webhook payload URL in GitHub.

## Sentry Webhooks

### Filter Fields

| Field | Type | Description |
|-------|------|-------------|
| `resources` | string[] | Resource types: event_alert, metric_alert, issue, error, comment |

### Setup

1. In Sentry, go to **Settings > Developer Settings > New Internal Integration**
2. Set the webhook URL to your gateway (e.g. `https://your-server:8080/webhooks/sentry`)
3. Copy the client secret to `~/.action-llama-credentials/sentry_client_secret/<instance>/secret`
4. Select the resource types you want to receive

## How Webhooks Work at Runtime

1. The gateway receives a webhook POST request at `/webhooks/<type>` (e.g. `/webhooks/github`)
2. It verifies the payload signature using secrets loaded from the credential instances defined in `config.toml` webhook sources
3. It parses the event into a `WebhookContext` (source, event, action, repo, etc.)
4. It matches the context against each agent's webhook triggers
5. Matching agents are triggered with the webhook context injected into their prompt

## Linear Webhooks

### Filter Fields (all optional)

| Field | Type | Description |
|-------|------|-------------|
| `organizations` | string[] | Only trigger for these Linear organizations |
| `events` | string[] | Linear event types (issues, issue_comment, etc.) |
| `actions` | string[] | Event actions (create, update, delete, etc.) |
| `labels` | string[] | Only when issue has these labels |
| `assignee` | string | Only when assigned to this user (email) |
| `author` | string | Only for this author (email) |

### Setup

1. In Linear, go to **Settings > Workspace > Webhooks**
2. Click **Create webhook**
3. Set the URL to your Action Llama gateway (e.g. `https://your-server:8080/webhooks/linear`)
4. Set the secret to match the `linear_webhook_secret` credential instance referenced by the webhook source in `config.toml`
5. Select the resource types you want to receive (Issues, Comments, etc.)

### Example Configuration

```toml
# In config.toml
[webhooks.linear-main]
type = "linear"
credential = "main-workspace"

# In agent-config.toml
[[webhooks]]
source = "linear-main"
events = ["issues", "issue_comment"]
actions = ["create", "update"]
organizations = ["your-org-id"]
labels = ["bug", "ready-for-dev"]
```

## Hybrid Agents

Agents can have both `schedule` and `webhooks`. Scheduled runs poll for work; webhook runs respond to events immediately.
