# Example: Dev Agent

A developer agent that picks up GitHub issues and implements the requested changes.

## `agent-config.toml`

```toml
credentials = ["anthropic-key", "github-token"]
repos = ["acme/app"]
schedule = "*/5 * * * *"

[model]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
thinkingLevel = "medium"
authType = "api_key"

[[webhooks.filters]]
source = "github"
repos = ["acme/app"]
events = ["issues"]
actions = ["labeled"]
labels = ["agent"]

[params]
triggerLabel = "agent"
assignee = "your-github-username"
```

## `AGENTS.md`

See [dev-AGENTS.md](dev-AGENTS.md) for the complete system prompt to copy into your agent directory.
