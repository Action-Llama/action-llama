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
- BYOM: bring your own model (supports Anthropic Claude and OpenAI GPT/Codex).

Philosophy:

- AL is a thin wrapper around Claude or GPT. The models move so quickly, it's important to minimize the harness.

Use cases:

- A developer agent that watches for new Github issues and reacts (works great with OpenAI Codex for code generation)
- A reviewer agent that watches for new Github Pull Requests and reviews them then merges if all ok

Have as many agents as you like. Customize the behaviour as you wish. The system is MIT licensed and fully extensible.

Built on [pi.dev](https://github.com/badlogic/pi-mono) as the agent harness.

## How to get started

### 1. Create a project

```bash
npx @action-llama/action-llama@latest new my-project
cd my-project
```

This scaffolds the project and sets up your model credentials and defaults.

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

If any credentials are missing, it will prompt you for them. Credentials are stored in `~/.action-llama-credentials/` (shared across projects, not committed to git). See [credentials docs](docs/credentials.md) for details.

If you want to set up credentials without starting the gateway:

```bash
npx al setup
```

### Project structure

```
my-project/
  package.json              # Includes @action-llama/action-llama as a dependency
  AGENTS.md                 # Project overview, credential/webhook reference, example playbook
  config.toml               # Global config: docker, gateway, webhooks (no secrets)
  dev/                      # One directory per agent
    agent-config.toml       # Agent config: credentials, repos, model, schedule, webhooks, params
    PLAYBOOK.md             # Agent instructions (system prompt) — edit to customize behavior
    Dockerfile              # (optional) Custom Docker image for this agent
```

## CLI commands

If you installed globally (`npm install -g @action-llama/action-llama`), you can use `al` directly. Otherwise, prefix commands with `npx` (e.g., `npx al start`).

| Command | Description |
|---------|-------------|
| `al new <name>` | Scaffold a new project (sets up Anthropic credential and model defaults) |
| `al console` | TUI for creating and managing agents |
| `al setup` | Scan agents and prompt for any missing credentials |
| `al setup --cloud` | Create per-agent IAM resources for cloud runtimes (Cloud Run or ECS) |
| `al run <agent>` | Manually trigger a single agent run |
| `al start` | Start the scheduler — runs agents on their cron schedule and/or webhook triggers |
| `al status` | Show the current status of all agents |
| `al logs <agent>` | View log entries for an agent |
| `al remote add/list/remove` | Manage remote credential stores (GSM, ASM) |
| `al creds push/pull <remote>` | Sync credentials between local and remote stores |

See [CLI command reference](docs/commands.md) for all options and flags.

### Common options

- `-p, --project <dir>` — specify the project directory (defaults to `.`)

### `al run` options

- `--dangerous-no-docker` — disable Docker container isolation and run the agent directly on the host

### `al start` options

- `--dangerous-no-docker` — disable Docker container isolation and run agents directly on the host

## Configuration

### Global config (`config.toml`)

Global settings live in `config.toml` at the project root. Docker container isolation is enabled by default — use `--dangerous-no-docker` to disable it for development.

See the [agent-config.toml reference](docs/agent-config-reference.md) for per-agent fields. Each agent carries its own model config, so you can run different models per agent (e.g., Opus for dev, Haiku for devops).

### Credentials

Credentials are stored in `~/.action-llama-credentials/<type>/<instance>/<field>` and referenced in agent configs as `"type:instance"` (e.g. `"github_token:default"`). Run `al setup` to configure them interactively. See [credentials docs](docs/credentials.md) for the full reference.

### Webhooks

Add webhook triggers to your `agent-config.toml` and point your GitHub/Sentry webhook at `http://<your-host>:8080/webhooks/github`. Payloads are verified with HMAC-SHA256. See [webhooks docs](docs/webhooks.md) for filter fields, providers, and setup details.

### Docker

Agents run in isolated containers by default — read-only root FS, dropped capabilities, non-root user, and resource limits. The base image is built automatically on first run. Agents can extend it with a custom `Dockerfile`. Use `--dangerous-no-docker` to run directly on the host during development. See [Docker docs](docs/docker.md) for the full reference.

## Cloud

Running `al start` on your laptop works for development, but for production you want agents running 24/7 on managed infrastructure — no laptop required, automatic restarts, and IAM-enforced secret isolation so a compromised agent can only access its own credentials.

Action Llama supports two cloud providers. Both use the same project structure and agent configs — the only difference is the `[docker]` section in `config.toml`. Both build on [Docker mode](docs/docker.md) for container isolation and the [remote credential system](docs/credentials.md#remote-credential-stores) for syncing secrets to cloud stores.

### GCP (Cloud Run Jobs)

Agents run as serverless Cloud Run Jobs. Images are built with Cloud Build (no local Docker needed). Credentials are stored in Google Secret Manager and mounted as files natively by Cloud Run.

**1. Configure**

```toml
[docker]
enabled = true
runtime = "cloud-run"
gcpProject = "my-gcp-project"
region = "us-central1"
artifactRegistry = "us-central1-docker.pkg.dev/my-gcp-project/al-images"
serviceAccount = "al-runner@my-gcp-project.iam.gserviceaccount.com"
```

**2. Push credentials to Google Secret Manager**

```bash
al remote add production --provider gsm --gcp-project my-gcp-project -p .
al creds push production -p .
```

**3. Create per-agent service accounts**

```bash
al setup --cloud -p .
```

This creates a GCP service account per agent and grants each one access to only its declared secrets.

**4. Start**

```bash
al start -p .
```

See [Cloud Run docs](docs/cloud-run.md) for prerequisites, full setup walkthrough, and troubleshooting.

### AWS (ECS Fargate)

Agents run as ECS Fargate tasks. Images are built locally and pushed to ECR. Credentials are stored in AWS Secrets Manager and injected as environment variables by ECS.

**1. Configure**

```toml
[docker]
enabled = true
runtime = "ecs"
awsRegion = "us-east-1"
ecsCluster = "al-cluster"
ecrRepository = "123456789012.dkr.ecr.us-east-1.amazonaws.com/al-images"
executionRoleArn = "arn:aws:iam::123456789012:role/ecsTaskExecutionRole"
taskRoleArn = "arn:aws:iam::123456789012:role/al-default-task-role"
subnets = ["subnet-abc123"]
```

**2. Push credentials to AWS Secrets Manager**

```bash
al remote add aws-prod --provider asm --aws-region us-east-1 -p .
al creds push aws-prod -p .
```

**3. Create per-agent IAM task roles**

```bash
al setup --cloud -p .
```

This creates an IAM task role per agent and grants each one `secretsmanager:GetSecretValue` scoped to only its declared secrets.

**4. Start**

```bash
al start -p .
```

See [ECS docs](docs/ecs.md) for prerequisites, full setup walkthrough, and troubleshooting.

### Cloud comparison

| | GCP Cloud Run | AWS ECS Fargate |
|---|---|---|
| Image builds | Cloud Build (no local Docker) | Local Docker + ECR push |
| Credential store | Google Secret Manager | AWS Secrets Manager |
| Credential delivery | File mount (native) | Env var injection |
| Secret isolation | Per-agent service accounts | Per-agent IAM task roles |
| Setup command | `al setup --cloud` | `al setup --cloud` |
| Log latency | ~5-15s (Cloud Logging) | ~5-10s (CloudWatch) |

## Documentation

| Doc | Description |
|-----|-------------|
| [Creating Agents](docs/creating-agents.md) | Step-by-step guide to creating a new agent |
| [agent-config.toml Reference](docs/agent-config-reference.md) | All config fields with examples |
| [Credentials](docs/credentials.md) | Credential types, storage layout, named instances |
| [Webhooks](docs/webhooks.md) | Webhook setup, filter fields, Sentry integration |
| [Docker](docs/docker.md) | Container isolation, custom Dockerfiles, filesystem layout |
| [Cloud Run](docs/cloud-run.md) | Running agents on GCP Cloud Run Jobs |
| [ECS Fargate](docs/ecs.md) | Running agents on AWS ECS Fargate |
| [CLI Commands](docs/commands.md) | All CLI commands with options and flags |
| [Example: Dev Agent](docs/examples/dev-agent.md) | Developer agent that implements GitHub issues |
| [Example: Reviewer Agent](docs/examples/reviewer-agent.md) | PR review agent |
| [Example: DevOps Agent](docs/examples/devops-agent.md) | CI/CD and Sentry monitoring agent |

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
npm test              # run all tests
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
