# Credentials

Credentials are stored in `~/.action-llama-credentials/<type>/<instance>/<field>`. Each credential type is a directory containing one file per field. Reference them in `agent-config.toml` as `"type:instance"` (e.g. `"github_token:default"`).

## Built-in Credentials

| Type | Fields | Description | Runtime Injection |
|------|--------|-------------|-------------------|
| `github_token` | `token` | GitHub PAT with repo and workflow scopes | `GITHUB_TOKEN` and `GH_TOKEN` env vars |
| `anthropic_key` | `token` | Anthropic API key, OAuth token, or pi auth | _(read by SDK)_ |
| `sentry_token` | `token` | Sentry auth token for error monitoring | `SENTRY_AUTH_TOKEN` env var |
| `bugsnag_token` | `token` | Bugsnag auth token for error monitoring and release management | `BUGSNAG_AUTH_TOKEN` env var |
| `netlify_token` | `token` | Netlify Personal Access Token for site management | `NETLIFY_AUTH_TOKEN` env var |
| `git_ssh` | `id_rsa`, `username`, `email` | SSH private key + git author identity | SSH key mounted as file; `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL`/`GIT_COMMITTER_NAME`/`GIT_COMMITTER_EMAIL` set from `username`/`email` |
| `github_webhook_secret` | `secret` | Shared secret for GitHub webhook verification | _(used by gateway)_ |
| `sentry_client_secret` | `secret` | Client secret for Sentry webhook verification | _(used by gateway)_ |
| `x_twitter_api` | `api_key`, `api_secret`, `bearer_token`, `access_token`, `access_token_secret` | X (Twitter) API credentials for platform access | `X_API_KEY`, `X_API_SECRET`, `X_BEARER_TOKEN`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` env vars |
| `aws` | `access_key_id`, `secret_access_key`, `default_region` | AWS credentials for managing AWS resources | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION` env vars |

## How Credentials Work

1. **Configuration**: List credential refs in your agent's `agent-config.toml`:
   ```toml
   credentials = ["github_token:default", "git_ssh:default"]
   ```

2. **Storage**: Credential values live in `~/.action-llama-credentials/<type>/<instance>/<field>`. Each field is a plain text file.

3. **Injection**: At runtime, credentials with env vars are injected as environment variables into the agent's container/process.

4. **Git identity**: The `git_ssh` credential includes `username` and `email` fields (prompted during `al new`/`al setup`). These are injected as `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` and `GIT_COMMITTER_NAME`/`GIT_COMMITTER_EMAIL` env vars at runtime, so `git commit` works without requiring `git config`.

## Named Instances

Each credential type supports named instances. For example, you could have webhook secrets for multiple GitHub orgs:

```
~/.action-llama-credentials/github_webhook_secret/MyOrg/secret
~/.action-llama-credentials/github_webhook_secret/OtherOrg/secret
```

Or multiple SSH keys:

```
~/.action-llama-credentials/git_ssh/default/id_rsa
~/.action-llama-credentials/git_ssh/default/username
~/.action-llama-credentials/git_ssh/botty/id_rsa
~/.action-llama-credentials/git_ssh/botty/username
```

Reference them as `"git_ssh:default"` or `"git_ssh:botty"` in your agent config. If you omit the instance, it defaults to `"default"`.

## Setting Up Credentials

### During `al new`

The `al new` command prompts for the Anthropic credential during initial setup. Other credentials are configured per-agent by `al setup`.

### Via `al setup`

Run `al setup` to scan all agents and prompt for any missing credentials.

### Manually

Write credential files directly:

```bash
mkdir -p ~/.action-llama-credentials/github_token/default
echo "ghp_your_token_here" > ~/.action-llama-credentials/github_token/default/token

mkdir -p ~/.action-llama-credentials/anthropic_key/default
echo "sk-ant-api-your_key_here" > ~/.action-llama-credentials/anthropic_key/default/token

mkdir -p ~/.action-llama-credentials/bugsnag_token/default
echo "your_bugsnag_token_here" > ~/.action-llama-credentials/bugsnag_token/default/token

mkdir -p ~/.action-llama-credentials/netlify_token/default
echo "your_netlify_token_here" > ~/.action-llama-credentials/netlify_token/default/token
```

### Anthropic Auth Methods

Three auth methods are supported:

- **`api_key`** — Standard API key (`sk-ant-api-...`). Set `authType = "api_key"` in model config.
- **`oauth_token`** — OAuth token (`sk-ant-oat-...`). Set `authType = "oauth_token"`.
- **`pi_auth`** — Use existing pi auth credentials (`~/.pi/agent/auth.json`). Set `authType = "pi_auth"`. No credential file needed.

## Webhook Secrets

Webhook secrets use named credential instances. For example, to set up a GitHub webhook secret for your org:

```bash
mkdir -p ~/.action-llama-credentials/github_webhook_secret/MyOrg
echo "your-webhook-secret" > ~/.action-llama-credentials/github_webhook_secret/MyOrg/secret
```

The gateway automatically loads secrets from all credential instances (e.g. `github_webhook_secret:MyOrg`, `sentry_client_secret:MyOrg`) and uses them to verify incoming webhook payloads. No global configuration is needed.

## Remote Credential Stores

Credentials can be synced to cloud secret managers for use with cloud runtimes.

### Google Secret Manager (GSM)

```bash
al remote add production --provider gsm --gcp-project my-gcp-project -p .
al creds push production -p .
al creds pull production -p .
```

Secret naming: `{prefix}--{type}--{instance}--{field}` (dashes, since GSM disallows slashes).

### AWS Secrets Manager (ASM)

```bash
al remote add aws-prod --provider asm --aws-region us-east-1 -p .
al creds push aws-prod -p .
al creds pull aws-prod -p .
```

Secret naming: `{prefix}/{type}/{instance}/{field}` (slashes).

Requires `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` env vars or a configured AWS CLI (`aws configure`).

### Configuration

Remotes are stored in `config.toml`:

```toml
[remotes.production]
provider = "gsm"
gcpProject = "my-gcp-project"

[remotes.aws-prod]
provider = "asm"
awsRegion = "us-east-1"
# secretPrefix = "action-llama"   # optional, default: "action-llama"
```
