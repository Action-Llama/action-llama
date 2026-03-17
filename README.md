<p align="center">
  <img src="action_llama.jpg" alt="Action Llama" />
</p>

# Action Llama

Run agents like scripts: triggered by cron or webhooks.

Dev Experience:

1. The agent is triggered by a webhook, agent, or cron schedule.
2. The agent runs according to the instructions in ACTIONS.md you define
3. The agent shuts down

Key features:

- Agent runs are contained in a Docker container using only the credentials they need. Credentials are stored separately.
- Define your agents in a git repo, add custom ones, and share them.
- BYOM: bring your own model (Anthropic, OpenAI, Groq, Google Gemini, xAI, Mistral, OpenRouter, or any custom provider).

Philosophy:

- AL is a thin wrapper around Claude or GPT. The models move so quickly, it's important to minimize the harness.

Use cases:

- A developer agent that watches for new Github issues and reacts (works great with OpenAI Codex for code generation)
- A reviewer agent that watches for new Github Pull Requests and reviews them then merges if all ok
- Deploy on a VPS (DigitalOcean, Vultr, Hetzner) for cost-effective remote hosting

Have as many agents as you like. Customize the behaviour as you wish. The system is MIT licensed and fully extensible.

Built on [pi.dev](https://github.com/badlogic/pi-mono) as the agent harness.

## How to get started

### 1. Create a project

```bash
npx @action-llama/action-llama@next new my-project
cd my-project
```

This scaffolds the project and sets up your model credentials and defaults.

### 2. Create and manage agents

```bash
npx al chat
```

The chat console helps you create and manage agents. If no agents exist yet, it will offer to create one for you.

You can also create agents manually — see the [creating agents guide](docs/creating-agents.md).

Or, if you're using your own coding agent just make sure it reads the AGENTS.md in your project root.

### 3. Run

Once your agents are ready, start the scheduler!

```bash
npx al start
```

If any credentials are missing, it will prompt you for them. Credentials are stored in `~/.action-llama/credentials/` (shared across projects, not committed to git). See [credentials docs](docs/credentials.md) for details.

### Project structure

```
my-project/
  package.json              # Includes @action-llama/action-llama as a dependency
  Dockerfile                # Project base image. Generated. Shared customizations for all agents
  AGENTS.md                 # Project overview, Generated. Credential/webhook reference, example agent
  config.toml               # Global config: [local], [cloud], gateway, webhooks (no secrets)
```

Each agent subdirectory:

```
  dev/                      # Agent name
    agent-config.toml       # Agent config: credentials, model, schedule, webhooks, params
    ACTIONS.md             # Agent instructions (system prompt) — edit to customize behavior
    Dockerfile              # (optional) Custom Docker image for this agent
```

## Cloud

For production, run agents on managed cloud infrastructure — automatic restarts, secret isolation, no laptop required.

Action Llama supports:

- **VPS** (Vultr, DigitalOcean, Hetzner, etc.) — SSH + Docker, no registry needed
- **Amazon Web Services** — ECS Fargate + Lambda
- **Google Cloud Platform** — Cloud Run Jobs

```bash
al setup cloud    # Interactive wizard: pick provider, configure, push creds, provision IAM
al start -c      # Start on cloud
```

See the [cloud docs](docs/cloud.md) for setup, provider comparison, and links to the [VPS](docs/vps-deployment.md), [GCP](docs/cloud-run.md), and [AWS](docs/ecs.md) guides.

## CLI commands

If you installed globally (`npm install -g @action-llama/action-llama`), you can use `al` directly. Otherwise, prefix commands with `npx` (e.g., `npx al start`).

Commands generally have two modes: local or cloud.

| Command | Description |
|---------|-------------|
| `al new <name>` | Interactive setup — creates project directory and credentials |
| `al chat [agent]` | Interactive console — or agent-scoped session with credentials loaded |
| `al doctor` | Check agents, credentials, webhooks, and config — prompt to fix |
| `al setup cloud` | Interactive wizard for cloud provider setup |
| `al teardown cloud` | Delete cloud IAM resources and remove cloud config |
| `al creds ls` | List stored credentials (names only, no secrets) |
| `al run <agent>` | Manually run a single agent |
| `al start` | Start the scheduler |
| `al stat` | Show agent status |
| `al logs <agent>` | View agent log files |
| `al pause [name]` | Pause the scheduler, or a single agent by name |
| `al resume [name]` | Resume the scheduler, or a single agent by name |
| `al kill <target>` | Kill an agent (all instances) or a single instance by ID |

Most commands accept `-p <dir>` to set the project directory and `-c` to target cloud infrastructure. See the [CLI command reference](docs/commands.md) for all options and flags.

## Configuration

Configuration lives in two places:

- [**`config.toml`**](docs/config-reference.md) (project root) — global settings: default model (`[model]`), local Docker options (`[local]`), cloud provider config (`[cloud]`), and scheduler options like `maxReruns`.
- [**`agent-config.toml`**](docs/agent-config-reference.md) (per agent) — model, credentials, schedule, webhooks, and parameters. Each agent can use a different model or provider (e.g., Claude Opus for dev, GPT-4o for review, Gemini for devops).

Credentials are stored outside the project in `~/.action-llama/credentials/` and referenced by name in agent configs. Run `al doctor` to configure them interactively.

Agents run in isolated Docker containers for security and consistency.

See also the [credentials](docs/credentials.md), [webhooks](docs/webhooks.md), and [Docker](docs/docker.md) docs for details.

## Documentation

| Doc | Description |
|-----|-------------|
| [Agents](docs/agents.md) | What an agent is: config, ACTIONS.md, Dockerfile, runtime prompt |
| [CLI Commands](docs/commands.md) | All CLI commands with options and flags |
| [Creating Agents](docs/creating-agents.md) | Step-by-step guide to creating a new agent |
| [config.toml Reference](docs/config-reference.md) | Project-level config: model, Docker, cloud, gateway, webhooks |
| [agent-config.toml Reference](docs/agent-config-reference.md) | Per-agent config fields with examples |
| [Models](docs/models.md) | Supported LLM providers, model IDs, auth types, thinking levels |
| [Credentials](docs/credentials.md) | Credential types, storage layout, named instances |
| [Webhooks](docs/webhooks.md) | Webhook setup, filter fields, Sentry integration |
| [Docker](docs/docker.md) | Container isolation, custom Dockerfiles, filesystem layout |
| [Cloud](docs/cloud.md) | Cloud overview, provider comparison, quick start |
| [VPS Deployment](docs/vps-deployment.md) | Running agents on any VPS via SSH + Docker |
| [Cloud Run](docs/cloud-run.md) | Running agents on GCP Cloud Run Jobs |
| [ECS Fargate](docs/ecs.md) | Running agents on AWS ECS Fargate |
| [Example Agents](docs/examples/index.md) | Dev, reviewer, and devops agent templates |

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
  cli/              # Command definitions (new, doctor, cloud-setup, cloud-teardown, start, status, logs)
  setup/            # Project scaffolding
  scheduler/        # Scheduler: discovers agents, starts gateway, wires cron + webhooks
  agents/           # Agent runners (host + Docker), prompt builder
  gateway/          # HTTP server: router, health, shutdown, webhook routes
  docker/           # Container lifecycle (launch, wait, logs, remove), image + network
  webhooks/         # Webhook registry, provider interface, GitHub provider
  tui/              # Ink-based terminal UI (App.tsx, status tracker)
  shared/           # Config loader, credentials, logger, paths, git helpers
```

### Tests

```bash
npm run test:unit     # unit tests only (fast, run during development)
npm test              # all tests including integration (run before committing)
npm run test:integration  # integration tests only (Docker-based, slow)
npm run test:watch    # watch mode (unit tests only)
npm run test:coverage # V8 coverage report
```

Tests live in `test/` mirroring `src/`. Integration tests are in `test/integration/` and require Docker. Coverage excludes entry points (`cli/main.ts`), interactive prompts (`setup/prompts.ts`), and type-only files.

### Publishing

```bash
npm login                            # need @action-llama org access
npm version patch                    # or minor / major — bumps, tags, pushes
npm publish --access public          # build + tests run automatically via prepublishOnly
```

Published tarball includes `dist/`, `docker/`, `README.md`, `LICENSE`, and `package.json`.

## License

MIT
