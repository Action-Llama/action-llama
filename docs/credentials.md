# Credentials

Credentials are stored as files in `~/.action-llama-credentials/`. Each credential has a unique ID used in `agent-config.toml`.

## Built-in Credentials

| ID | File | Description | Env Var |
|----|------|-------------|---------|
| `github-token` | `github-token` | GitHub PAT with repo and workflow scopes | `GITHUB_TOKEN` |
| `anthropic-key` | `anthropic-key` | Anthropic API key, OAuth token, or pi auth | _(read by SDK)_ |
| `sentry-token` | `sentry-token` | Sentry auth token for error monitoring | `SENTRY_AUTH_TOKEN` |
| `id_rsa` | `id_rsa` | SSH private key for git over SSH | _(mounted as file)_ |
| `github-webhook-secret` | `github-webhook-secret` | Shared secret for GitHub webhook verification | _(used by gateway)_ |
| `sentry-client-secret` | `sentry-client-secret` | Client secret for Sentry webhook verification | _(used by gateway)_ |

## How Credentials Work

1. **Configuration**: List credential IDs in your agent's `agent-config.toml`:
   ```toml
   credentials = ["anthropic-key", "github-token"]
   ```

2. **Storage**: Credential values live in `~/.action-llama-credentials/<filename>`. Single-value credentials are plain text files. Multi-value credentials are JSON.

3. **Injection**: At runtime, credentials with `envVars` are injected as environment variables into the agent's container/process.

## Setting Up Credentials

### During `al new`

The `al new` command prompts for GitHub token, SSH key, and Anthropic auth during setup.

### Manually

Write credential files directly:

```bash
mkdir -p ~/.action-llama-credentials
echo "ghp_your_token_here" > ~/.action-llama-credentials/github-token
echo "sk-ant-api-your_key_here" > ~/.action-llama-credentials/anthropic-key
```

### Anthropic Auth Methods

Three auth methods are supported:

- **`api_key`** — Standard API key (`sk-ant-api-...`). Set `authType = "api_key"` in model config.
- **`oauth_token`** — OAuth token (`sk-ant-oat-...`). Set `authType = "oauth_token"`.
- **`pi_auth`** — Use existing pi auth credentials (`~/.pi/agent/auth.json`). Set `authType = "pi_auth"`. No credential file needed.

## Webhook Secrets

Webhook secrets are configured in the project's global `config.json`:

```json
{
  "webhooks": {
    "secretCredentials": {
      "github": "github-webhook-secret",
      "sentry": "sentry-client-secret"
    }
  }
}
```

The gateway reads these credentials to verify incoming webhook payloads.
