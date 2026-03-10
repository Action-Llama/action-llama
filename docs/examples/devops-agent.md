# Example: DevOps Agent

A DevOps monitoring agent that detects errors from CI/CD failures and Sentry, then files GitHub issues.

## `agent-config.toml`

```toml
credentials = ["github_token:default", "git_ssh:default", "sentry_token:default"]
schedule = "*/15 * * * *"

[model]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
thinkingLevel = "medium"
authType = "api_key"

[params]
repos = ["acme/app"]
sentryOrg = "acme"
sentryProjects = ["web-app", "api"]
```

## `ACTIONS.md`

See [devops-ACTIONS.md](devops-ACTIONS.md) for the complete system prompt to copy into your agent directory.
