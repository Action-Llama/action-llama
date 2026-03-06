# CLI Commands

## `al new <name>`

Creates a new Action Llama project. Runs interactive setup to configure credentials and LLM defaults.

```bash
npx @action-llama/action-llama new my-project
```

Creates:
- `my-project/package.json` — with `@action-llama/action-llama` dependency
- `my-project/.gitignore`
- `my-project/.workspace/` — runtime state directory
- Credential files in `~/.action-llama-credentials/`

After setup, create agents by following [Creating Agents](creating-agents.md).

## `al run <agent>`

Manually triggers a single agent run. The agent runs once and the process exits when it completes. Useful for testing, debugging, or one-off runs without starting the full scheduler.

```bash
al run dev -p .
al run reviewer -p ./my-project
al run dev --dangerous-no-docker   # Skip Docker isolation
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `--dangerous-no-docker` | Disable Docker container isolation |

## `al start`

Starts the scheduler. Runs all agents on their configured schedules and listens for webhooks.

```bash
al start -p .
al start -p ./my-project
al start -p . --dangerous-no-docker   # Skip Docker isolation (dev only)
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `--dangerous-no-docker` | Disable Docker container isolation |

## `al status`

Shows status of all discovered agents in the project.

```bash
al status -p .
```

Displays each agent's schedule, repos, credentials, and webhook configuration.

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |

## `al setup`

Checks all agent credentials and interactively prompts for any that are missing. Discovers agents in the project, collects their credential requirements (plus any webhook secret credentials from `config.toml`), and ensures each one exists on disk.

```bash
al setup -p .
al setup -p ./my-project
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `--cloud` | Create per-agent IAM resources for cloud runtimes (Cloud Run or ECS) |

### `al setup --cloud`

Creates per-agent IAM resources for cloud runtimes. Detects the runtime from `docker.runtime` in `config.toml` and provisions accordingly.

```bash
al setup --cloud -p .
```

**Cloud Run** (`docker.runtime = "cloud-run"`):

For each agent, it:
1. Creates `al-{agentName}@{gcpProject}.iam.gserviceaccount.com`
2. Grants `secretmanager.secretAccessor` on that agent's declared credentials
3. Grants `iam.serviceAccountUser` for Cloud Run execution

Requires `gcloud` CLI with project admin permissions. **Must run after `al creds push`** — bindings are created against existing secrets in GSM. See [Cloud Run docs](cloud-run.md) for full setup.

**ECS Fargate** (`docker.runtime = "ecs"`):

For each agent, it:
1. Creates IAM role `al-{agentName}-task-role`
2. Attaches an inline policy granting `secretsmanager:GetSecretValue` on that agent's declared credentials

Requires AWS CLI with IAM admin permissions. Can run before or after `al creds push` — policies use wildcard ARN patterns. See [ECS docs](ecs.md) for full setup.

## `al remote`

Manage remote credential stores.

### `al remote add <name>`

```bash
al remote add production --provider gsm --gcp-project my-gcp-project -p .
al remote add aws-prod --provider asm --aws-region us-east-1 -p .
al remote add staging --provider gsm --gcp-project staging-proj --secret-prefix al-staging -p .
```

| Option | Description |
|--------|-------------|
| `--provider <provider>` | Backend provider: `gsm` (Google Secret Manager) or `asm` (AWS Secrets Manager) |
| `--gcp-project <id>` | GCP project ID (required for `gsm`) |
| `--aws-region <region>` | AWS region (required for `asm`) |
| `--secret-prefix <prefix>` | Secret name prefix (default: `action-llama`) |
| `-p, --project <dir>` | Project directory (default: `.`) |

### `al remote list`

```bash
al remote list -p .
```

### `al remote remove <name>`

```bash
al remote remove production -p .
```

## `al creds`

Push and pull credentials between local storage and remote stores.

### `al creds push <remote>`

```bash
al creds push production -p .
```

Pushes all local credentials (`~/.action-llama-credentials/`) to the named remote.

### `al creds pull <remote>`

```bash
al creds pull production -p .
```

Pulls all credentials from the named remote to local storage.

## `al logs <agent>`

View log files for a specific agent.

```bash
al logs dev -p .
al logs dev -n 100          # Show last 100 entries
al logs dev -f              # Follow/tail mode
al logs dev -d 2025-01-15   # Specific date
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `-n, --lines <N>` | Number of log entries (default: 50) |
| `-f, --follow` | Tail mode — watch for new entries |
| `-d, --date <YYYY-MM-DD>` | View a specific date's log file |
