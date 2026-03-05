# Example: Reviewer Agent

A code review agent that reviews open pull requests, approves good ones, and requests changes on problematic ones.

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
```

## `AGENTS.md`

See [reviewer-AGENTS.md](reviewer-AGENTS.md) for the complete system prompt to copy into your agent directory.
