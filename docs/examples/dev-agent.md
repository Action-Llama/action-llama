# Example: Dev Agent

A developer agent that picks up GitHub issues and implements the requested changes.

## `agent-config.toml`

```toml
credentials = ["github_token:default", "git_ssh:default"]
repos = ["acme/app"]
schedule = "*/5 * * * *"

[model]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
thinkingLevel = "medium"
authType = "api_key"

[[webhooks]]
type = "github"
repos = ["acme/app"]
events = ["issues"]
actions = ["labeled"]
labels = ["agent"]

[params]
triggerLabel = "agent"
assignee = "your-github-username"
```

## `Dockerfile`

The dev agent uses the `gh` CLI, which isn't in the base image. Add a `Dockerfile` to install it (only needed for [Docker mode](../docker.md)):

```dockerfile
FROM al-agent:latest
USER root
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*
USER node
```

## `PLAYBOOK.md`

See [dev-PLAYBOOK.md](dev-PLAYBOOK.md) for the complete system prompt to copy into your agent directory.
