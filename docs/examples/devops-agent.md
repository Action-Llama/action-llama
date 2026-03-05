# Example: DevOps Agent

A DevOps monitoring agent that detects errors from CI/CD failures and Sentry, then files GitHub issues.

## `agent-config.toml`

```toml
credentials = ["anthropic-key", "github-token", "sentry-token"]
repos = ["acme/app"]
schedule = "*/15 * * * *"

[model]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
thinkingLevel = "medium"
authType = "api_key"

[params]
sentryOrg = "acme"
sentryProjects = ["web-app", "api"]
```

## `AGENTS.md`

See [devops-AGENTS.md](devops-AGENTS.md) for the complete system prompt to copy into your agent directory.
