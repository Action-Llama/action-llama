# Docker Mode

Docker mode runs each agent in an isolated container. It is enabled by default — disable it with `--no-docker` for development, or set `local.enabled = false` in `config.toml`.

## How it works

When `al start` runs in Docker mode:

1. The base image (`al-agent:latest`) is built from `docker/Dockerfile` on first run
2. Per-agent images are built for any agent that has a custom `Dockerfile`
3. Each agent run launches a fresh container with:
   - Read-only root filesystem
   - Credentials mounted read-only at `/credentials/`
   - Writable tmpfs at `/tmp` (2GB)
   - All capabilities dropped, no-new-privileges
   - PID, memory, and CPU limits
   - Non-root user (uid 1000)
   - A unique shutdown secret for the anti-exfiltration kill switch

## Container runtime

Each agent run is a short-lived container that boots, runs a single LLM session, and exits. The entry point is `node /app/dist/agents/container-entry.js`.

### Environment

The container receives everything it needs via environment variables and mounts:

| Env var | Description |
|---------|-------------|
| `AGENT_CONFIG` | JSON-serialized agent config (model, credentials, params) plus `ACTIONS.md` content |
| `PROMPT` | The fully assembled prompt (`<agent-config>` + `<credential-context>` + trigger text) |
| `TIMEOUT_SECONDS` | Max runtime in seconds (default: 3600). The container self-terminates if exceeded |
| `GATEWAY_URL` | HTTP URL of the host gateway (local Docker only — used for credential fetch and shutdown) |
| `SHUTDOWN_SECRET` | Unique per-run secret for the anti-exfiltration kill switch (local Docker only) |

Credentials are injected in one of three ways depending on the runtime:

| Runtime | Strategy | How it works |
|---------|----------|--------------|
| Local Docker | Volume mount | Files staged to a temp dir, mounted read-only at `/credentials/<type>/<instance>/<field>` |
| Cloud Run | Gateway fetch | Container fetches credentials from `GATEWAY_URL/credentials/<secret>` on startup |
| ECS Fargate | Env vars | Secrets Manager values injected as `AL_SECRET_<type>__<instance>__<field>` env vars |

The container tries each strategy in order: volume mount, env vars, gateway. The first one that has data wins.

### Startup sequence

1. **Set working directory** — `chdir("/tmp")`
2. **Start self-termination timer** — kills the process with exit code 124 if `TIMEOUT_SECONDS` is exceeded
3. **Parse config** — reads `AGENT_CONFIG`, extracts `ACTIONS.md` content
4. **Load credentials** — from volume, env vars, or gateway (see table above)
5. **Inject env vars from credentials:**
   - `GITHUB_TOKEN` / `GH_TOKEN` from `github_token` credential
   - `SENTRY_AUTH_TOKEN` from `sentry_token` credential
   - `GIT_SSH_COMMAND` pointing to the mounted SSH key from `git_ssh` credential
   - `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` / `GIT_COMMITTER_NAME` / `GIT_COMMITTER_EMAIL` from `git_ssh` credential
   - Git HTTPS credential helper configured if `GITHUB_TOKEN` is set
6. **Create pi-coding-agent session** — initializes the LLM model, tools, and settings
7. **Send prompt** — delivers the pre-built prompt to the session

### Agent session

The prompt is sent to the LLM with rate-limit retry (up to 5 attempts with exponential backoff, 30s to 5min). The LLM runs autonomously — reading files, executing commands, making API calls — until it finishes or hits an error.

**Unrecoverable error detection:** The container watches for repeated auth/permission failures (e.g. "bad credentials", "permission denied", "resource not accessible by personal access token"). After 3 such errors, it aborts early rather than burning through retries.

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success — agent completed its work |
| 1 | Error — missing config, credential failure, unrecoverable errors, or uncaught exception |
| 124 | Timeout — `TIMEOUT_SECONDS` exceeded, container self-terminated |

### Log protocol

The container communicates with the scheduler via structured JSON lines on stdout. This is how the scheduler tracks progress, surfaces errors in the TUI, and writes log files.

**Structured log lines** have the format:

```json
{"_log": true, "level": "info", "msg": "bash", "cmd": "git clone ...", "ts": 1234567890}
```

The `_log: true` field distinguishes structured logs from plain text output. The scheduler parses these and forwards them to the logger at the appropriate level.

| Field | Description |
|-------|-------------|
| `_log` | Always `true` — marker for structured log lines |
| `level` | `"debug"`, `"info"`, `"warn"`, or `"error"` |
| `msg` | Log message (e.g. `"bash"`, `"tool error"`, `"credentials loaded from volume"`) |
| `ts` | Unix timestamp in milliseconds |
| `...` | Additional fields vary by message (e.g. `cmd`, `tool`, `error`, `result`) |

Key log messages emitted during a run:

| Message | Level | When |
|---------|-------|------|
| `"container starting"` | info | Boot, includes `agentName` and `modelId` |
| `"credentials loaded from ..."` | info | After credential loading (`volume`, `env vars`, or `gateway`) |
| `"SSH key configured for git"` | info | After SSH key setup |
| `"creating agent session"` | info | Before LLM session creation |
| `"session created, sending prompt"` | info | Prompt delivery |
| `"bash"` | info | Every bash tool call, with `cmd` field |
| `"tool error"` | error | Failed tool call, with `tool`, `cmd`, and `result` fields |
| `"rate limited, retrying prompt"` | warn | Rate limit hit, with `attempt` and `delayMs` |
| `"run completed"` | info | Agent finished successfully |
| `"no work to do"` | info | Agent found nothing to act on |
| `"container timeout reached, self-terminating"` | error | Timeout exceeded |

**Special plain-text signals:**

| Signal | Description |
|--------|-------------|
| `[RERUN]` | The agent did work and wants to be re-run immediately to drain remaining backlog. Without this signal, the scheduler treats the run as complete and waits for the next scheduled tick. |
| `[STATUS: <text>]` | Status update shown in the TUI. Can appear anywhere in the agent's text output. Example: `[STATUS: reviewing PR #42]` |
| `[TRIGGER: <agent>]...[/TRIGGER]` | Trigger another agent with context. See below |

**Agent triggers:**

An agent can trigger another agent by emitting a `[TRIGGER]` block in its output:

```
[TRIGGER: reviewer]
I just opened PR #42 on acme/app. Please review it.
URL: https://github.com/acme/app/pull/42
Branch: agent/42
[/TRIGGER]
```

The scheduler detects this signal, looks up the target agent, and runs it with a `<agent-trigger>` block containing the source agent name and context. The target agent receives a prompt similar to a webhook trigger.

Rules:
- An agent cannot trigger itself (self-triggers are skipped)
- If the target agent is already running or doesn't exist, the trigger is skipped
- Trigger chains are allowed (agent A triggers B, B triggers C) up to a configurable depth limit (`maxTriggerDepth` in `config.toml`, default: 3)
- Triggered runs do not re-run — they respond to the single trigger event

Any stdout line that is not valid JSON with `_log: true` and does not match a special signal is treated as plain agent output (the LLM's final text response).

## Base image

The base image (`docker/Dockerfile`) includes the minimum needed for any agent:

| Package | Why |
|---------|-----|
| `node:20-slim` | Runs the container entry point and pi-coding-agent SDK |
| `git` | Clone repos, create branches, push commits |
| `curl` | API calls (Sentry, arbitrary HTTP), anti-exfiltration shutdown |
| `ca-certificates` | HTTPS for git, curl, npm |
| `openssh-client` | SSH for `GIT_SSH_COMMAND` — git clone/push over SSH |

The base image also copies the compiled Action Llama application (`dist/`) and installs its npm dependencies. The entry point is `node /app/dist/agents/container-entry.js`.

## Custom agent images

Agents that need extra tools can add a `Dockerfile` to their directory. The simplest approach is to extend the base image:

```
my-project/
  dev/
    agent-config.toml
    ACTIONS.md
    Dockerfile          <-- custom image for this agent
  reviewer/
    agent-config.toml
    ACTIONS.md
                        <-- no Dockerfile, uses base image
```

### Extending the base image

Use `FROM al-agent:latest` and add what you need. Switch to `root` to install packages, then back to `node`:

```dockerfile
FROM al-agent:latest

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    gh \
    && rm -rf /var/lib/apt/lists/*
USER node
```

This is a thin layer on top of the base — fast to build and shares most of the image.

Common additions:

```dockerfile
# GitHub CLI (for gh issue list, gh pr create, etc.)
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# Python (for agents that run Python scripts)
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip && rm -rf /var/lib/apt/lists/*

# jq (for JSON processing in bash)
RUN apt-get update && apt-get install -y --no-install-recommends jq && rm -rf /var/lib/apt/lists/*
```

### Writing a standalone Dockerfile

If you need full control, you can write a Dockerfile from scratch. It must:

1. Include Node.js 20+
2. Copy the application code from the base image or install it
3. Set `ENTRYPOINT ["node", "/app/dist/agents/container-entry.js"]`
4. Use uid 1000 (`USER node` on node images) for compatibility with the container launcher

Example standalone Dockerfile:

```dockerfile
FROM node:20-slim

# Install your tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates openssh-client gh jq python3 \
    && rm -rf /var/lib/apt/lists/*

# Copy app from the base image (avoids rebuilding from source)
COPY --from=al-agent:latest /app /app
WORKDIR /app

USER node
ENTRYPOINT ["node", "/app/dist/agents/container-entry.js"]
```

The key requirement is that `/app/dist/agents/container-entry.js` exists and can run. The entry point reads `AGENT_CONFIG`, `PROMPT`, `GATEWAY_URL`, and `SHUTDOWN_SECRET` from environment variables, and credentials from `/credentials/`.

### Build behavior

- Agent images are named `al-<agent-name>:latest` (e.g. `al-dev:latest`)
- They are rebuilt on every `al start` to pick up Dockerfile changes
- The base image is only built if it doesn't exist yet
- The build context is the Action Llama package root (not the project directory), so `COPY` paths reference the package's `dist/`, `package.json`, etc.

## Configuration

| Key | Default | Description |
|-----|---------|-------------|
| `local.enabled` | `true` | Enable Docker container isolation |
| `local.image` | `"al-agent:latest"` | Base Docker image name |
| `local.memory` | `"4g"` | Memory limit per container |
| `local.cpus` | `2` | CPU limit per container |
| `local.timeout` | `3600` | Max container runtime in seconds |

For Cloud Run configuration, see [Cloud Run docs](cloud-run.md). For ECS Fargate configuration, see [ECS docs](ecs.md).

## Container filesystem layout

| Path | Mode | Contents |
|------|------|----------|
| `/app` | read-only | Action Llama application + node_modules |
| `/credentials` | read-only | Mounted credential files (`/<type>/<instance>/<field>`) |
| `/tmp` | read-write (tmpfs, 2GB) | Agent working directory — repos, scratch files, SSH keys |

## Troubleshooting

**"Docker is not running"** — Start Docker Desktop or the Docker daemon before running `al start`.

**Base image build fails** — Run `docker build -t al-agent:latest -f docker/Dockerfile .` from the Action Llama package directory to see the full build output.

**Agent image build fails** — Check that your agent's `Dockerfile` starts with `FROM al-agent:latest` (the base must exist first) and that any `apt-get install` packages are spelled correctly.

**Container exits immediately** — Check `al logs <agent>` for the error. Common causes: missing credentials, missing `ACTIONS.md`, invalid model config.
