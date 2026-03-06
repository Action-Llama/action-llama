# Webhooks

Action Llama agents can be triggered by webhooks in addition to (or instead of) cron schedules.

## Configuration

Add a `webhooks` section to your `agent-config.toml`:

```toml
[[webhooks]]
type = "github"
source = "MyOrg"                # optional: credential instance name for org scoping
repos = ["acme/app"]
events = ["issues"]
actions = ["labeled"]
labels = ["agent"]
```

Each `[[webhooks]]` entry is a trigger. The `type` field (provider type) is required. All filter fields (`repos`, `events`, `actions`, `labels`, etc.) are optional — omit all of them to trigger on everything from that type. The `source` field is optional and specifies a credential instance name (e.g. `"MyOrg"`) for scoping to a specific org.

An agent must have at least one of `schedule` or `webhooks` (or both).

## GitHub Webhooks

### Trigger-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Provider type: `"github"` |
| `source` | string | No | Credential instance name (e.g. `"MyOrg"`) for org scoping |

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
2. Set the payload URL to your Action Llama gateway (e.g. `https://your-server:3000/webhook`)
3. Set content type to `application/json`
4. Set the secret to match your `github_webhook_secret` credential instance (e.g. `github_webhook_secret:MyOrg`)
5. Select the events you want to receive

### Using ngrok for Local Development

```bash
ngrok http 3000
```

Use the ngrok URL as your webhook payload URL in GitHub.

## Sentry Webhooks

### Filter Fields

| Field | Type | Description |
|-------|------|-------------|
| `resources` | string[] | Resource types: event_alert, metric_alert, issue, error, comment |

### Setup

1. In Sentry, go to **Settings > Developer Settings > New Internal Integration**
2. Set the webhook URL to your gateway
3. Copy the client secret to `~/.action-llama-credentials/sentry_client_secret/<instance>/secret`
4. Select the resource types you want to receive

## How Webhooks Work at Runtime

1. The gateway receives a webhook POST request
2. It verifies the payload signature using secrets loaded automatically from all credential instances
3. It parses the event into a `WebhookContext` (source, event, action, repo, etc.)
4. It matches the context against each agent's webhook triggers
5. Matching agents are triggered with the webhook context injected into their prompt

## Hybrid Agents

Agents can have both `schedule` and `webhooks`. Scheduled runs poll for work; webhook runs respond to events immediately.
