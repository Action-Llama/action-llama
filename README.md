<p align="center">
  <img src="action_llama.jpg" alt="Action Llama" />
</p>

# Action Llama

Run agents like scripts: triggered by cron or webhooks.

Dev Experience:

1. Either a webhook or cron wakes up the agent
2. The agent runs according to the instructions in PLAYBOOK.md you define
3. The agent shuts down

Key features:

- Agent runs are contained in a Docker container using only the credentials they need. Credentials are stored separately.
- Define your agents in a git repo, add custom ones, and share them.
- BYOM: bring your own model.

Philosophy:

- AL is a thin wrapper around Claude or GPT. The models move so quickly, it's important to minimize the harness.

Use cases:

- A developer agent that watches for new Github issues and reacts
- A reviewer agent that watches for new Github Pull Requests and reviews them then merges if all ok

Have as many agents as you like. Customize the behaviour as you wish. The system is MIT licensed and fully extensible.

Built on [pi.dev](https://github.com/badlogic/pi-mono) as the agent harness.

## How to get started

### 1. Create a project

```bash
npx @action-llama/action-llama@latest new my-project
cd my-project
```

This scaffolds the project and sets up your Anthropic credential and default model.

### 2. Create and manage agents

```bash
npx al console
```

The console is a TUI powered by [Pi](https://github.com/badlogic/pi-mono) that helps you create and manage agents. If no agents exist yet, it will offer to create one for you.

You can also create agents manually — see the [creating agents guide](docs/creating-agents.md).

Or, if you're using your own coding agent just make sure it reads the AGENTS.md in your project root. It contains everything needed to create agents (including a complete example playbook).

### 3. Run

Once your agents are ready, run the gateway!

```bash
npx al start
```

If any credentials are missing, it will prompt you for them. Credentials are stored in `~/.action-llama-credentials/` (shared across projects, not committed to git).

If you want to set up credentials without starting the gateway:

```bash
npx al setup
```

### Project structure

```
my-project/
  package.json              # Includes @action-llama/action-llama as a dependency
  AGENTS.md                 # Project overview, credential/webhook reference, example playbook
  config.json               # Global config: docker, gateway, webhooks (no secrets)
  dev/                      # One directory per agent
    agent-config.toml       # Agent config: credentials, repos, model, schedule, webhooks, params
    PLAYBOOK.md             # Agent instructions (system prompt) — edit to customize behavior
```

## CLI commands

If you installed globally (`npm install -g @action-llama/action-llama`), you can use `al` directly. Otherwise, prefix commands with `npx` (e.g., `npx al start`).

| Command | Description |
|---------|-------------|
| `al new <name>` | Scaffold a new project (sets up Anthropic credential and model defaults) |
| `al console` | TUI for creating and managing agents |
| `al setup` | Scan agents and prompt for any missing credentials |
| `al start` | Start the scheduler — runs agents on their cron schedule and/or webhook triggers |
| `al status` | Show the current status of all agents |
| `al logs <agent>` | View log entries for an agent |

### Common options

- `-p, --project <dir>` — specify the project directory (defaults to `.`)

### `al logs` options

- `-n, --lines <N>` — number of log entries to show (default: 50)
- `-f, --follow` — tail mode, watch for new log entries
- `-d, --date <YYYY-MM-DD>` — view a specific date's log file

### `al start` options

- `--dangerous-no-docker` — disable Docker container isolation and run agents directly on the host

## Configuration

### Global config (`config.json`)

```json
{
  "docker": { "enabled": false },
  "gateway": { "port": 8080 },
  "webhooks": { "secretCredentials": { "github": "github-webhook-secret" } }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `docker.enabled` | `false` | Run agents in isolated Docker containers |
| `docker.image` | `"al-agent:latest"` | Docker image for containers |
| `docker.memory` | `"4g"` | Memory limit per container |
| `docker.cpus` | `2` | CPU limit per container |
| `docker.timeout` | `3600` | Max container runtime (seconds) |
| `gateway.port` | `8080` | Gateway server listen port |

### Agent config (`<agent>/agent-config.toml`)

See the [agent-config.toml reference](docs/agent-config-reference.md) for all fields. Each agent carries its own model config, so you can run different models per agent (e.g., Opus for dev, Haiku for devops).

### Webhooks

To use webhooks instead of polling, add webhook filters to your `agent-config.toml` and add a webhook in your GitHub repo settings:

- **Payload URL**: `http://<your-host>:8080/webhooks/github`
- **Content type**: `application/json`
- **Secret**: the same secret you entered during setup

Payloads are validated with HMAC-SHA256 (`x-hub-signature-256`). Webhook filters in `webhooks.filters` support matching on `source`, `repos`, `events`, `actions`, `labels`, `assignee`, `author`, and `branches` (AND logic; omitted fields are not checked).

#### Local development with ngrok

If you're developing locally and need GitHub to reach your machine, use [ngrok](https://ngrok.com) to create a public tunnel:

```bash
# Install ngrok (macOS)
brew install ngrok

# Start a tunnel pointing at the Action Llama gateway port
ngrok http 8080
```

ngrok will print a forwarding URL like `https://a1b2c3d4.ngrok-free.app`. Use that as your GitHub webhook Payload URL:

```
https://a1b2c3d4.ngrok-free.app/webhooks/github
```

Keep the ngrok process running alongside `al start`. The tunnel stays active until you stop it. For a stable URL across restarts, sign up for a free ngrok account and use a static domain:

```bash
ngrok http 8080 --url=your-name.ngrok-free.app
```

### Docker mode

Set `"docker": { "enabled": true }` in `config.json`. Agents run in isolated containers with credentials mounted read-only at `/credentials/`, a read-only root FS, dropped capabilities, non-root user, and PID/memory/CPU limits. Each container gets a unique shutdown secret for the anti-exfiltration kill switch. The Docker image is built automatically on first run from `docker/Dockerfile`.

## Developing

### Prerequisites

- Node.js >= 20, Git, Docker
- GitHub PAT with `repo` + `workflow` scopes
- Anthropic auth (pi auth, API key, or OAuth token)

### Setup

```bash
git clone <repo>
cd action-llama
npm install
npm run build
npm test
```

### How it works

`al start` runs a single Node.js process (the **scheduler**) that:

1. Discovers agents in the project directory (each subdirectory with an `agent-config.toml`)
2. Starts a **gateway** HTTP server if webhooks or Docker mode are enabled (health check, webhook receiver, shutdown kill switch)
3. Creates a **runner** per agent — either `AgentRunner` (host mode) or `ContainerAgentRunner` (Docker mode)
4. Wires up **cron jobs** and/or **webhook bindings** to trigger each runner
5. On trigger, the runner builds a prompt (injecting `<agent-config>` and optionally `<webhook-trigger>` blocks), starts a [pi-coding-agent](https://github.com/badlogic/pi-mono) session, and streams output to the logger

### Source layout

```
src/
  cli/              # Command definitions (new, setup, start, status, logs)
  setup/            # Project scaffolding
  scheduler/        # Scheduler: discovers agents, starts gateway, wires cron + webhooks
  agents/           # Agent runners (host + Docker), prompt builder
  gateway/          # HTTP server: router, health, shutdown, webhook routes
  docker/           # Container lifecycle (launch, wait, logs, remove), image + network
  webhooks/         # Webhook registry, provider interface, GitHub provider
  tui/              # Ink-based terminal UI (App.tsx, status tracker)
  shared/           # Config loader, credentials, logger, paths, git helpers
```

### Extension points

- **New agent** — create a directory with an `agent-config.toml` and `PLAYBOOK.md` in your project. See [creating agents](docs/creating-agents.md).
- **New webhook provider** — implement the `WebhookProvider` interface in `src/webhooks/providers/` and register it in `src/scheduler/index.ts`. The registry handles routing by `source` field.
- **Custom runner** — subclass or replace `AgentRunner` in `src/agents/runner.ts` to change how agent sessions are created (different model providers, tool sets, etc.).
- **Gateway routes** — add routes in `src/gateway/routes/` and register them in `src/gateway/index.ts`.

### Tests

```bash
npm test              # run all 175 tests
npm run test:watch    # watch mode
npm run test:coverage # V8 coverage report
```

Tests live in `test/` mirroring `src/`. Coverage excludes entry points (`cli/main.ts`), interactive prompts (`setup/prompts.ts`), and type-only files.

### Publishing

```bash
npm login                            # need @action-llama org access
npm version patch                    # or minor / major — bumps, tags, pushes
npm publish --access public          # build + tests run automatically via prepublishOnly
```

Published tarball includes `dist/`, `docker/`, `README.md`, `LICENSE`, and `package.json`.

## License

MIT
