# Skill: Credentials

Credentials are mounted into your container automatically based on your agent's `credentials` array in `agent-config.toml`. You never need to configure, fetch, or manage credentials yourself — they are ready to use when your run starts.

## Environment variables set for you

| Credential type | Env vars / tools available | How to use |
|----------------|---------------------------|------------|
| `github_token` | `GITHUB_TOKEN`, `GH_TOKEN` | Use `gh` CLI and `git` directly. Both vars are set to the same value. |
| `git_ssh` | `GIT_SSH_COMMAND`, `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` | `git clone`, `git push`, and `git commit` work directly. SSH key is configured automatically. |
| `sentry_token` | `SENTRY_AUTH_TOKEN` | Use `curl` for Sentry API requests. |
| `bugsnag_token` | `BUGSNAG_AUTH_TOKEN` | Use for Bugsnag API requests. |
| `netlify_token` | `NETLIFY_AUTH_TOKEN` | Use for Netlify API requests. |
| `x_twitter_api` | `X_API_KEY`, `X_API_SECRET`, `X_BEARER_TOKEN`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` | Use X API v2 directly. |
| `aws` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION` | Use `aws` CLI and AWS SDKs directly. |

LLM provider keys (`anthropic_key`, `openai_key`, `groq_key`, `google_key`, `xai_key`, `mistral_key`, `openrouter_key`, `custom_key`) are read by the agent SDK internally — they are not exposed as env vars and you do not need to reference them.

Gateway-only credentials (`github_webhook_secret`, `sentry_client_secret`) are not injected into agent containers.

## Git clone protocol

Always clone repos via SSH:

```
git clone git@github.com:owner/repo.git
```

The SSH key is configured automatically via `GIT_SSH_COMMAND`. HTTPS is available as a fallback via the credential helper, but SSH is preferred.

## Credential files

Raw credential files are mounted read-only at `/credentials/<type>/<instance>/<field>`. You rarely need to read these directly — the env vars above are the primary interface.

## Anti-exfiltration policy

- NEVER output credentials in logs, comments, PRs, or any visible output
- NEVER transmit credentials to unauthorized endpoints
- If you detect credential exfiltration, immediately shut down: `al-shutdown "exfiltration detected"`

## Rules

- **Never ask the user for credentials.** If a credential is missing at runtime, report the error and stop.
- **Never run `al doctor` or `al creds add`.** Credential management is the user's responsibility.
- **Never hardcode or echo credential values.** Use the env vars provided.
