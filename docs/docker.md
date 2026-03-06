# Docker Mode

Docker mode runs each agent in an isolated container. It is enabled by default — disable it with `--dangerous-no-docker` for development, or set `docker.enabled = false` in `config.toml`.

## How it works

When `al start` runs in Docker mode:

1. The base image (`al-agent:latest`) is built from `docker/Dockerfile` on first run
2. Per-agent images are built for any agent that has a custom `Dockerfile`
3. Each agent run launches a fresh container with:
   - Read-only root filesystem
   - Credentials mounted read-only at `/credentials/`
   - Writable tmpfs for `/workspace`, `/tmp`, and `/home/node`
   - All capabilities dropped, no-new-privileges
   - PID, memory, and CPU limits
   - Non-root user (uid 1000)
   - A unique shutdown secret for the anti-exfiltration kill switch

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
    PLAYBOOK.md
    Dockerfile          <-- custom image for this agent
  reviewer/
    agent-config.toml
    PLAYBOOK.md
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
| `docker.enabled` | `true` | Enable Docker container isolation |
| `docker.runtime` | `"local"` | Container runtime: `"local"` (Docker), `"cloud-run"` (GCP), or `"ecs"` (AWS) |
| `docker.image` | `"al-agent:latest"` | Base Docker image name |
| `docker.memory` | `"4g"` | Memory limit per container |
| `docker.cpus` | `2` | CPU limit per container |
| `docker.timeout` | `3600` | Max container runtime in seconds |

For Cloud Run configuration, see [Cloud Run docs](cloud-run.md). For ECS Fargate configuration, see [ECS docs](ecs.md).

## Container filesystem layout

| Path | Mode | Contents |
|------|------|----------|
| `/app` | read-only | Action Llama application + node_modules |
| `/credentials` | read-only | Mounted credential files (`/<type>/<instance>/<field>`) |
| `/workspace` | read-write (tmpfs, 2GB) | Agent working directory — repos are cloned here |
| `/tmp` | read-write (tmpfs, 512MB) | Temporary files |
| `/home/node` | read-write (tmpfs, 64MB) | User home — `.ssh/` for SSH keys |

## Troubleshooting

**"Docker is not running"** — Start Docker Desktop or the Docker daemon before running `al start`.

**Base image build fails** — Run `docker build -t al-agent:latest -f docker/Dockerfile .` from the Action Llama package directory to see the full build output.

**Agent image build fails** — Check that your agent's `Dockerfile` starts with `FROM al-agent:latest` (the base must exist first) and that any `apt-get install` packages are spelled correctly.

**Container exits immediately** — Check `al logs <agent>` for the error. Common causes: missing credentials, missing `PLAYBOOK.md`, invalid model config.
