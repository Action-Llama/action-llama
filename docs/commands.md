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

## `al doctor`

Checks all agent credentials and interactively prompts for any that are missing. Discovers agents in the project, collects their credential requirements (plus any webhook secret credentials), and ensures each one exists on disk.

```bash
al doctor -p .
al doctor -p ./my-project
al doctor -c               # Also push creds to cloud + reconcile IAM
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `-c, --cloud` | Push credentials to cloud and create per-agent IAM resources |

### `al doctor -c`

In cloud mode, `al doctor` additionally:
1. Pushes all local credentials to the cloud secret manager configured in `[cloud]`
2. Creates per-agent IAM resources (service accounts for Cloud Run, task roles for ECS)
3. Grants each agent access to only its declared secrets

**Cloud Run** (`cloud.provider = "cloud-run"`):

For each agent, it:
1. Creates `al-{agentName}@{gcpProject}.iam.gserviceaccount.com`
2. Grants `secretmanager.secretAccessor` on that agent's declared credentials
3. Grants `iam.serviceAccountUser` for Cloud Run execution

Requires `gcloud` CLI with project admin permissions. See [Cloud Run docs](cloud-run.md) for full setup.

**ECS Fargate** (`cloud.provider = "ecs"`):

For each agent, it:
1. Creates IAM role `al-{agentName}-task-role`
2. Attaches an inline policy granting `secretsmanager:GetSecretValue` on that agent's declared credentials

Requires AWS CLI with IAM admin permissions. See [ECS docs](ecs.md) for full setup.

## `al creds ls`

Lists all stored credentials by type and instance, showing field names but not values. Useful for seeing what's configured without exposing secrets.

```bash
al creds ls
```

Example output:

```
  anthropic_key  (token)
  github_token  (token)
  github_webhook_secret:myapp  (secret)
  github_webhook_secret:staging  (secret)
```

Default instances are shown without the `:default` suffix.

## `al cloud setup`

Interactive wizard for configuring cloud infrastructure. Prompts for provider selection and provider-specific fields, writes `[cloud]` to config.toml, pushes credentials, and provisions IAM — all in one shot.

If an existing `[cloud]` config is found, you'll be prompted to tear down the old infrastructure first.

```bash
al cloud setup -p .
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |

## `al cloud teardown`

Deletes per-agent IAM resources (service accounts for Cloud Run, task roles for ECS) and removes the `[cloud]` section from config.toml.

```bash
al cloud teardown -p .
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |

## `al run <agent>`

Manually triggers a single agent run. The agent runs once and the process exits when it completes. Useful for testing, debugging, or one-off runs without starting the full scheduler.

```bash
al run dev -p .
al run reviewer -p ./my-project
al run dev --no-docker        # Skip Docker isolation
al run dev -c                 # Run on cloud
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `--no-docker` | Disable Docker container isolation |
| `-c, --cloud` | Run on cloud infrastructure |

## `al start`

Starts the scheduler. Runs all agents on their configured schedules and listens for webhooks.

```bash
al start -p .
al start -p ./my-project
al start --no-docker          # Skip Docker isolation (dev only)
al start -c                   # Run on cloud
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `--no-docker` | Disable Docker container isolation |
| `-c, --cloud` | Run on cloud infrastructure |

## `al status`

Shows status of all discovered agents in the project.

```bash
al status -p .
al status -c                  # Show cloud status
```

Displays each agent's schedule, credentials, and webhook configuration.

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `-c, --cloud` | Show cloud infrastructure status |

## `al logs <agent>`

View log files for a specific agent.

```bash
al logs dev -p .
al logs dev -n 100          # Show last 100 entries
al logs dev -f              # Follow/tail mode
al logs dev -d 2025-01-15   # Specific date
al logs dev -c              # Cloud logs
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `-n, --lines <N>` | Number of log entries (default: 50) |
| `-f, --follow` | Tail mode — watch for new entries |
| `-d, --date <YYYY-MM-DD>` | View a specific date's log file |
| `-c, --cloud` | View cloud logs (Cloud Logging / CloudWatch) |

## `al console`

Open an interactive Pi coding console with project context.

```bash
al console -p .
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
