# Example: Reviewer Agent

A code review agent that reviews open pull requests, approves good ones, and requests changes on problematic ones.

## `agent-config.toml`

```toml
credentials = ["github_token:default", "git_ssh:default"]
schedule = "*/5 * * * *"

[params]
repos = ["acme/app"]

[model]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
thinkingLevel = "medium"
authType = "api_key"
```

## `ACTIONS.md`

See [reviewer-ACTIONS.md](reviewer-ACTIONS.md) for the complete system prompt to copy into your agent directory.
