# Agents

An agent is a directory inside your project that contains instructions and configuration for an autonomous LLM session. Each run is self-contained: the agent wakes up (on a schedule or webhook), executes its task, and shuts down.

## Structure

```
my-agent/
  agent-config.toml    # Required — credentials, model, schedule, webhooks, params
  PLAYBOOK.md          # Required — system prompt (the agent's instructions)
  Dockerfile           # Optional — custom Docker image for this agent
```

The directory name becomes the agent name. No registration is needed — the scheduler discovers agents by scanning for directories that contain an `agent-config.toml`.

## `agent-config.toml`

Declares what the agent needs to run: which credentials to mount, which model to use, when to trigger, and any custom parameters.

```toml
credentials = ["github_token:default", "git_ssh:default"]
schedule = "*/5 * * * *"

[model]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
thinkingLevel = "medium"
authType = "api_key"

[[webhooks]]
source = "my-github"
events = ["issues"]
actions = ["labeled"]
labels = ["agent"]

[params]
repos = ["acme/app"]
triggerLabel = "agent"
```

Key points:

- **`credentials`** — list of credential refs (`"type:instance"`) the agent needs at runtime. These are mounted into the container and injected as environment variables. See [Credentials](credentials.md).
- **`schedule`** and/or **`webhooks`** — at least one trigger is required. Agents can have both.
- **`[model]`** — optional. If omitted, the agent inherits the default model from the project's `config.toml`. See [Models](models.md).
- **`[params]`** — optional key-value pairs injected into the agent's prompt as an `<agent-config>` JSON block. Use these for repo names, label names, org identifiers, or anything else your PLAYBOOK.md references.

See [agent-config.toml Reference](agent-config-reference.md) for the full field reference.

## `PLAYBOOK.md`

The system prompt that defines the agent's behavior. This is the most important file — it tells the LLM what to do, step by step.

Write it as direct instructions to the model:

```markdown
# My Agent

You are an automation agent. Your job is to ...

Your configuration is in the `<agent-config>` block at the start of your prompt.

`GITHUB_TOKEN` is already set in your environment. Use `gh` CLI and `git` directly.

## Workflow

1. **Check for work** — ...
2. **Do the work** — ...
3. **Report results** — ...

## Rules

- If there is nothing to do, respond with `[SILENT]`
- ...
```

### How it's used at runtime

The PLAYBOOK.md is set as the LLM's system prompt. The scheduler then sends a user-message prompt assembled from several blocks:

1. **`<agent-config>`** — JSON of the `[params]` table from `agent-config.toml`
2. **`<credential-context>`** — describes which environment variables and tools are available (e.g. `GITHUB_TOKEN`, `git`, `gh`, SSH config)
3. **Trigger context** (one of):
   - *Scheduled run:* "You are running on a schedule. Check for new work and act on anything you find."
   - *Manual run:* "You have been triggered manually. Check for new work and act on anything you find."
   - *Webhook:* `<webhook-trigger>` block with the full event payload (source, event, action, repo, etc.)
   - *Agent trigger:* `<agent-trigger>` block with the source agent name and context

Your PLAYBOOK.md should reference `<agent-config>` for parameter values and handle both scheduled and webhook triggers if the agent uses both.

### Special signals

The agent can emit these signals in its text output:

| Signal | Effect |
|--------|--------|
| `[SILENT]` | Tells the scheduler the agent found no work. Logged as "no work to do" and further output is skipped. |
| `[STATUS: <text>]` | Status update shown in the TUI (e.g. `[STATUS: reviewing PR #42]`). |
| `[TRIGGER: <agent>]...[/TRIGGER]` | Triggers another agent with the enclosed context. The target receives a `<agent-trigger>` prompt with the source agent name and context. Self-triggers are skipped; chains are bounded by `maxTriggerDepth`. |

## Runtime lifecycle

Each agent run is an isolated, short-lived container (or host process with `--no-docker`). Here's what happens from trigger to exit:

1. **Trigger fires** — a cron tick, webhook event, manual `al run`, or `[TRIGGER]` from another agent.
2. **Container launches** — a fresh container starts with credentials and config passed via environment variables and volume mounts.
3. **Credentials are loaded** — the entry point reads credential files from `/credentials/<type>/<instance>/<field>` (local Docker and Cloud Run) or from `AL_SECRET_*` environment variables (ECS). Key credentials are injected as env vars the LLM can use directly: `GITHUB_TOKEN`, `GH_TOKEN`, `SENTRY_AUTH_TOKEN`, `GIT_SSH_COMMAND`, git author identity, etc.
4. **LLM session starts** — the model is initialized and receives two inputs:
   - **System prompt:** the contents of `PLAYBOOK.md`
   - **User prompt:** `<agent-config>` (params JSON) + `<credential-context>` (available env vars, tools, and security policy) + trigger context (schedule, webhook payload, or agent trigger)
5. **Agent runs autonomously** — the LLM executes tools (bash, file I/O, API calls) until it finishes or hits an error. Rate-limited API calls are retried automatically (up to 5 attempts with exponential backoff).
6. **Error detection** — the container watches for repeated auth/permission failures (e.g. "bad credentials", "permission denied"). After 3 such errors, it aborts early.
7. **Signals are processed** — as the agent produces output, the scheduler scans for `[SILENT]`, `[STATUS]`, and `[TRIGGER]` signals.
8. **Container exits** — exit code 0 (success), 1 (error), or 124 (timeout). The scheduler logs the result and the container is removed.

### Timeout

Each container has a self-termination timer controlled by `local.timeout` in `config.toml` (default: 3600 seconds / 1 hour). If the timer fires, the process exits with code 124. This is a hard kill — there is no graceful shutdown.

### Reruns

When a scheduled agent completes productive work (i.e. it does not respond with `[SILENT]`), the scheduler immediately re-runs it. This continues until the agent reports `[SILENT]` (no more work), hits an error, or reaches the `maxReruns` limit (default: 10, configurable in `config.toml`). This lets an agent drain its work queue without waiting for the next cron tick.

Webhook-triggered and agent-triggered runs do not re-run — they respond to a single event.

See [Docker docs](docker.md) for the full container reference including the startup sequence, log protocol, filesystem layout, and exit codes.

## `Dockerfile` (optional)

The base Docker image includes Node.js, git, curl, and openssh. If your agent needs additional tools, add a `Dockerfile` to the agent directory:

```dockerfile
FROM al-agent:latest
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    gh jq python3 \
    && rm -rf /var/lib/apt/lists/*
USER node
```

Agents without a Dockerfile use the base image directly. The Dockerfile is only relevant in Docker mode (enabled by default) — it has no effect with `--no-docker`.

See [Docker docs](docker.md) for the full container reference including the base image contents, filesystem layout, and how to write standalone Dockerfiles.

## Examples

| Agent | Description |
|-------|-------------|
| [Dev Agent](examples/dev-agent.md) | Picks up GitHub issues and implements changes |
| [Reviewer Agent](examples/reviewer-agent.md) | Reviews and merges open pull requests |
| [DevOps Agent](examples/devops-agent.md) | Monitors CI failures and Sentry errors, files issues |

## See also

- [Creating Agents](creating-agents.md) — step-by-step setup guide
- [agent-config.toml Reference](agent-config-reference.md) — all config fields
- [Models](models.md) — supported LLM providers and model IDs
- [Credentials](credentials.md) — credential types and storage
- [Webhooks](webhooks.md) — webhook setup and filter fields
- [Docker](docker.md) — container isolation and custom images
