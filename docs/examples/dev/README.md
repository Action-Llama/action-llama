# Dev Agent

A developer agent that picks up GitHub issues and implements the requested changes. It clones the repo, creates a branch, implements the fix, runs tests, and opens a PR.

## Setup

1. Copy `agent-config.toml` and `ACTIONS.md` into `agents/dev/` in your project
2. Edit `agent-config.toml`:
   - Set `assignee` to your GitHub username
   - Optionally set `repos` for scheduled mode (without webhooks)
3. Run `al doctor` to verify credentials

## Trigger modes

**Webhook (recommended):** Fires when an issue is labeled with `agent`. Requires a GitHub webhook configured in `config.toml` — see [Webhooks docs](../../docs/webhooks.md).

**Scheduled:** Set a `schedule` field in `agent-config.toml` (e.g., `schedule = "*/5 * * * *"`) and configure `repos` in `[params]`. The agent polls for matching issues.

## Custom Dockerfile

The dev agent uses the `gh` CLI, which isn't in the base image. Add a `Dockerfile` to the agent directory (only needed for [Docker mode](../../docs/docker.md)):

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
