# Creating Agents

This guide walks you through creating an Action Llama agent from scratch.

## Prerequisites

- An Action Llama project (created with `al new <name>`)
- Credentials configured in `~/.action-llama-credentials/` (see [Credentials](credentials.md))

## Steps

### 1. Create the agent directory

Inside your project directory, create a folder for your agent:

```bash
mkdir my-agent
```

### 2. Write `agent-config.toml`

Create `my-agent/agent-config.toml`:

```toml
credentials = ["github_token:default", "git_ssh:default"]
schedule = "*/5 * * * *"

[params]
repos = ["your-org/your-repo"]

[model]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
thinkingLevel = "medium"
authType = "api_key"
```

Supported providers: `anthropic`, `openai`, `groq`, `google`, `xai`, `mistral`, `openrouter`, `custom`. See [agent-config.toml Reference](agent-config-reference.md) for all available fields and provider examples.

### 3. Write `ACTIONS.md`

Create `my-agent/ACTIONS.md` — this is the system prompt that defines your agent's behavior:

```markdown
# My Agent

You are an automation agent. Your job is to ...

Your configuration is in the `<agent-config>` block at the start of your prompt.

`GITHUB_TOKEN` is already set in your environment. Use `gh` CLI and `git` directly.

## Workflow

1. **Step one** — ...
2. **Step two** — ...

## Rules

- ...
```

The ACTIONS.md is injected as the agent's system prompt at runtime. Write it as instructions to the LLM.

### 4. Verify with `al status`

```bash
al status -p .
```

This should show your agent with its schedule and credentials.

### 5. Run with `al start`

```bash
al start -p .
```

Your agent will run on its configured schedule and/or respond to webhooks.

### 6. (Optional) Customize the project Dockerfile

Every project has a `Dockerfile` at the root (created by `al new`) that defines the shared base image for all agents. If your agents need extra system packages, edit it:

```dockerfile
FROM al-agent:latest

# Shared tools for all agents
RUN apk add --no-cache github-cli python3
```

If only one specific agent needs extra tools, add a `Dockerfile` to that agent's directory instead:

```dockerfile
FROM al-agent:latest
USER root
RUN apt-get update && apt-get install -y --no-install-recommends gh && rm -rf /var/lib/apt/lists/*
USER node
```

See [Docker docs](docker.md) for the full reference.

### 7. (Cloud only) Re-run `al doctor -c`

If you're running agents on cloud infrastructure, re-run `al doctor -c` after adding a new agent. This creates the per-agent IAM resources (service account for Cloud Run, task role for ECS) and grants the new agent access to its declared secrets.

```bash
al doctor -c -p .
```

Without this step, the new agent will fail to access its credentials at runtime.

## Tips

- Agent name is derived from the directory name — no need to put it in the config
- Use `al-rerun` in your ACTIONS.md to tell the agent to run `al-rerun` when it did work and there may be more in the backlog
- Params in the config are injected into the agent prompt as an `<agent-config>` XML block
- See [Examples](examples/dev-agent.md) for complete working agents
