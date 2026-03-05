# Webhooks

Action Llama agents can be triggered by webhooks in addition to (or instead of) cron schedules.

## Configuration

Add a `webhooks` section to your `agent-config.toml`:

```toml
[[webhooks.filters]]
source = "github"
repos = ["acme/app"]
events = ["issues"]
actions = ["labeled"]
labels = ["agent"]
```

An agent must have at least one of `schedule` or `webhooks` (or both).

## GitHub Webhooks

### Filter Fields

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
4. Set the secret to match your `github_webhook_secret` credential
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
3. Copy the client secret to `~/.action-llama-credentials/sentry_client_secret/default/secret`
4. Select the resource types you want to receive

## Global Webhook Config

The project's `config.json` maps webhook sources to their secret credentials:

```json
{
  "webhooks": {
    "secretCredentials": {
      "github": "github_webhook_secret:default",
      "sentry": "sentry_client_secret:default"
    }
  }
}
```

## How Webhooks Work at Runtime

1. The gateway receives a webhook POST request
2. It verifies the payload signature using the configured secret
3. It parses the event into a `WebhookContext` (source, event, action, repo, etc.)
4. It matches the context against each agent's webhook filters
5. Matching agents are triggered with the webhook context injected into their prompt

## Hybrid Agents

Agents can have both `schedule` and `webhooks`. Scheduled runs poll for work; webhook runs respond to events immediately.
