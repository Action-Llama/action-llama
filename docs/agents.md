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

### Language skills

Before the PLAYBOOK.md runs, the agent receives a preamble that teaches it a set of **language skills** — shorthand operations the playbook can reference naturally. The preamble explains the underlying mechanics (curl commands, env vars) so playbook authors never need to think about them.

Skills currently taught to agents:

| Category | Skills | Description |
|----------|--------|-------------|
| **Signals** | `[SILENT]`, `[STATUS: ...]`, `[TRIGGER: ...]` | Text-based signals the agent emits in its output. See [Signals](#signals). |
| **Locks** | `LOCK(...)`, `UNLOCK(...)`, `HEARTBEAT(...)` | Resource locking for parallel coordination. See [Resource locks](#resource-locks). |
| **Credentials** | `GITHUB_TOKEN`, `gh`, `git`, etc. | Credential access and tool usage. See [Credentials](credentials.md). |

Playbook authors write the shorthand naturally (e.g. `LOCK("github issue acme/app#42")`). The agent learns what it means from the preamble — no need to document curl commands or API endpoints in your playbook.

### Signals

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
8. **Container exits** — exit code 0 (success), 1 (error), or 124 (timeout). Any held locks are released automatically. The scheduler logs the result and the container is removed.

### Timeout

Each container has a self-termination timer controlled by `local.timeout` in `config.toml` (default: 3600 seconds / 1 hour). If the timer fires, the process exits with code 124. This is a hard kill — there is no graceful shutdown.

### Reruns

When a scheduled agent completes productive work (i.e. it does not respond with `[SILENT]`), the scheduler immediately re-runs it. This continues until the agent reports `[SILENT]` (no more work), hits an error, or reaches the `maxReruns` limit (default: 10, configurable in `config.toml`). This lets an agent drain its work queue without waiting for the next cron tick.

Webhook-triggered and agent-triggered runs do not re-run — they respond to a single event.

See [Docker docs](docker.md) for the full container reference including the startup sequence, log protocol, filesystem layout, and exit codes.

## Resource locks

When you set `scale > 1` on an agent, multiple instances run concurrently. Without coordination, two instances might pick up the same GitHub issue, review the same PR, or deploy the same service at the same time. Resource locks prevent this.

Locks are managed by the scheduler and available to all agents running in Docker mode. Each lock is identified by a **resource key** — for example, `LOCK("github issue acme/app#42")`.

### How it works

1. Before working on a shared resource, the agent calls `LOCK("resource key")`.
2. If the lock is free, the agent gets it and proceeds.
3. If another instance already holds the lock, the agent gets back the holder's name and skips that resource.
4. When done, the agent calls `UNLOCK("resource key")`.

The agent learns the lock API from a preamble injected before the playbook runs. Playbook authors just write the shorthand — no need to think about HTTP endpoints or authentication.

### Operations

| Operation | Description |
|-----------|-------------|
| `LOCK(resourceKey)` | Acquire an exclusive lock on a resource. Fails if another instance holds it. |
| `UNLOCK(resourceKey)` | Release a lock. Only the holder can release. |
| `HEARTBEAT(resourceKey)` | Reset the TTL on a held lock. Use during long-running work to prevent expiry. |

### One lock at a time

Each agent instance can hold **at most one lock**. This keeps the model simple — the agent locks a resource, does the work, unlocks, then moves to the next item. If it tries to acquire a second lock without releasing the first, the request is rejected with a clear error message.

### Timeout (TTL)

Locks expire automatically after **30 minutes** by default. This prevents deadlocks if an agent crashes or hangs without releasing its lock. The timeout is configurable via `gateway.lockTimeout` in `config.toml` (value in seconds).

For work that takes longer than the timeout, use `HEARTBEAT` to extend the TTL. Each heartbeat resets the clock to another full TTL period. If the agent forgets to heartbeat and the lock expires, another instance can claim it.

### Authentication

Each container gets a unique per-run secret (the same one used for the shutdown API). Lock requests are authenticated with this secret, so only the container that acquired a lock can release or heartbeat it. There is no way for one agent instance to release another's lock — it must wait for the TTL to expire.

### Auto-release on exit

When a container exits — whether it finishes successfully, hits an error, or times out — all of its locks are released automatically by the scheduler. You don't need to worry about cleanup in error paths.

### Example playbook usage

```markdown
## Workflow

1. List open issues labeled "agent" in repos from `<agent-config>`
2. For each issue:
   - LOCK("github issue owner/repo#123")
   - If the lock fails, skip this issue — another instance is handling it
   - Clone the repo, create a branch, implement the fix
   - Open a PR and link it to the issue
   - UNLOCK("github issue owner/repo#123")
3. If there are no issues to work on, respond with [SILENT]
```

### Resource key conventions

Use descriptive, unique keys:

| Resource key | Example |
|-------------|---------|
| `github issue owner/repo#number` | `LOCK("github issue acme/app#42")` |
| `github pr owner/repo#number` | `LOCK("github pr acme/app#17")` |
| `deploy service-name` | `LOCK("deploy api-prod")` |

### Configuration

| Setting | Location | Default | Description |
|---------|----------|---------|-------------|
| `gateway.lockTimeout` | `config.toml` | `1800` (30 min) | Default TTL for locks in seconds |

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
