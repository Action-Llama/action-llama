# Credentials

Credentials are stored in `~/.action-llama/credentials/<type>/<instance>/<field>`. Each credential type is a directory containing one file per field. Reference them in `agent-config.toml` by type name (e.g. `"github_token"`). The instance is resolved automatically: agent-specific (`<agentName>`) first, then `default` as fallback.

## Built-in Credentials

| Type | Fields | Description | Runtime Injection |
|------|--------|-------------|-------------------|
| `github_token` | `token` | GitHub PAT with repo and workflow scopes | `GITHUB_TOKEN` and `GH_TOKEN` env vars |
| `anthropic_key` | `token` | Anthropic API key, OAuth token, or pi auth | _(read by SDK)_ |
| `openai_key` | `token` | OpenAI API key | _(read by SDK)_ |
| `groq_key` | `token` | Groq API key | _(read by SDK)_ |
| `google_key` | `token` | Google Gemini API key | _(read by SDK)_ |
| `xai_key` | `token` | xAI API key | _(read by SDK)_ |
| `mistral_key` | `token` | Mistral API key | _(read by SDK)_ |
| `openrouter_key` | `token` | OpenRouter API key | _(read by SDK)_ |
| `custom_key` | `token` | Custom provider API key | _(read by SDK)_ |
| `sentry_token` | `token` | Sentry auth token for error monitoring | `SENTRY_AUTH_TOKEN` env var |
| `linear_token` | `token` | Linear personal API token for workspace access | `LINEAR_API_TOKEN` env var |
| `linear_oauth` | `client_id`, `client_secret`, `access_token`, `refresh_token` | Linear OAuth2 credentials for workspace access | `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, `LINEAR_ACCESS_TOKEN`, `LINEAR_REFRESH_TOKEN` env vars |
| `bugsnag_token` | `token` | Bugsnag auth token for error monitoring and release management | `BUGSNAG_AUTH_TOKEN` env var |
| `netlify_token` | `token` | Netlify Personal Access Token for site management | `NETLIFY_AUTH_TOKEN` env var |
| `git_ssh` | `id_rsa`, `username`, `email` | SSH private key + git author identity | SSH key mounted as file; `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL`/`GIT_COMMITTER_NAME`/`GIT_COMMITTER_EMAIL` set from `username`/`email` |
| `gateway_api_key` | `key` | API key for dashboard and CLI access to the gateway | _(used by gateway + CLI)_ |
| `github_webhook_secret` | `secret` | Shared secret for GitHub webhook verification | _(used by gateway)_ |
| `sentry_client_secret` | `secret` | Client secret for Sentry webhook verification | _(used by gateway)_ |
| `linear_webhook_secret` | `secret` | Shared secret for Linear webhook verification | _(used by gateway)_ |
| `x_twitter_api` | `api_key`, `api_secret`, `bearer_token`, `access_token`, `access_token_secret` | X (Twitter) API credentials for platform access | `X_API_KEY`, `X_API_SECRET`, `X_BEARER_TOKEN`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` env vars |
| `aws` | `access_key_id`, `secret_access_key`, `default_region` | AWS credentials for managing AWS resources | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION` env vars |
| `vultr_api_key` | `api_key` | Vultr API key for VPS provisioning (not needed at agent runtime) | `VULTR_API_KEY` env var |

## How Credentials Work

1. **Configuration**: List credential types in your agent's `agent-config.toml`:
   ```toml
   credentials = ["github_token", "git_ssh"]
   ```

2. **Storage**: Credential values live in `~/.action-llama/credentials/<type>/<instance>/<field>`. Each field is a plain text file.

3. **Injection**: When an agent runs, the credentials it requires are injected into the container.

4. **Git identity**: The `git_ssh` credential includes `username` and `email` fields (prompted during `al new`/`al doctor`). These are injected as `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` and `GIT_COMMITTER_NAME`/`GIT_COMMITTER_EMAIL` env vars at runtime, so `git commit` works without requiring `git config`.

## Named Instances

Each credential type supports named instances. For example, you could have webhook secrets for multiple GitHub orgs:

```
~/.action-llama/credentials/github_webhook_secret/MyOrg/secret
~/.action-llama/credentials/github_webhook_secret/OtherOrg/secret
```

Or multiple SSH keys:

```
~/.action-llama/credentials/git_ssh/default/id_rsa
~/.action-llama/credentials/git_ssh/default/username
~/.action-llama/credentials/git_ssh/botty/id_rsa
~/.action-llama/credentials/git_ssh/botty/username
```

By default, just reference `"git_ssh"` — the instance is resolved automatically (agent-specific first, then `default`). To explicitly reference another agent's credential, use the cross-agent syntax: `"botty/git_ssh"`.

## Managing Credentials

### `al creds add`

Add or update a credential interactively. Runs validation for the credential type (e.g. API key format, GitHub API check):

```bash
al creds add github_token              # adds github_token:default
al creds add github_webhook_secret:myapp
al creds add git_ssh:prod
```

### `al creds rm`

Remove a credential:

```bash
al creds rm github_token               # removes github_token:default
al creds rm github_webhook_secret:myapp
```

### `al creds ls`

List all stored credentials grouped by type:

```bash
al creds ls
```

### `al doctor`

Scan all agents in a project and prompt for any missing credentials:

```bash
al doctor -p .
```

### During `al new`

The `al new` command prompts for the Anthropic credential during initial setup. Other credentials are configured per-agent by `al doctor` or `al creds add`.

### Manually

Write credential files directly:

```bash
mkdir -p ~/.action-llama/credentials/github_token/default
echo "ghp_your_token_here" > ~/.action-llama/credentials/github_token/default/token

mkdir -p ~/.action-llama/credentials/anthropic_key/default
echo "sk-ant-api-your_key_here" > ~/.action-llama/credentials/anthropic_key/default/token

mkdir -p ~/.action-llama/credentials/openai_key/default
echo "sk-your_openai_key_here" > ~/.action-llama/credentials/openai_key/default/token

mkdir -p ~/.action-llama/credentials/groq_key/default
echo "gsk_your_groq_key_here" > ~/.action-llama/credentials/groq_key/default/token

mkdir -p ~/.action-llama/credentials/bugsnag_token/default
echo "your_bugsnag_token_here" > ~/.action-llama/credentials/bugsnag_token/default/token

mkdir -p ~/.action-llama/credentials/netlify_token/default
echo "your_netlify_token_here" > ~/.action-llama/credentials/netlify_token/default/token
```

### Anthropic Auth Methods

Three auth methods are supported:

- **`api_key`** — Standard API key (`sk-ant-api-...`). Set `authType = "api_key"` in model config.
- **`oauth_token`** — OAuth token (`sk-ant-oat-...`). Set `authType = "oauth_token"`.
- **`pi_auth`** — Use existing pi auth credentials (`~/.pi/agent/auth.json`). Set `authType = "pi_auth"`. No credential file needed.

## Webhook Secrets

Webhook secrets use named credential instances. For example, to set up a GitHub webhook secret for your org:

```bash
mkdir -p ~/.action-llama/credentials/github_webhook_secret/MyOrg
echo "your-webhook-secret" > ~/.action-llama/credentials/github_webhook_secret/MyOrg/secret
```

The gateway automatically loads secrets from all credential instances (e.g. `github_webhook_secret:MyOrg`, `sentry_client_secret:MyOrg`) and uses them to verify incoming webhook payloads. No global configuration is needed.

## Cloud Credential Sync

When using cloud runtimes, credentials are automatically pushed to the cloud secret manager by `al doctor -c` or `al setup cloud`. See [Cloud Run docs](cloud-run.md) and [ECS docs](ecs.md) for details.

### Google Secret Manager (GSM)

Secret naming: `{prefix}--{type}--{instance}--{field}` (dashes, since GSM disallows slashes).

### AWS Secrets Manager (ASM)

Secret naming: `{prefix}/{type}/{instance}/{field}` (slashes).

Requires `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` env vars or a configured AWS CLI (`aws configure`).

### VPS Filesystem (SSH)

Secret naming: `~/.action-llama/credentials/{type}/{instance}/{field}` on the remote server (same layout as local).

Credentials are transferred via SSH. No external secrets manager needed — same trust model as SSH access.
