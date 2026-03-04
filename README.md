<p align="center">
  <img src="action_llama.jpg" alt="Action Llama" />
</p>

# Action Llama

Run agents like scripts: triggered by cron or webhooks.

Dev Experience:

1. Either a webhook or cron wakes up the agent
2. The agent runs according the instructions in AGENTS.md you define
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

```bash
npx @action-llama/action-llama@latest new my-project
```

The setup wizard walks you through everything:

**Step 1 — Agents:** Select which agents to create. Pick **dev** to start — this is the developer agent that implements issues and opens PRs.

**Step 2 — Credentials:** Paste your GitHub PAT (needs `repo` + `workflow` scopes) and choose how to authenticate with Anthropic (existing pi auth, API key, or OAuth token). Tokens are validated against their APIs before continuing.

**Step 3 — LLM Defaults:** Pick a model and thinking level. The defaults (`claude-sonnet-4-20250514`, `medium` thinking) are a good starting point.

**Step 4 — Configure each agent:** For the dev agent you'll be asked:
- **Repos** — which GitHub repos to monitor (fetched from your token)
- **Trigger label** — the issue label that activates the agent (default: `agent`)
- **Assignee** — only trigger on issues assigned to this user (default: your GitHub username)
- **Webhooks** — say **no** for now (requires setting up a GitHub webhook endpoint)
- **Schedule** — say **yes**, and accept the default `*/5 * * * *` (poll every 5 minutes)

Once setup finishes:

```bash
cd my-project
npx al start    # if using local install
```

The dev agent will poll every 5 minutes looking for issues that match its filter: the issue must have the trigger label (default: `agent`) **and** be assigned to the configured user. When it finds a match, it clones the repo, creates a branch, implements the changes described in the issue, runs tests, and opens a PR.

Edit `dev/AGENTS.md` to customize how the agent works — changes take effect on the next run.

### Project structure

The setup creates:

```
my-project/
  package.json              # Includes @action-llama/action-llama as a dependency
  config.json               # Global config: docker, gateway, webhooks (no secrets)
  dev/                      # One directory per agent
    config.json             # Agent config: repos, schedule, model, webhooks, etc.
    AGENTS.md               # Agent instructions — edit this to customize behavior
```

Credentials are stored separately in `~/.action-llama-credentials/` (shared across projects, not committed to git).

## CLI commands

If you installed globally (`npm install -g @action-llama/action-llama`), you can use `al` directly. Otherwise, prefix commands with `npx` (e.g., `npx al start`).

| Command | Description |
|---------|-------------|
| `al new <name>` | Create a new project (interactive setup for credentials, model, and agents) |
| `al start` | Start the scheduler — runs agents on their cron schedule and/or webhook triggers |
| `al status` | Show the current status of all agents |
| `al logs <agent>` | View log entries for an agent |
| `al agent add [definition]` | Add a new agent to an existing project (built-in name or custom definition path) |

### Common options

- `-p, --project <dir>` — specify the project directory (defaults to `.`)

### `al logs` options

- `-n, --lines <N>` — number of log entries to show (default: 50)
- `-f, --follow` — tail mode, watch for new log entries
- `-d, --date <YYYY-MM-DD>` — view a specific date's log file

### `al start` options

- `--dangerous-no-docker` — disable Docker container isolation and run agents directly on the host

## Built-in Agents

| Agent | Trigger | Action |
|-------|---------|--------|
| **Developer** | Webhook: issue labeled; or poll for labeled issues | Checks out a worktree, implements the fix/feature, runs tests, opens a PR |
| **PR Reviewer** | Webhook: PR opened/updated; or poll for open PRs | Reviews code for correctness, style, security; approves+merges or requests changes |
| **DevOps** | Poll for CI failures/Sentry errors | Creates Github issues describing problem and potential fix |

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

### Agent config (`<agent>/config.json`)

```json
{
  "credentials": ["github-token", "anthropic-key"],
  "model": { "provider": "anthropic", "model": "claude-sonnet-4-20250514", "thinkingLevel": "medium", "authType": "pi_auth" },
  "repos": ["acme/frontend"],
  "schedule": "*/5 * * * *",
  "webhooks": {
    "filters": [{
      "source": "github",
      "events": ["issues"],
      "actions": ["labeled"],
      "labels": ["agent"],
      "assignee": "bot-user"
    }]
  }
}
```

Agents can use webhooks, a cron schedule, or both. Each agent carries its own model config, so you can run different models per agent (e.g., Opus for dev, Haiku for devops). Edit these files directly or re-run `al new` for guided reconfiguration.

### Webhooks

To use webhooks instead of polling, enable them during `al new` and add a webhook in your GitHub repo settings:

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

1. Discovers agents in the project directory (each subdirectory with a `config.json`)
2. Starts a **gateway** HTTP server if webhooks or Docker mode are enabled (health check, webhook receiver, shutdown kill switch)
3. Creates a **runner** per agent — either `AgentRunner` (host mode) or `ContainerAgentRunner` (Docker mode)
4. Wires up **cron jobs** and/or **webhook bindings** to trigger each runner
5. On trigger, the runner builds a prompt (injecting `<agent-config>` and optionally `<webhook-trigger>` blocks), starts a [pi-coding-agent](https://github.com/badlogic/pi-mono) session, and streams output to the logger

### Source layout

```
src/
  cli/              # Command definitions (new, start, status, logs, agent add)
  setup/            # Interactive setup wizard (prompts, validators, scaffolding)
  scheduler/        # Scheduler: discovers agents, starts gateway, wires cron + webhooks
  agents/           # Agent runners (host + Docker), prompt builder, built-in definitions
  gateway/          # HTTP server: router, health, shutdown, webhook routes
  docker/           # Container lifecycle (launch, wait, logs, remove), image + network
  webhooks/         # Webhook registry, provider interface, GitHub provider
  tui/              # Ink-based terminal UI (App.tsx, status tracker)
  shared/           # Config loader, credentials, logger, paths, git helpers
```

### Extension points

- **New agent type** — add a definition under `src/agents/definitions/<name>/` with an `agent-definition.json` (schema for credentials and params) and an `AGENTS.md` template. It will appear in `al new` and `al agent add` automatically.
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
