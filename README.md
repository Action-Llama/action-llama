<p align="center">
  <img src="action_llama.jpg" alt="Action Llama" />
</p>

# Action Llama

It's like a Lambda that runs an agent. Triggered either by cron or webhooks.  BYOM- bring your own model.

It's a very simple wrapper around whatever your favourite flavour of LLM is:

1. Either a webhook or cron wakes up the agent
2. The agent runs according the instructions in AGENTS.md you define
3. The agent shuts down

Allows you to create:

- A developer agent that watches for new Github issues and reacts
- A reviewer agent that watches for new Github Pull Requests and reviews them then merges if all ok

Have as many agents as you like. Customize the behaviour as you wish. The system is MIT licensed and fully extensible.

## How to get started

```bash
# 1. Create a new Action Llama project
npx create-action-llama my-project

# 2. Select 'dev' and enter any credentials you need
#    (stored in ~/.action-llama-credentials)

# 3. Enter the directory and start
cd my-project
al start
```

Built on [pi.dev](https://github.com/badlogic/pi-mono) as the agent harness.

## Built-in Agents

The project includes a few default agents to get you started

| Agent | Trigger | Action |
|-------|---------|--------|
| **Developer** | Webhook: issue labeled; or poll for labeled issues | Checks out a worktree, implements the fix/feature, runs tests, opens a PR |
| **PR Reviewer** | Webhook: PR opened/updated; or poll for open PRs | Reviews code for correctness, style, security; approves+merges or requests changes |
| **DevOps** | Poll for CI failures/Sentry errors | Creates Github issues describing problem and potential fix |

## Prerequisites

- Node.js >= 20
- Git
- Docker
- A GitHub Personal Access Token with `repo` and `workflow` scopes
- Anthropic auth — one of:
  - Existing pi auth (`pi /login`) or Claude Code auth (`claude setup-token`)
  - An Anthropic API key (`sk-ant-api...`)
  - An OAuth token (`sk-ant-oat...`)
- (Optional) A Sentry auth token
- (Optional) A GitHub webhook secret (for webhook-triggered agents)

## Install

```bash
npx @action-llama/action-llama init my-project
cd my-project
```

This creates a new project directory with a `package.json` (including `@action-llama/action-llama` as a dependency), agent configs, credentials, and runs `npm install` automatically.

## Quick start

```bash
# 1. Initialize a project (interactive setup)
npx @action-llama/action-llama init my-project

# 2. Start the agents
cd my-project
al start
```

## Architecture

Action Llama separates three concerns:

| Directory | Purpose | Created by |
|-----------|---------|------------|
| `~/.action-llama-credentials/` | Secrets (shared across projects) | `al init` |
| `./<project-name>/` | Per-project config, agent instructions, scratch space | `al init` |

Agents run with credentials injected directly — `GITHUB_TOKEN`, `SENTRY_AUTH_TOKEN`, etc. are set as environment variables, and credential files are available at `/credentials/` in Docker mode. Agents use standard tools (`gh` CLI, `git`, `curl`) to interact with external services.

## Setup walkthrough

The setup CLI (`al init <name>`) walks through three steps:

### Step 1: Credentials
- Paste your GitHub PAT
- (Optional) Paste your Sentry auth token
- Choose your Anthropic authentication method:
  - **Use existing pi auth** — if you already ran `pi /login` or `claude setup-token`
  - **Enter an API key** — a standard `sk-ant-api...` key, validated against the API
  - **Enter an OAuth token** — a `sk-ant-oat...` token from `claude setup-token`, format-checked

### Step 2: LLM defaults
- Select a model (default: `claude-sonnet-4-20250514`)
- Select thinking level (default: `medium`)

### Step 3: Agents
- Select which built-in agents to enable (dev, reviewer, devops) and/or add custom agents
- For each agent, configure:
  - **Name** (allows multiple instances, e.g., `dev-frontend`, `dev-backend`)
  - **Repos** to monitor
  - Type-specific options: trigger label / assignee (dev), Sentry org / projects (devops)
  - **Webhooks** — listen for GitHub events (default webhook filter per agent type)
  - **Schedule** — poll on a cron interval (optional if webhooks are enabled)
- If any agent uses webhooks, you'll be asked for a **GitHub webhook secret** (used to verify `x-hub-signature-256` on incoming payloads)

## Running

```bash
# Start all agents (host mode, default)
al start

# Check agent status
al status
```

The scheduler runs as a single Node.js process. Agents wake on incoming webhooks or their cron schedule (or both), do their work (or log `[SILENT]` if there's nothing to do), then wait for the next trigger. If any agent uses webhooks, a broker server starts automatically to receive `POST /webhooks/github` requests. Press `Ctrl+C` for graceful shutdown.

### Docker mode (opt-in)

When `docker.enabled` is set in `config.json`, agents run in isolated Docker containers with credentials mounted read-only at `/credentials/`. Containers have internet access and use standard tools (`gh`, `git`, `curl`) directly. A broker server provides a shutdown endpoint for the anti-exfiltration kill switch.

```bash
# Requires Docker installed and running
# Enable in config.json: "docker": { "enabled": true }
al start
```

See the [Docker mode](#docker-mode-1) section below for details.

### Logs

Structured JSON logs are written to daily files at `<project>/.al/logs/<agent>-<YYYY-MM-DD>.log` and also printed to stdout. In Docker mode, container logs are forwarded through the same pino logger — tool events and errors all appear in the standard log files.

## CLI commands

| Command | Description |
|---------|-------------|
| `npx @action-llama/action-llama init <name>` | Interactive setup, creates project dir + credentials |
| `al start` | Start scheduler (cron + webhooks) |
| `al status` | Show agent status |
| `al logs` | View agent logs |
| `al agent add` | Add a new agent to an existing project |

## Using the developer agent

1. Create an issue in one of your monitored repos
2. Add the trigger label (default: `agent`) and assign it to the configured user
3. The developer agent wakes (immediately via webhook, or on the next poll) and will:
   - Find the issue via `gh issue list`
   - Clone the repo and create a branch
   - Read `AGENTS.md`/`CLAUDE.md` for project conventions
   - Implement the changes, run tests
   - Push and open a PR via `gh pr create`

## Using the PR reviewer agent

The reviewer automatically picks up open PRs on each poll. It:
- Gets the diff via `gh pr diff`, checks CI status
- Reviews for correctness, style, tests, and security
- Approves and squash-merges clean PRs with green CI
- Requests changes with specific feedback on problematic PRs
- Skips PRs it has already reviewed at the same commit SHA

## Using the DevOps agent

The DevOps agent monitors for failures:
- **GitHub Actions**: finds failed workflow runs via `gh run list`
- **Sentry**: finds new unresolved error groups via `curl` to the Sentry API (if configured)

For each new error, it creates a GitHub issue with the error details and a link to the source. Errors are deduplicated by fingerprint so the same failure is never filed twice.

## Project structure

```
~/.action-llama-credentials/                  # Secrets (shared across projects)
  github-token
  sentry-token                      # (optional)
  anthropic-key                     # (optional, if not using pi_auth)
  github-webhook-secret             # (optional, for webhook-triggered agents)

./<project-name>/                   # Per-project (created by npx @action-llama/action-llama init)
  package.json                      # Includes @action-llama/action-llama as a dependency
  config.json                       # Global config: docker, broker, webhooks (no secrets)
  dev/                              # Agent directory (CWD for agent sessions)
    config.json                     # Agent config: repos, webhooks, schedule, prompt, etc.
    AGENTS.md                       # Instructions (written during init, edit to customize)
  dev-backend/                      # Multiple instances are supported
    config.json
    AGENTS.md
  reviewer/
    config.json
    AGENTS.md
  devops/
    config.json
    AGENTS.md
  node_modules/                     # Dependencies (after npm install)
  .workspace/                       # Git clones and worktrees (gitignored)
  .al/
    state/{dev,dev-backend,...}/     # Dedup/tracking state per agent
    logs/                           # Structured logs
```

## Security

### Host mode

Secrets are isolated from agent context:

1. Credential files live in `~/.action-llama-credentials/` (mode 600, directory mode 700)
2. The runner injects credentials as environment variables (`GITHUB_TOKEN`, etc.) — agents never see raw credential files
3. Agents use standard tools (`gh` CLI, `git`, `curl`) which read credentials from env vars
4. Agents have no extensions loaded (`noExtensions: true`) — only bash, read, edit, write tools for working in worktrees
5. Anti-exfiltration policy is injected into agent prompts — agents are instructed to never output credentials in logs, comments, or PRs

### Docker mode

Docker mode adds stronger isolation:

1. **Credentials mounted read-only** — credential files are symlinked into a temp staging dir and mounted at `/credentials/` (read-only)
2. **Minimal privileges** — `--read-only` root FS, `--cap-drop ALL`, `--security-opt no-new-privileges`, non-root user, PID/memory/CPU limits
3. **Kill switch** — each container gets a unique shutdown secret; if exfiltration is detected, the agent calls `POST /shutdown` to immediately kill the container
4. **Tmpfs workspace** — all writable space is tmpfs (`/workspace`, `/tmp`), nothing persists after container exit
5. **Standard tooling** — containers include `gh` CLI, `git`, and `curl`; no custom proxy or command routing

## Configuration

Config is split between a global `config.json` and per-agent `config.json` files.

**`<project>/config.json`** — global settings (Docker, broker, webhooks):

```json
{
  "docker": { "enabled": false },
  "broker": { "port": 8080 },
  "webhooks": { "githubSecretCredential": "github-webhook-secret" }
}
```

**`<project>/<agent>/config.json`** — per-agent (includes model):

```json
{
  "credentials": ["github-token", "anthropic-key"],
  "model": { "provider": "anthropic", "model": "claude-sonnet-4-20250514", "thinkingLevel": "medium", "authType": "pi_auth" },
  "prompt": "An issue was just assigned to you. Implement the changes described in the issue.",
  "repos": ["acme/frontend"],
  "triggerLabel": "agent",
  "assignee": "bot-user",
  "webhooks": {
    "filters": [{
      "source": "github",
      "repos": ["acme/frontend"],
      "events": ["issues"],
      "actions": ["labeled"],
      "labels": ["agent"],
      "assignee": "bot-user"
    }]
  }
}
```

Agents can use webhooks, a cron schedule, or both. Add a `"schedule"` field (e.g., `"*/5 * * * *"`) for polling. Each agent carries its own model config, so you can run different agents on different models (e.g., Opus for dev, Haiku for devops).

Edit these files directly to change triggers, add repos, or switch models. Re-run `al init` for a guided reconfiguration.

### Docker config options

| Key | Default | Description |
|-----|---------|-------------|
| `docker.enabled` | `false` | Enable Docker container mode |
| `docker.image` | `"al-agent:latest"` | Docker image for agent containers |
| `docker.memory` | `"4g"` | Memory limit per container |
| `docker.cpus` | `2` | CPU limit per container |
| `docker.timeout` | `3600` | Max container runtime in seconds |
| `broker.port` | `8080` | Broker server listen port |
| `webhooks.githubSecretCredential` | `"github-webhook-secret"` | Credential name for the GitHub webhook HMAC secret |

## Webhooks

Agents can be triggered by GitHub webhooks for real-time responses instead of (or in addition to) polling. The setup wizard configures default webhook filters per agent type:

| Agent | Default filter |
|-------|---------------|
| **Developer** | `issues` event, `labeled` action, matching trigger label + assignee |
| **PR Reviewer** | `pull_request` event, `opened` / `synchronize` actions |
| **DevOps** | `workflow_run` event, `completed` action |

### Setting up the GitHub webhook

1. Run `al init` and enable webhooks for your agents — the wizard will ask for a webhook secret
2. In your GitHub repo (or org) settings, add a webhook:
   - **Payload URL**: `http://<your-host>:8080/webhooks/github`
   - **Content type**: `application/json`
   - **Secret**: the same secret you entered during `al init`
   - **Events**: select the events your agents listen for (or "Send me everything")
3. Start AL — the broker server listens for incoming webhooks automatically

Webhook payloads are validated using HMAC-SHA256 (`x-hub-signature-256`). If the signature doesn't match, the request is rejected with 401.

### Webhook filter options

Filters are configured in `<agent>/config.json` under `webhooks.filters`. Each filter can match on:

| Field | Type | Description |
|-------|------|-------------|
| `source` | `"github"` | Required — the webhook source |
| `repos` | `string[]` | Only match events from these repos |
| `events` | `string[]` | GitHub event types (`issues`, `pull_request`, `push`, etc.) |
| `actions` | `string[]` | Event actions (`opened`, `labeled`, `synchronize`, etc.) |
| `labels` | `string[]` | Match if the issue/PR has any of these labels |
| `assignee` | `string` | Match if assigned to this user |
| `author` | `string` | Match if authored by this user |
| `branches` | `string[]` | Match if targeting one of these branches |

All specified fields must match (AND logic). Omitted fields are not checked.

## Customizing agent behavior

Each agent has an `AGENTS.md` file written during `al init`. Edit `<project>/<agent>/AGENTS.md` to customize agent behavior — changes take effect on the next run.

Agent config values (repos, trigger label, etc.) are automatically injected into the prompt as an `<agent-config>` block, so AGENTS.md can reference them without hardcoding. When triggered by a webhook, a `<webhook-trigger>` block is also injected with event details (issue title, PR number, labels, etc.).

## Testing

Tests use [Vitest](https://vitest.dev/) with globals enabled and V8 coverage.

```bash
# Run all tests once
npm test

# Watch mode (re-runs on file changes)
npm run test:watch

# Run with coverage report
npm run test:coverage
```

Test files live in `test/` mirroring the `src/` layout:

```
test/
  helpers.ts                        # Shared test utilities
  shared/                           # Unit tests for shared modules
  agents/                           # Agent runner, prompt builder, default agent tests
  setup/                            # Setup validators + scaffolding tests
  scheduler/                        # Scheduler, webhook integration tests
  webhooks/                         # Webhook registry + GitHub provider tests
```

Coverage is collected for all `src/**/*.ts` files, excluding entry points (`cli/main.ts`), interactive prompts (`setup/prompts.ts`), and pure type definitions (`scheduler/types.ts`).

## Docker mode

Docker mode runs each agent session in an isolated container. Credentials are mounted read-only at `/credentials/`, and the container has internet access to use standard tools directly.

```
HOST                                         DOCKER (al-net)
┌──────────────────────────────────┐         ┌──────────────────────────────┐
│  Scheduler                      │         │  Agent Container (per run)   │
│    generates shutdown secret    │         │    pi-coding-agent session   │
│    stages credentials           │         │    coding tools (bash,r/w)   │
│    launches container           │         │    gh, git, curl             │
│    waits for exit               │         │                              │
│                                 │         │  /credentials/ (read-only)   │
│  Broker (in-process)            │◄────────│    anthropic-key             │
│    ● Health endpoint            │  HTTP   │    github-token              │
│    ● Shutdown kill switch       │         │    sentry-token (optional)   │
│    ● Webhook receiver           │         │                              │
│                                 │         │  /workspace/ (tmpfs)         │
│  Credentials (~/.al-creds/)     │         │  Internet access: yes        │
│  Workspace (project/.workspace/)│         └──────────────────────────────┘
└──────────────────────────────────┘
```

### Prerequisites

- Docker installed and running
- Set `"docker": { "enabled": true }` in `config.json`

The agent Docker image is built automatically on first run from `docker/Dockerfile`.

## Publishing to npm

The package is configured for standard npm publishing under the `@action-llama` scope.

### Prerequisites

1. An [npm account](https://www.npmjs.com/signup) with access to the `@action-llama` org
2. Login to npm:
   ```bash
   npm login
   ```

### Version and publish

Use `npm version` to bump the version (updates `package.json`, creates a git tag, and pushes):

```bash
# Patch release (0.1.0 → 0.1.1)
npm version patch

# Minor release (0.1.0 → 0.2.0)
npm version minor

# Major release (0.1.0 → 1.0.0)
npm version major
```

Then publish:

```bash
npm publish --access public --tag latest
```

The `prepublishOnly` script automatically runs the build and tests before publishing. If either fails, the publish is aborted.

### First-time publish

For the very first publish of a scoped package:

```bash
npm publish --access public
```

The `--access public` flag is required for scoped packages on the first publish (subsequent publishes remember the setting).

### What gets published

Only these files are included in the npm tarball (controlled by the `files` field in `package.json`):

- `dist/` — compiled JavaScript, source maps, and type declarations
- `docker/` — Dockerfile for container mode
- `README.md`
- `LICENSE`
- `package.json` (always included by npm)

### Build scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to `dist/` and copy agent definition assets |
| `npm run clean` | Remove the `dist/` directory |
| `npm test` | Run all tests |
| `npm version <patch\|minor\|major>` | Bump version, tag, and push |

## License

MIT
